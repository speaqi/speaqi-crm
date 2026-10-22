import { inflateRawSync } from 'node:zlib'
import { load } from 'cheerio'
import { safePublicUrl } from '../tourism'
import { MAX_DOC_TEXT_CHARS, documentText, safeFileName, sniffUpload, type Sniffed } from './tourism-deck-assets'
import { fetchResearchPage, type ResearchFetch } from './tourism-site-crawler'

// Materiali di una proposta Agency: brief scritto, documenti (PDF, Word, PowerPoint,
// testo), foto, logo del cliente e il testo del suo sito. Il tipo si decide dai byte
// (riuso del controllo delle presentazioni Tourism), mai dal nome dichiarato.

export const AGENCY_BUCKET = 'agency-assets'
export const MAX_AGENCY_PHOTOS = 16
export const MAX_AGENCY_DOCUMENTS = 8
export const MAX_AGENCY_PHOTO_BYTES = 8 * 1024 * 1024
export const MAX_AGENCY_DOCUMENT_BYTES = 20 * 1024 * 1024
export const MAX_AGENCY_REQUEST_BYTES = 60 * 1024 * 1024

export type AgencyAssetKind = 'photo' | 'logo' | 'document' | 'website'
export type AgencyAsset = {
  id: string
  kind: AgencyAssetKind
  name: string
  mime: string
  size: number
  path: string
  /** Per il sito: l'indirizzo letto. */
  source_url?: string
  created_at: string
}

export type AgencySniffed = Sniffed | { kind: 'document'; mime: string; ext: 'pptx'; doc: 'pptx' }

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export function sniffAgencyUpload(buf: Buffer, name: string): AgencySniffed | null {
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && /\.pptx$/i.test(name)) {
    return { kind: 'document', mime: PPTX_MIME, ext: 'pptx', doc: 'pptx' }
  }
  return sniffUpload(buf, name)
}

type ZipEntry = { name: string; method: number; compressed: number; local: number }

/** Indice di uno zip (docx e pptx lo sono), senza dipendenze. */
export function zipEntries(buf: Buffer): ZipEntry[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > buf.length) throw new Error('Archivio non leggibile')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const out: ZipEntry[] = []
  for (let i = 0; i < count && i < 5000; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break
    const nameLen = buf.readUInt16LE(at + 28)
    out.push({
      name: buf.toString('utf8', at + 46, at + 46 + nameLen),
      method: buf.readUInt16LE(at + 10),
      compressed: buf.readUInt32LE(at + 20),
      local: buf.readUInt32LE(at + 42)
    })
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return out
}

export function readZipEntry(buf: Buffer, entry: ZipEntry, maxOut = 25 * 1024 * 1024): Buffer {
  if (entry.local + 30 > buf.length) throw new Error('Archivio troncato')
  const start = entry.local + 30 + buf.readUInt16LE(entry.local + 26) + buf.readUInt16LE(entry.local + 28)
  const data = buf.subarray(start, start + entry.compressed)
  if (entry.method === 0) return data
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: maxOut })
  throw new Error('Compressione non supportata')
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m
  })

/** Testo di una presentazione PowerPoint: una sezione per slide, nell'ordine delle slide. */
export function extractPptxText(buf: Buffer): string {
  const entries = zipEntries(buf)
  const slides = entries
    .map((e) => ({ e, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name)?.[1]) }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.n - b.n)
  if (!slides.length) throw new Error('Presentazione senza slide leggibili')
  const parts: string[] = []
  let total = 0
  for (const { e, n } of slides) {
    const xml = readZipEntry(buf, e).toString('utf8')
    const paragraphs = xml
      .split(/<\/a:p>/)
      .map((p) => decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map((t) => t.slice(5, -6)).join('')).trim())
      .filter(Boolean)
    if (!paragraphs.length) continue
    const block = `[Slide ${n}]\n${paragraphs.join('\n')}`
    parts.push(block)
    total += block.length
    if (total > MAX_DOC_TEXT_CHARS * 1.2) break
  }
  const text = parts.join('\n\n').trim()
  if (!text) throw new Error('Presentazione senza testo')
  return text
}

export function agencyDocumentText(buf: Buffer, sniffed: AgencySniffed): { text: string; truncated: boolean } {
  if (sniffed.doc === 'pptx') {
    const text = extractPptxText(buf)
    return text.length > MAX_DOC_TEXT_CHARS ? { text: text.slice(0, MAX_DOC_TEXT_CHARS), truncated: true } : { text, truncated: false }
  }
  if (sniffed.doc === 'docx' || sniffed.doc === 'text') return documentText(buf, sniffed.doc)
  throw new Error('Documento senza testo estraibile')
}

export const agencyStoragePath = (userId: string, projectId: string, assetId: string, ext: string) => `${userId}/${projectId}/${assetId}.${ext}`

export { safeFileName }

// ---- Sito del cliente -----------------------------------------------------

export const MAX_WEBSITE_TEXT = 20_000

/** Testo leggibile di una pagina: titolo, descrizione, titoli e paragrafi, senza menu e script. */
export function websiteTextFromHtml(html: string, url: string) {
  const $ = load(html)
  $('script,style,noscript,svg,iframe,form,template,nav,footer,header [role="navigation"]').remove()
  const title = $('title').first().text().trim().slice(0, 200)
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim().slice(0, 500)
  const lines: string[] = []
  const seen = new Set<string>()
  $('h1,h2,h3,h4,p,li,blockquote,td').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() || ''
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text.length < 3 || text.length > 1500 || seen.has(text)) return
    seen.add(text)
    lines.push(/^h[1-4]$/.test(tag) ? `## ${text}` : text)
  })
  const body = [`Sito: ${url}`, title && `Titolo: ${title}`, description && `Descrizione: ${description}`, '', ...lines].join('\n')
  return { title, text: body.slice(0, MAX_WEBSITE_TEXT), truncated: body.length > MAX_WEBSITE_TEXT }
}

/**
 * Legge la home del sito del cliente con il fetch sicuro della ricerca Tourism (solo
 * indirizzi pubblici, niente reti private). I redirect si seguono a mano, al massimo tre,
 * ricontrollando ogni indirizzo.
 */
export async function fetchWebsiteText(input: string, fetcher: ResearchFetch = fetchResearchPage) {
  const first = safePublicUrl(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
  if (!first) throw new Error('Indirizzo del sito non valido: serve un URL pubblico http o https')
  let url: string = first
  for (let hop = 0; hop < 4; hop++) {
    const page = await fetcher(url)
    if (page.status >= 300 && page.status < 400) {
      const location = String(page.headers.location || '')
      const next: string | null = location ? safePublicUrl(new URL(location, url).href) : null
      if (!next) throw new Error('Il sito reindirizza a un indirizzo non valido')
      url = next
      continue
    }
    if (page.status >= 400) throw new Error(`Il sito risponde ${page.status}`)
    const type = String(page.headers['content-type'] || '')
    if (type && !/html|xml|text/i.test(type)) throw new Error('L’indirizzo non è una pagina web')
    const result = websiteTextFromHtml(page.text, url)
    if (result.text.split('\n').length < 4) throw new Error('Il sito non ha testo leggibile (forse è costruito interamente in JavaScript)')
    return { ...result, url }
  }
  throw new Error('Troppi reindirizzamenti')
}
