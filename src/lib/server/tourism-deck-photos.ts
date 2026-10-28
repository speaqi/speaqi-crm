import {
  commonsFileUrl,
  commonsSearchUrl,
  isCommonsFileTitle,
  MANUAL_PHOTO_LIMITS,
  previewUrl,
  photoCandidates,
  photoCredit,
  photoFileName,
  pickDestinationPhotos,
  wikiArticleImagesUrl,
  type PhotoCandidate
} from '../tourism-deck-photos'
import { MAX_PHOTO_BYTES, photoForDeck } from './tourism-deck-assets'

// Le foto della destinazione da Wikimedia Commons: prima quelle della voce Wikipedia
// (italiana, poi inglese), poi la ricerca per nome su Commons. Solo licenze libere, con
// autore e licenza da citare. Un guasto della rete non ferma la presentazione: si torna
// senza foto e lo si dice.

/** Wikimedia chiede un User-Agent che dica chi chiama e come contattarlo. */
const USER_AGENT = 'SpeaqiCRM/1.0 (https://crm.speaqi.com; info@speaqi.com)'
const TIMEOUT_MS = 12_000

export type DestinationPhoto = { name: string; buffer: Buffer; credit: string; source_url: string }

async function getJson(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Wikimedia ha risposto HTTP ${response.status}`)
  return response.json()
}

async function download(photo: PhotoCandidate, fetcher: typeof fetch): Promise<Buffer | null> {
  // Solo il server delle immagini di Wikimedia: l'indirizzo arriva da una risposta esterna.
  if (new URL(photo.url).hostname !== 'upload.wikimedia.org') return null
  const response = await fetcher(photo.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
  if (!response.ok) return null
  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.length > 3 * MAX_PHOTO_BYTES) return null
  return photoForDeck(raw)
}

/** Fino a `count` foto della destinazione, già pronte per il palco. Non lancia: torna anche il motivo se ne mancano. */
export async function findDestinationPhotos(destination: string, count: number, fetcher: typeof fetch = fetch): Promise<{ photos: DestinationPhoto[]; note: string | null }> {
  const name = destination.trim()
  if (!name || count <= 0) return { photos: [], note: null }
  const candidates: PhotoCandidate[] = []
  const errors: string[] = []
  const sources: Array<[string, boolean]> = [
    [wikiArticleImagesUrl('it', name), true],
    [wikiArticleImagesUrl('en', name), true],
    [commonsSearchUrl(name), false]
  ]
  for (const [url, fromArticle] of sources) {
    if (pickDestinationPhotos(candidates, name, count + 2).length >= count + 2) break
    try {
      candidates.push(...photoCandidates(await getJson(url, fetcher), fromArticle))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const photos: DestinationPhoto[] = []
  // Qualche riserva: una miniatura che non si scarica lascia il posto alla successiva.
  for (const photo of pickDestinationPhotos(candidates, name, count + 2)) {
    if (photos.length >= count) break
    try {
      const buffer = await download(photo, fetcher)
      if (buffer) photos.push({ name: photoFileName(photo), buffer, credit: photoCredit(photo), source_url: photo.sourceUrl })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  const note = photos.length >= count ? null
    : photos.length ? `Su Wikimedia Commons ho trovato solo ${photos.length} foto di ${name}: le altre restano quelle di esempio.`
      : errors.length && !candidates.length ? `Foto di ${name} non cercate: Wikimedia non ha risposto (${errors[0].slice(0, 120)}). Restano quelle di esempio.`
        : `Su Wikimedia Commons non ho trovato foto libere di ${name}: restano quelle di esempio, caricane tu.`
  return { photos, note }
}

// ---- Ricerca a mano, dall'editor della presentazione ------------------------

export type WikimediaResult = {
  title: string
  preview: string
  width: number
  height: number
  credit: string
  source_url: string
}

/**
 * Le foto che Commons ha per un nome scritto da chi lavora ("Asiago 7 Comuni", "Altopiano di
 * Asiago"): voce Wikipedia italiana e inglese, poi la ricerca libera. Nessun filtro sul nome del
 * file: la scelta la fa chi guarda. Solo licenze libere, orizzontali, abbastanza grandi.
 */
export async function searchWikimediaPhotos(query: string, fetcher: typeof fetch = fetch, limit = 24): Promise<{ results: WikimediaResult[]; note: string | null }> {
  const name = query.trim().slice(0, 120)
  if (name.length < 2) return { results: [], note: 'Scrivi almeno due lettere.' }
  const candidates: PhotoCandidate[] = []
  const errors: string[] = []
  const sources: Array<[string, boolean]> = [
    [wikiArticleImagesUrl('it', name), true],
    [wikiArticleImagesUrl('en', name), true],
    [commonsSearchUrl(name, false), false]
  ]
  const answers = await Promise.allSettled(sources.map(([url]) => getJson(url, fetcher)))
  answers.forEach((answer, i) => {
    if (answer.status === 'fulfilled') candidates.push(...photoCandidates(answer.value, sources[i][1], MANUAL_PHOTO_LIMITS))
    else errors.push(answer.reason instanceof Error ? answer.reason.message : String(answer.reason))
  })
  const seen = new Set<string>()
  const results = candidates
    .filter((c) => !seen.has(c.title) && Boolean(seen.add(c.title)))
    .slice(0, limit)
    .map((c) => ({ title: c.title, preview: previewUrl(c), width: c.width, height: c.height, credit: photoCredit(c), source_url: c.sourceUrl }))
  const note = results.length ? null
    : errors.length === sources.length ? `Wikimedia non ha risposto (${errors[0].slice(0, 120)}). Riprova fra poco.`
      : `Nessuna foto libera trovata per «${name}». Prova un altro nome (il comune principale, la valle, un monumento) o carica una foto tua.`
  return { results, note }
}

/** Un file scelto dai risultati: si rilegge da Commons (licenza e misure di nuovo controllate) e si scarica. */
export async function fetchWikimediaPhoto(title: string, fetcher: typeof fetch = fetch): Promise<DestinationPhoto> {
  if (!isCommonsFileTitle(title)) throw new Error('Foto non valida')
  const [photo] = photoCandidates(await getJson(commonsFileUrl(title.trim()), fetcher), false, MANUAL_PHOTO_LIMITS)
  if (!photo) throw new Error('Questa foto non si può usare: licenza non libera o misure troppo piccole')
  const buffer = await download(photo, fetcher)
  if (!buffer) throw new Error('Foto non scaricata da Wikimedia, riprova')
  return { name: photoFileName(photo), buffer, credit: photoCredit(photo), source_url: photo.sourceUrl }
}
