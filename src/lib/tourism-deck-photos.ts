// Foto della destinazione per le presentazioni Tourism, da Wikimedia Commons.
// Puro: costruisce le richieste, legge le risposte, sceglie le foto e scrive il credito.
// La rete sta in src/lib/server/tourism-deck-photos.ts.

export type PhotoCandidate = {
  title: string
  /** Miniatura larga (upload.wikimedia.org), quella che si scarica. */
  url: string
  width: number
  height: number
  author: string
  license: string
  /** Pagina del file su Commons: la fonte da citare. */
  sourceUrl: string
  /** Sta nella voce Wikipedia della destinazione: più pertinente di una ricerca per nome. */
  fromArticle: boolean
}

const API_PARAMS = 'format=json&formatversion=2&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1920'

/** Le immagini della voce Wikipedia della destinazione (lingua: it, poi en). */
export function wikiArticleImagesUrl(lang: 'it' | 'en', destination: string) {
  return `https://${lang}.wikipedia.org/w/api.php?action=query&${API_PARAMS}&generator=images&gimlimit=50&redirects=1&titles=${encodeURIComponent(destination)}`
}

/**
 * Ricerca per nome fra i file di Commons, solo immagini bitmap. `exact` mette il nome fra
 * virgolette (la ricerca automatica); quella scritta a mano no: "Asiago 7 Comuni" fra
 * virgolette non trova niente, senza trova l'Altopiano.
 */
export function commonsSearchUrl(destination: string, exact = true) {
  const query = `${exact ? `"${destination}"` : destination} filetype:bitmap`
  return `https://commons.wikimedia.org/w/api.php?action=query&${API_PARAMS}&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=${encodeURIComponent(query)}`
}

/** Un file di Commons per titolo ("File:…"): si rilegge prima di scaricarlo, mai fidandosi del browser. */
export function commonsFileUrl(title: string) {
  return `https://commons.wikimedia.org/w/api.php?action=query&${API_PARAMS}&titles=${encodeURIComponent(title)}`
}

/** Un titolo di file di Commons accettabile: "File:" e niente che non sia un nome. */
export function isCommonsFileTitle(value: unknown): value is string {
  return typeof value === 'string' && /^File:[^\n\r#<>[\]{}|]{1,240}$/i.test(value.trim())
}

/** La miniatura piccola per scegliere: stessa immagine, 480 px invece di 1920. */
export function previewUrl(photo: Pick<PhotoCandidate, 'url'>) {
  return photo.url.replace(/\/1920px-/, '/480px-')
}

/** Soglie della ricerca a mano: chi sceglie guarda la foto, si accetta qualcosa di più piccolo. */
export const MANUAL_PHOTO_LIMITS = { minWidth: 1200, minHeight: 675 }

const stripHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Licenze che permettono l'uso con il solo credito: CC BY, CC BY-SA, CC0, pubblico dominio. */
export function freeLicense(shortName: string): boolean {
  const name = shortName.trim()
  if (/\b(nc|nd)\b|non-?commercial|no-?deriv|fair use|non-free/i.test(name)) return false
  return /^(cc[ -]?by(-sa)?[ -]?\d|cc0|public domain|pd\b|pd-)/i.test(name)
}

/** Cartine, stemmi, loghi, bandiere, schemi: non sono foto della città. */
const NOT_A_PHOTO = /(map|mappa|karte|carte|plan\b|pianta|stemma|coat[_ ]of[_ ]arms|wappen|blason|logo|flag|bandiera|locator|location|diagram|grafico|chart|svg|icon|signature|firma|population|popolazione|panorama_?map)/i

export const compactText = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Legge una risposta dell'API (formatversion=2) e tiene solo le foto utilizzabili. */
export function photoCandidates(payload: unknown, fromArticle: boolean, limits: { minWidth: number; minHeight: number } = { minWidth: 1400, minHeight: 800 }): PhotoCandidate[] {
  const pages = ((payload as { query?: { pages?: unknown[] } })?.query?.pages || []) as Array<Record<string, any>>
  const out: PhotoCandidate[] = []
  for (const page of pages) {
    const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null
    if (!info || typeof page.title !== 'string') continue
    const meta = info.extmetadata || {}
    const license = stripHtml(meta.LicenseShortName?.value)
    const width = Number(info.width) || 0
    const height = Number(info.height) || 0
    const url = typeof info.thumburl === 'string' ? info.thumburl : typeof info.url === 'string' ? info.url : ''
    if (info.mime !== 'image/jpeg' || !url.startsWith('https://upload.wikimedia.org/')) continue
    if (!freeLicense(license) || NOT_A_PHOTO.test(page.title)) continue
    // Orizzontale e grande: va a tutta altezza su un palco 16:9.
    if (width < limits.minWidth || height < limits.minHeight || width / height < 1.2) continue
    const author = stripHtml(meta.Artist?.value).slice(0, 80) || 'autore su Wikimedia Commons'
    out.push({
      title: page.title,
      url,
      width,
      height,
      author,
      license: license.slice(0, 40),
      sourceUrl: typeof info.descriptionurl === 'string' ? info.descriptionurl : `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      fromArticle
    })
  }
  return out
}

/**
 * Le foto da usare, al massimo `count`. Quelle della voce Wikipedia valgono di per sé; quelle
 * della ricerca solo se il nome del file nomina la destinazione. Prima la voce, poi le più grandi;
 * mai lo stesso file due volte.
 */
export function pickDestinationPhotos(candidates: PhotoCandidate[], destination: string, count = 3): PhotoCandidate[] {
  const wanted = compactText(destination)
  const seen = new Set<string>()
  return candidates
    .filter((c) => c.fromArticle || (wanted.length >= 3 && compactText(c.title).includes(wanted)))
    .sort((a, b) => Number(b.fromArticle) - Number(a.fromArticle) || b.width * b.height - a.width * a.height)
    .filter((c) => !seen.has(c.title) && Boolean(seen.add(c.title)))
    .slice(0, count)
}

/** Il credito che le licenze chiedono: autore, licenza, fonte. */
export function photoCredit(photo: Pick<PhotoCandidate, 'author' | 'license'>) {
  return `Foto: ${photo.author} · ${photo.license} · Wikimedia Commons`
}

/** Nome del file salvato fra i materiali del deck. */
export function photoFileName(photo: Pick<PhotoCandidate, 'title'>) {
  return photo.title.replace(/^File:/i, '').replace(/\.[a-z]+$/i, '').slice(0, 80) + '.jpg'
}
