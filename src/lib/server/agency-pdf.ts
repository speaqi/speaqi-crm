import { createHash } from 'node:crypto'
import { renderPdf } from './tourism-deck-pdf'
import { AGENCY_BUCKET } from './agency-assets'
import { AgencyInputError, renderKey, type PresentationRow } from './agency'

// PDF di una presentazione Agency: lo stesso Chromium delle presentazioni Tourism
// (@sparticuz/chromium, un render alla volta) stampa la pagina pubblica, una pagina
// 16:9 per slide. A differenza di Tourism si esporta anche una bozza: Chromium la apre
// con una chiave di render valida per quella sola versione, e ogni pagina porta "Bozza".

type Sb = any

/** Si alza quando cambia il disegno delle slide: i PDF in cache si rigenerano. */
export const AGENCY_DESIGN_VERSION = 2

/**
 * Cambia quando cambiano le slide (versione), il preventivo mostrato, l'identità dell'agenzia,
 * il marchio del cliente, le foto scelte o il disegno. Marchio e foto entrano a parte perché
 * cambiarli (o togliere un file dal progetto) non alza la versione della presentazione.
 */
export function pdfStamp(row: Pick<PresentationRow, 'version' | 'status'> & { slides?: PresentationRow['slides'] }, quoteUpdatedAt: string | null, settings: unknown, brand: unknown = null) {
  const images = (row.slides || []).map((s) => s?.image_asset_id || null)
  const h = createHash('sha256')
    .update(JSON.stringify([quoteUpdatedAt || '', settings || {}, row.status === 'approved', AGENCY_DESIGN_VERSION, brand || {}, images]))
    .digest('hex')
    .slice(0, 10)
  return `v${row.version}-${h}`
}

export const presentationFolder = (row: Pick<PresentationRow, 'user_id' | 'project_id' | 'id'>) => `${row.user_id}/${row.project_id}/presentations/${row.id}`
export const presentationPdfPath = (row: Pick<PresentationRow, 'user_id' | 'project_id' | 'id'>, stamp: string) => `${presentationFolder(row)}/${stamp}.pdf`

export function internalProposalUrl(row: Pick<PresentationRow, 'public_token' | 'version' | 'status'>) {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}/proposta/${row.public_token}`
  if (row.status === 'approved') return base
  const key = renderKey(row.public_token, row.version)
  if (!key) throw new AgencyInputError('Per esportare una bozza in PDF serve AGENCY_RENDER_SECRET (o SUPABASE_SERVICE_ROLE_KEY) sul server. In alternativa approva la presentazione.')
  return `${base}?render=${key}`
}

const inflight = new Map<string, Promise<Buffer>>()

export function getOrCreatePresentationPdf(
  service: Sb,
  row: PresentationRow,
  stamp: string,
  render: (url: string) => Promise<Buffer> = renderPdf
): Promise<Buffer> {
  if (row.status === 'generating') return Promise.reject(new AgencyInputError('L’agente sta lavorando: riprova tra poco'))
  const path = presentationPdfPath(row, stamp)
  const pending = inflight.get(path)
  if (pending) return pending
  const job = (async () => {
    const cached = await service.storage.from(AGENCY_BUCKET).download(path)
    if (cached.data && !cached.error) return Buffer.from(await cached.data.arrayBuffer())
    const pdf = await render(internalProposalUrl(row))
    if (pdf.subarray(0, 4).toString() !== '%PDF') throw new Error('Il PDF generato non è valido')
    const up = await service.storage.from(AGENCY_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    if (up.error) throw up.error
    // I PDF delle versioni precedenti non servono più: lo storico vive nelle versioni.
    const folder = presentationFolder(row)
    const listing = await service.storage.from(AGENCY_BUCKET).list(folder)
    const stale = ((listing.data || []) as { name: string }[]).filter((f) => f.name.endsWith('.pdf') && `${folder}/${f.name}` !== path).map((f) => `${folder}/${f.name}`)
    if (stale.length) await service.storage.from(AGENCY_BUCKET).remove(stale)
    return pdf
  })().finally(() => inflight.delete(path))
  inflight.set(path, job)
  return job
}
