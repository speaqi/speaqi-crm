import { TourismInputError } from '../tourism'
import { DECK_BUCKET } from './tourism-deck-assets'
import type { DeckRow } from './tourism-decks'

// PDF di una presentazione approvata: Chromium apre la pagina pubblica e la stampa,
// una pagina 16:9 per slide. Chromium è quello di @sparticuz/chromium (un binario
// autonomo, niente apt: sull'immagine Ubuntu di Railway `apt chromium` è solo uno
// stub di snap). Un PDF per versione si salva su Storage: si genera una volta sola.

type Sb = any

const RENDER_TIMEOUT_MS = 90_000

let queue: Promise<unknown> = Promise.resolve()

/** Un Chromium alla volta: ognuno vuole 300-500 MB, e il CRM gira in un solo container. */
export function renderPdf(url: string): Promise<Buffer> {
  const run = () => withTimeout(doRender(url), RENDER_TIMEOUT_MS, 'PDF non generato in tempo')
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

async function doRender(url: string): Promise<Buffer> {
  const [{ default: chromium }, { default: puppeteer }] = await Promise.all([import('@sparticuz/chromium'), import('puppeteer-core')])
  const executablePath = process.env.CHROMIUM_PATH || (await chromium.executablePath())
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath, headless: 'shell' })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 })
    if (!response || !response.ok()) throw new Error(`Pagina della presentazione non raggiungibile (${response?.status() ?? 'nessuna risposta'})`)
    // Font e foto devono essere arrivati prima di stampare, o il PDF esce con i caratteri di ripiego.
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r }))))
      // Due frame: le slide che si adattano al contenuto (Speaqi Agency) si ricalcolano dopo i font.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    const pdf = await page.pdf({ width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export const deckPdfPath = (row: Pick<DeckRow, 'user_id' | 'id' | 'version'>) => `${row.user_id}/${row.id}/deck-v${row.version}.pdf`

/** La pagina che Chromium stampa: quella pubblica, sullo stesso server (sempre raggiungibile, anche dietro il dominio). */
export const internalDeckUrl = (token: string) => `http://127.0.0.1:${process.env.PORT || 3000}/presentazione/${token}`

const inflight = new Map<string, Promise<Buffer>>()

/**
 * Il PDF della versione approvata: dalla cache su Storage, o generato e salvato.
 * Una richiesta sola per file anche con cento aperture insieme; una modifica alla
 * presentazione (versione nuova) fa nascere un file nuovo e toglie i vecchi.
 */
export function getOrCreateDeckPdf(
  service: Sb,
  row: DeckRow,
  render: (url: string) => Promise<Buffer> = renderPdf
): Promise<Buffer> {
  if (row.status !== 'approved') return Promise.reject(new TourismInputError('Approva la presentazione prima di generare il PDF'))
  const path = deckPdfPath(row)
  const pending = inflight.get(path)
  if (pending) return pending
  const job = (async () => {
    const cached = await service.storage.from(DECK_BUCKET).download(path)
    if (cached.data && !cached.error) return Buffer.from(await cached.data.arrayBuffer())
    const pdf = await render(internalDeckUrl(row.public_token))
    if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('Il PDF generato non è valido')
    const up = await service.storage.from(DECK_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (up.error) throw up.error
    // Le versioni vecchie non servono più: il loro link è già morto.
    const listing = await service.storage.from(DECK_BUCKET).list(`${row.user_id}/${row.id}`)
    const stale = ((listing.data || []) as { name: string }[])
      .filter((f) => /^deck-v\d+\.pdf$/.test(f.name) && `${row.user_id}/${row.id}/${f.name}` !== path)
      .map((f) => `${row.user_id}/${row.id}/${f.name}`)
    if (stale.length) await service.storage.from(DECK_BUCKET).remove(stale)
    return pdf
  })().finally(() => inflight.delete(path))
  inflight.set(path, job)
  return job
}

export const pdfFileName = (destination: string) =>
  `speaqi-${destination.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'presentazione'}.pdf`
