import { inflateRawSync } from 'node:zlib'

// Foto e documenti di una presentazione. Il tipo si decide dai byte, mai dal nome
// o dal content-type dichiarato dal browser: un file rinominato non passa.

export const DECK_BUCKET = 'tourism-deck-assets'
export const MAX_PHOTOS = 8
export const MAX_DOCUMENTS = 4
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024
export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024
/** Testo che l'agente legge da ogni documento: oltre, si tronca e lo si dice. */
export const MAX_DOC_TEXT_CHARS = 40_000

export type DeckAsset = {
  id: string
  kind: 'photo' | 'document'
  name: string
  mime: string
  size: number
  path: string
  /**
   * Da dove viene: caricata a mano (assente), trovata da sola su Wikimedia Commons ('wikimedia'),
   * scelta a mano dalla ricerca su Commons ('wikimedia_search', vale come una foto caricata) o
   * arrivata con un ordine su Telegram.
   */
  source?: 'wikimedia' | 'wikimedia_search' | 'telegram'
  /** Autore e licenza, da mostrare sulla slide (le licenze Creative Commons lo chiedono). */
  credit?: string
  source_url?: string
}

/** Una foto pronta per il palco: lato lungo 1920 px, JPEG. Null se non è un'immagine leggibile. */
export async function photoForDeck(buf: Buffer): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import('sharp')
    return await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  } catch {
    return null
  }
}

export type Sniffed = { kind: 'photo' | 'document'; mime: string; ext: string; doc?: 'pdf' | 'docx' | 'text' }

const startsWith = (buf: Buffer, bytes: number[], at = 0) => bytes.every((b, i) => buf[at + i] === b)

export function sniffUpload(buf: Buffer, name: string): Sniffed | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'photo', mime: 'image/jpeg', ext: 'jpg' }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'photo', mime: 'image/png', ext: 'png' }
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { kind: 'photo', mime: 'image/webp', ext: 'webp' }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { kind: 'document', mime: 'application/pdf', ext: 'pdf', doc: 'pdf' }
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(name)) {
    return { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', doc: 'docx' }
  }
  if (/\.(txt|md|csv)$/i.test(name)) {
    const head = buf.subarray(0, 8192)
    if (head.includes(0)) return null
    return { kind: 'document', mime: 'text/plain', ext: 'txt', doc: 'text' }
  }
  return null
}

/** Nome da mostrare: niente percorsi, niente caratteri di controllo. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() || 'file'
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120) || 'file'
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Testo di un .docx, senza dipendenze: un docx è uno zip e il testo sta in word/document.xml. */
export function extractDocxText(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > buf.length) throw new Error('Documento Word non leggibile')
  const entries = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < entries; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break
    const method = buf.readUInt16LE(at + 10)
    const compressed = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    if (name === 'word/document.xml') {
      if (local + 30 > buf.length) break
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + compressed)
      const xml = (method === 0 ? data : inflateRawSync(data, { maxOutputLength: 25 * 1024 * 1024 })).toString('utf8')
      return xml
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
          if (e[0] === '#') {
            const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
            return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
          }
          return ENTITIES[e.toLowerCase()] ?? m
        })
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }
    at += 46 + nameLen + extraLen + commentLen
  }
  throw new Error('Documento Word senza testo')
}

export function documentText(buf: Buffer, kind: 'docx' | 'text'): { text: string; truncated: boolean } {
  const text = kind === 'docx' ? extractDocxText(buf) : buf.toString('utf8').replace(/\u0000/g, '')
  return text.length > MAX_DOC_TEXT_CHARS ? { text: text.slice(0, MAX_DOC_TEXT_CHARS), truncated: true } : { text, truncated: false }
}

/** Foto per il modello: lato lungo 1280 px, JPEG. Senza sharp si manda l'originale solo se piccolo. */
export async function photoForModel(buf: Buffer): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const { default: sharp } = await import('sharp')
    const data = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
    return { data, mime: 'image/jpeg' }
  } catch {
    return null
  }
}

export function storagePath(userId: string, deckId: string, assetId: string, ext: string) {
  return `${userId}/${deckId}/${assetId}.${ext}`
}
