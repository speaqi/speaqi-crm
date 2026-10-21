import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { requireRouteUser } from './supabase'
import { getOpenDeal } from './deal-ops'
import {
  AGENCY_STAGES,
  DEFAULT_AGENCY_SETTINGS,
  DEFAULT_SERVICE_CATEGORIES,
  categorySlug,
  countTodo,
  ensureFrame,
  isAgencyStage,
  normalizeAgencySettings,
  normalizeAnalysis,
  normalizeClientBrand,
  normalizeSlides,
  normalizeTheme,
  quoteSummary,
  type AgencyAnalysis,
  type AgencySettings,
  type AgencySlide,
  type AgencyStage,
  type AgencyTheme,
  type AgencyWarning,
  type ClientBrand,
  type PresentationStatus,
  type QuoteSummary,
  type ServiceCategory
} from '../agency'
import {
  AGENCY_BUCKET,
  MAX_AGENCY_DOCUMENTS,
  MAX_AGENCY_DOCUMENT_BYTES,
  MAX_AGENCY_PHOTOS,
  MAX_AGENCY_PHOTO_BYTES,
  agencyDocumentText,
  agencyStoragePath,
  fetchWebsiteText,
  safeFileName,
  sniffAgencyUpload,
  type AgencyAsset
} from './agency-assets'
import { photoForModel } from './tourism-deck-assets'
import { runGenerate, runRevise, type AgencyBrief, type AgencyMaterials } from './agency-agent'

// Speaqi Agency, lato server: opportunità, materiali, presentazioni, versioni e
// collegamento ai preventivi. Ogni query porta user_id del proprietario (oltre alla RLS).

type Sb = any

export class AgencyInputError extends Error {}

const checked = <T extends { error: unknown }>(result: T): T => {
  if (result.error) throw result.error
  return result
}
const now = () => new Date().toISOString()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '')

// ---- Accesso e risposte ---------------------------------------------------

/** Come Tourism Intelligence: nel pilota Agency è del solo proprietario del workspace. */
export async function requireAgencyOwner(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth
  if (!auth.isAdmin || auth.user.id !== auth.workspaceUserId) {
    return { error: Response.json({ error: 'Speaqi Agency è riservata al proprietario del workspace' }, { status: 403 }) }
  }
  return auth
}

export function agencyResponse(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export function agencyError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || '')
  const code = String((error as { code?: string })?.code || '')
  if (/42P01|PGRST205|42703/.test(code)) {
    return agencyResponse({ error: 'Schema Speaqi Agency assente: applicare la migration 20261020130000_agency.sql al database CRM.' }, 503)
  }
  if (error instanceof AgencyInputError || /not found for this owner|Immutable|violates check constraint/i.test(message)) {
    return agencyResponse({ error: message }, 400)
  }
  if (/Version conflict|already running/i.test(message)) return agencyResponse({ error: message }, 409)
  console.error('Speaqi Agency operation failed', { code, message: message.slice(0, 300) })
  return agencyResponse({ error: 'Operazione non completata. Controllare configurazione e log del server.' }, 500)
}

export async function agencyBody(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 2_000_000) throw new AgencyInputError('Richiesta troppo grande')
  const raw = await request.text()
  if (raw.length > 2_000_000) throw new AgencyInputError('Richiesta troppo grande')
  try {
    const body = raw ? JSON.parse(raw) : {}
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new AgencyInputError('JSON non valido')
  }
}

// ---- Impostazioni e categorie ---------------------------------------------

export async function getSettings(sb: Sb, userId: string): Promise<AgencySettings> {
  const row = checked(await sb.from('agency_settings').select('content').eq('user_id', userId).maybeSingle()).data
  return row ? normalizeAgencySettings(row.content) : { ...DEFAULT_AGENCY_SETTINGS }
}

export async function saveSettings(sb: Sb, userId: string, raw: unknown): Promise<AgencySettings> {
  const content = normalizeAgencySettings(raw)
  checked(await sb.from('agency_settings').upsert({ user_id: userId, content, updated_at: now() }, { onConflict: 'user_id' }))
  return content
}

/** Le categorie di partenza nascono alla prima lettura; dopo si gestiscono da Template. */
export async function listCategories(sb: Sb, userId: string): Promise<(ServiceCategory & { id: string })[]> {
  const read = async () =>
    (checked(await sb.from('agency_service_categories').select('id,slug,name,description,sort_order,is_active').eq('user_id', userId).order('sort_order').order('name')).data ||
      []) as (ServiceCategory & { id: string })[]
  const rows = await read()
  if (rows.length) return rows
  checked(
    await sb
      .from('agency_service_categories')
      .upsert(DEFAULT_SERVICE_CATEGORIES.map((c) => ({ ...c, user_id: userId })), { onConflict: 'user_id,slug', ignoreDuplicates: true })
  )
  return read()
}

export async function upsertCategory(sb: Sb, userId: string, raw: Record<string, unknown>) {
  const name = text(raw.name, 80)
  if (!name) throw new AgencyInputError('Nome della categoria obbligatorio')
  const payload = {
    name,
    description: text(raw.description, 400),
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Math.round(Number(raw.sort_order)) : 500,
    is_active: raw.is_active !== false,
    updated_at: now()
  }
  if (isUuid(raw.id)) {
    const row = checked(await sb.from('agency_service_categories').update(payload).eq('user_id', userId).eq('id', raw.id).select('*').maybeSingle()).data
    if (!row) throw new AgencyInputError('Categoria non trovata')
    return row
  }
  const slug = categorySlug(raw.slug || name)
  if (!slug) throw new AgencyInputError('Nome della categoria non valido')
  const exists = checked(await sb.from('agency_service_categories').select('id').eq('user_id', userId).eq('slug', slug).maybeSingle()).data
  if (exists) throw new AgencyInputError('Esiste già una categoria con questo nome')
  return checked(await sb.from('agency_service_categories').insert({ ...payload, slug, user_id: userId }).select('*').single()).data
}

// ---- Opportunità ----------------------------------------------------------

export type ProjectRow = {
  id: string
  user_id: string
  contact_id: string | null
  client_name: string
  deal_id: string | null
  title: string
  services: string[]
  stage: AgencyStage
  brief: string
  website_url: string | null
  client_brand: ClientBrand
  assets: AgencyAsset[]
  analysis: Partial<AgencyAnalysis>
  version: number
  created_at: string
  updated_at: string
}

export async function loadProject(sb: Sb, userId: string, id: string): Promise<ProjectRow> {
  if (!isUuid(id)) throw new AgencyInputError('ID non valido')
  const row = checked(await sb.from('agency_projects').select('*').eq('user_id', userId).eq('id', id).maybeSingle()).data
  if (!row) throw new AgencyInputError('Opportunità non trovata')
  return row as ProjectRow
}

async function readContact(sb: Sb, userId: string, contactId: string) {
  const row = checked(
    await sb.from('contacts').select('id,name,company,email,phone,category,industry,note,status').eq('user_id', userId).eq('id', contactId).maybeSingle()
  ).data
  if (!row) throw new AgencyInputError('Cliente non trovato nel CRM')
  return row as Record<string, string | null>
}

async function validServices(sb: Sb, userId: string, raw: unknown) {
  const wanted = (Array.isArray(raw) ? raw : []).filter((s): s is string => typeof s === 'string').map(categorySlug).filter(Boolean)
  if (!wanted.length) return []
  const known = new Set((await listCategories(sb, userId)).map((c) => c.slug))
  return [...new Set(wanted.filter((s) => known.has(s)))].slice(0, 20)
}

export async function createProject(sb: Sb, userId: string, raw: Record<string, unknown>): Promise<ProjectRow> {
  if (!isUuid(raw.contact_id)) throw new AgencyInputError('Seleziona o crea il cliente')
  const contact = await readContact(sb, userId, raw.contact_id)
  const clientName = text(contact.company, 200) || text(contact.name, 200) || 'Cliente'
  const title = text(raw.title, 200) || `Proposta per ${clientName}`
  // La trattativa resta quella del CRM: si aggancia quella aperta, se c'è.
  let dealId: string | null = null
  try {
    dealId = (await getOpenDeal(sb, userId, contact.id as string))?.id || null
  } catch {
    dealId = null
  }
  const website = text(raw.website_url, 2000)
  const row = checked(
    await sb
      .from('agency_projects')
      .insert({
        user_id: userId,
        contact_id: contact.id,
        client_name: clientName,
        deal_id: dealId,
        title,
        services: await validServices(sb, userId, raw.services),
        brief: text(raw.brief, 40000),
        website_url: website || null,
        client_brand: normalizeClientBrand({ name: clientName })
      })
      .select('*')
      .single()
  ).data as ProjectRow
  await logActivity(sb, userId, row.contact_id, `Speaqi Agency: aperta l'opportunità "${row.title}".`, { agency_project_id: row.id })
  return row
}

export async function updateProject(sb: Sb, row: ProjectRow, raw: Record<string, unknown>): Promise<ProjectRow> {
  const patch: Record<string, unknown> = {}
  if (typeof raw.title === 'string') {
    const title = text(raw.title, 200)
    if (!title) throw new AgencyInputError('Il titolo non può essere vuoto')
    patch.title = title
  }
  if (typeof raw.brief === 'string') patch.brief = text(raw.brief, 40000)
  if (typeof raw.website_url === 'string') patch.website_url = text(raw.website_url, 2000) || null
  if (Array.isArray(raw.services)) patch.services = await validServices(sb, row.user_id, raw.services)
  if (raw.stage !== undefined) {
    if (!isAgencyStage(raw.stage)) throw new AgencyInputError(`Stato non valido: usa ${AGENCY_STAGES.join(', ')}`)
    patch.stage = raw.stage
  }
  if (raw.client_brand && typeof raw.client_brand === 'object') {
    const brand = normalizeClientBrand(raw.client_brand)
    if (brand.logo_asset_id && !row.assets.some((a) => a.id === brand.logo_asset_id && (a.kind === 'logo' || a.kind === 'photo'))) brand.logo_asset_id = null
    patch.client_brand = brand
  }
  if (!Object.keys(patch).length) return row
  const version = Number(raw.version)
  if (!Number.isInteger(version)) throw new AgencyInputError('version richiesta')
  const updated = checked(
    await sb
      .from('agency_projects')
      .update({ ...patch, version: version + 1, updated_at: now() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', version)
      .select('*')
      .maybeSingle()
  ).data
  if (!updated) throw new Error('Version conflict: l’opportunità è stata cambiata altrove, ricarica.')
  if (patch.stage && patch.stage !== row.stage) {
    await logActivity(sb, row.user_id, row.contact_id, `Speaqi Agency: "${row.title}" passa a ${patch.stage}.`, { agency_project_id: row.id })
  }
  return updated as ProjectRow
}

export async function deleteProject(sb: Sb, service: Sb, row: ProjectRow) {
  await removeFolder(service, `${row.user_id}/${row.id}`)
  checked(await sb.from('agency_projects').delete().eq('user_id', row.user_id).eq('id', row.id))
}

async function removeFolder(service: Sb, folder: string) {
  // Le sottocartelle (i PDF di ogni presentazione) si elencano a parte: Storage non è ricorsivo.
  const paths: string[] = []
  const walk = async (dir: string, depth: number) => {
    const listing = await service.storage.from(AGENCY_BUCKET).list(dir, { limit: 1000 })
    for (const f of (listing?.data || []) as { name: string; id: string | null }[]) {
      if (f.id === null && depth < 3) await walk(`${dir}/${f.name}`, depth + 1)
      else paths.push(`${dir}/${f.name}`)
    }
  }
  try {
    await walk(folder, 0)
    if (paths.length) await service.storage.from(AGENCY_BUCKET).remove(paths)
  } catch (error) {
    console.error('Pulizia file Agency non riuscita', { folder, message: String((error as Error)?.message || error).slice(0, 200) })
  }
}

async function logActivity(sb: Sb, userId: string, contactId: string | null, content: string, metadata: Record<string, unknown>) {
  if (!contactId) return
  // Il registro del contatto è un di più: non deve far fallire l'operazione.
  try {
    await sb.from('activities').insert({ user_id: userId, contact_id: contactId, type: 'system', content: content.slice(0, 500), metadata })
  } catch {
    /* ignora */
  }
}

// ---- Materiali ------------------------------------------------------------

let bucketReady = false
export async function ensureAgencyBucket(service: Sb) {
  if (bucketReady) return
  const { data } = await service.storage.getBucket(AGENCY_BUCKET)
  if (!data) {
    const created = await service.storage.createBucket(AGENCY_BUCKET, { public: false })
    if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error
  }
  bucketReady = true
}

export type UploadedFile = { name: string; buffer: Buffer; role?: 'logo' }

async function saveProjectAssets(sb: Sb, row: ProjectRow, assets: AgencyAsset[]) {
  checked(await sb.from('agency_projects').update({ assets, updated_at: now() }).eq('user_id', row.user_id).eq('id', row.id))
  row.assets = assets
}

/** Controlla tutto prima di scrivere: un file non valido ferma la richiesta senza lasciare metà dei file. */
export async function addProjectAssets(sb: Sb, service: Sb, row: ProjectRow, files: UploadedFile[]): Promise<AgencyAsset[]> {
  let photos = row.assets.filter((a) => a.kind === 'photo' || a.kind === 'logo').length
  let documents = row.assets.filter((a) => a.kind === 'document').length
  const next: { asset: AgencyAsset; buffer: Buffer }[] = []
  for (const file of files) {
    const name = safeFileName(file.name)
    const sniffed = sniffAgencyUpload(file.buffer, name)
    if (!sniffed) throw new AgencyInputError(`"${name}": formato non supportato (foto e loghi JPG, PNG, WebP; documenti PDF, Word, PowerPoint, TXT, MD, CSV)`)
    if (sniffed.kind === 'photo') {
      if (file.buffer.length > MAX_AGENCY_PHOTO_BYTES) throw new AgencyInputError(`"${name}": l’immagine supera ${MAX_AGENCY_PHOTO_BYTES / 1048576} MB`)
      if (++photos > MAX_AGENCY_PHOTOS) throw new AgencyInputError(`Al massimo ${MAX_AGENCY_PHOTOS} immagini per opportunità`)
    } else {
      if (file.buffer.length > MAX_AGENCY_DOCUMENT_BYTES) throw new AgencyInputError(`"${name}": il documento supera ${MAX_AGENCY_DOCUMENT_BYTES / 1048576} MB`)
      if (++documents > MAX_AGENCY_DOCUMENTS) throw new AgencyInputError(`Al massimo ${MAX_AGENCY_DOCUMENTS} documenti per opportunità`)
    }
    const id = randomUUID()
    const kind = sniffed.kind === 'photo' ? (file.role === 'logo' ? 'logo' : 'photo') : 'document'
    next.push({
      asset: { id, kind, name, mime: sniffed.mime, size: file.buffer.length, path: agencyStoragePath(row.user_id, row.id, id, sniffed.ext), created_at: now() },
      buffer: file.buffer
    })
  }
  if (!next.length) return []
  await ensureAgencyBucket(service)
  const stored: string[] = []
  try {
    for (const { asset, buffer } of next) {
      const up = await service.storage.from(AGENCY_BUCKET).upload(asset.path, buffer, { contentType: asset.mime, upsert: false })
      if (up.error) throw up.error
      stored.push(asset.path)
    }
    const assets = [...row.assets, ...next.map((n) => n.asset)]
    // Il primo logo caricato diventa il logo del cliente, se non ce n'è già uno.
    const logo = next.find((n) => n.asset.kind === 'logo')
    if (logo && !row.client_brand?.logo_asset_id) {
      const brand = { ...normalizeClientBrand(row.client_brand), logo_asset_id: logo.asset.id }
      checked(await sb.from('agency_projects').update({ assets, client_brand: brand, updated_at: now() }).eq('user_id', row.user_id).eq('id', row.id))
      row.assets = assets
      row.client_brand = brand
    } else {
      await saveProjectAssets(sb, row, assets)
    }
  } catch (error) {
    if (stored.length) await service.storage.from(AGENCY_BUCKET).remove(stored)
    throw error
  }
  return next.map((n) => n.asset)
}

/** Legge il sito e lo salva come documento di testo: si vede fra i materiali e si rilegge a ogni generazione. */
export async function importWebsite(sb: Sb, service: Sb, row: ProjectRow, url: string, fetcher = fetchWebsiteText) {
  const site = await fetcher(url).catch((error: Error) => {
    throw new AgencyInputError(`Sito non letto: ${error.message}`)
  })
  const host = new URL(site.url).hostname.replace(/^www\./, '')
  const id = randomUUID()
  const buffer = Buffer.from(site.text, 'utf8')
  const asset: AgencyAsset = {
    id,
    kind: 'website',
    name: `Sito ${host}`,
    mime: 'text/plain',
    size: buffer.length,
    path: agencyStoragePath(row.user_id, row.id, id, 'txt'),
    source_url: site.url,
    created_at: now()
  }
  await ensureAgencyBucket(service)
  const up = await service.storage.from(AGENCY_BUCKET).upload(asset.path, buffer, { contentType: 'text/plain; charset=utf-8', upsert: false })
  if (up.error) throw up.error
  // Una lettura nuova dello stesso sito sostituisce la vecchia.
  const old = row.assets.filter((a) => a.kind === 'website' && a.source_url && new URL(a.source_url).hostname.replace(/^www\./, '') === host)
  try {
    checked(
      await sb
        .from('agency_projects')
        .update({ assets: [...row.assets.filter((a) => !old.includes(a)), asset], website_url: row.website_url || site.url, updated_at: now() })
        .eq('user_id', row.user_id)
        .eq('id', row.id)
    )
  } catch (error) {
    await service.storage.from(AGENCY_BUCKET).remove([asset.path])
    throw error
  }
  if (old.length) await service.storage.from(AGENCY_BUCKET).remove(old.map((a) => a.path))
  row.assets = [...row.assets.filter((a) => !old.includes(a)), asset]
  row.website_url = row.website_url || site.url
  return { asset, truncated: site.truncated }
}

export async function removeProjectAsset(sb: Sb, service: Sb, row: ProjectRow, assetId: string) {
  const asset = row.assets.find((a) => a.id === assetId)
  if (!asset) throw new AgencyInputError('File non trovato')
  const assets = row.assets.filter((a) => a.id !== assetId)
  const brand = normalizeClientBrand(row.client_brand)
  if (brand.logo_asset_id === assetId) brand.logo_asset_id = null
  checked(await sb.from('agency_projects').update({ assets, client_brand: brand, updated_at: now() }).eq('user_id', row.user_id).eq('id', row.id))
  // Una foto tolta non resta scelta in nessuna slide del progetto.
  const pres = checked(await sb.from('agency_presentations').select('id,slides,status').eq('user_id', row.user_id).eq('project_id', row.id)).data || []
  for (const p of pres as { id: string; slides: AgencySlide[]; status: string }[]) {
    if (!(p.slides || []).some((s) => s.image_asset_id === assetId)) continue
    const slides = p.slides.map((s) => (s.image_asset_id === assetId ? { ...s, image_asset_id: null } : s))
    // Su una presentazione in generazione non si tocca updated_at: è la firma del turno dell'agente.
    const generating = p.status === 'generating'
    checked(await sb.from('agency_presentations').update(generating ? { slides } : { slides, updated_at: now() }).eq('user_id', row.user_id).eq('id', p.id))
  }
  await service.storage.from(AGENCY_BUCKET).remove([asset.path])
  row.assets = assets
  row.client_brand = brand
}

const MAX_PDF_TOTAL_BYTES = 24 * 1024 * 1024

export async function loadMaterials(service: Sb, row: ProjectRow): Promise<{ materials: AgencyMaterials; skipped: string[] }> {
  const materials: AgencyMaterials = { documents: [], photos: [], logos: [] }
  const skipped: string[] = []
  let pdfBytes = 0
  for (const asset of row.assets) {
    const file = await service.storage.from(AGENCY_BUCKET).download(asset.path)
    if (file.error || !file.data) {
      skipped.push(`${asset.name}: non scaricabile`)
      continue
    }
    const buffer = Buffer.from(await file.data.arrayBuffer())
    if (asset.kind === 'photo' || asset.kind === 'logo') {
      const img = await photoForModel(buffer)
      if (!img) skipped.push(`${asset.name}: immagine non elaborabile, non letta dall'agente`)
      else (asset.kind === 'logo' ? materials.logos : materials.photos).push({ id: asset.id, name: asset.name, dataUrl: `data:${img.mime};base64,${img.data.toString('base64')}` })
    } else if (asset.kind === 'website') {
      materials.website = { url: asset.source_url || asset.name, text: buffer.toString('utf8') }
    } else if (asset.mime === 'application/pdf') {
      if (pdfBytes + buffer.length > MAX_PDF_TOTAL_BYTES) skipped.push(`${asset.name}: PDF oltre il limite complessivo, non letto`)
      else {
        pdfBytes += buffer.length
        materials.documents.push({ name: asset.name, pdf: { filename: asset.name, dataUrl: `data:application/pdf;base64,${buffer.toString('base64')}` } })
      }
    } else {
      const sniffed = sniffAgencyUpload(buffer, asset.name)
      try {
        if (!sniffed) throw new Error()
        const { text: body, truncated } = agencyDocumentText(buffer, sniffed)
        materials.documents.push({ name: asset.name, text: body, truncated })
      } catch {
        skipped.push(`${asset.name}: testo non leggibile`)
      }
    }
  }
  return { materials, skipped }
}

// ---- Preventivi collegati -------------------------------------------------

const QUOTE_FIELDS = 'id,quote_number,title,status,currency,billing_interval,items,subtotal_amount,discount_amount,tax_rate,tax_amount,total_amount,deposit_amount,payment_terms_note,public_note,valid_until,public_token,updated_at,contact_id,agency_project_id,created_at'

export async function projectQuotes(sb: Sb, userId: string, projectId: string) {
  const rows = checked(await sb.from('quotes').select(QUOTE_FIELDS).eq('user_id', userId).eq('agency_project_id', projectId).order('created_at', { ascending: false })).data || []
  return rows as Record<string, any>[]
}

async function readQuote(sb: Sb, userId: string, quoteId: string) {
  const row = checked(await sb.from('quotes').select(QUOTE_FIELDS).eq('user_id', userId).eq('id', quoteId).maybeSingle()).data
  return (row as Record<string, any>) || null
}

/** Aggancia un preventivo esistente all'opportunità: deve essere dello stesso cliente o di nessuno. */
export async function attachQuote(sb: Sb, project: ProjectRow, quoteId: string) {
  if (!isUuid(quoteId)) throw new AgencyInputError('Preventivo non valido')
  const quote = await readQuote(sb, project.user_id, quoteId)
  if (!quote) throw new AgencyInputError('Preventivo non trovato')
  if (quote.contact_id && project.contact_id && quote.contact_id !== project.contact_id) throw new AgencyInputError('Il preventivo è di un altro cliente')
  if (quote.agency_project_id && quote.agency_project_id !== project.id) throw new AgencyInputError('Il preventivo è già collegato a un’altra opportunità')
  checked(await sb.from('quotes').update({ agency_project_id: project.id }).eq('user_id', project.user_id).eq('id', quoteId))
  return quote
}

export async function detachQuote(sb: Sb, project: ProjectRow, quoteId: string) {
  if (!isUuid(quoteId)) throw new AgencyInputError('Preventivo non valido')
  checked(await sb.from('quotes').update({ agency_project_id: null }).eq('user_id', project.user_id).eq('id', quoteId).eq('agency_project_id', project.id))
  // Le presentazioni che lo mostravano tornano senza preventivo: la slide investimento resta da
  // completare, e una presentazione approvata torna da approvare (il link si spegne).
  const scope = (q: any) => q.eq('user_id', project.user_id).eq('project_id', project.id).eq('quote_id', quoteId)
  checked(await scope(sb.from('agency_presentations').update({ quote_id: null, status: 'ready', approved_at: null, updated_at: now() })).eq('status', 'approved'))
  // In generazione si stacca il preventivo senza toccare updated_at, la firma del turno dell'agente.
  checked(await scope(sb.from('agency_presentations').update({ quote_id: null })).eq('status', 'generating'))
  checked(await scope(sb.from('agency_presentations').update({ quote_id: null, updated_at: now() })))
}

/** I preventivi del cliente non ancora collegati ad altre opportunità: fra questi si sceglie. */
export async function attachableQuotes(sb: Sb, project: ProjectRow) {
  if (!project.contact_id) return []
  const rows = checked(
    await sb
      .from('quotes')
      .select('id,quote_number,title,status,total_amount,currency,agency_project_id,created_at')
      .eq('user_id', project.user_id)
      .eq('contact_id', project.contact_id)
      .is('agency_project_id', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(50)
  ).data
  return rows || []
}

// ---- Presentazioni --------------------------------------------------------

export type PresentationRow = {
  id: string
  user_id: string
  project_id: string
  title: string
  slides: AgencySlide[]
  theme: Partial<AgencyTheme>
  warnings: AgencyWarning[]
  quote_id: string | null
  instruction: string
  last_change: string
  status: PresentationStatus
  error: string | null
  public_token: string
  generated_at: string | null
  approved_at: string | null
  version: number
  created_at: string
  updated_at: string
}

// Più lungo del giro peggiore (due tentativi da 240 s più la lettura dei materiali).
const GENERATING_STALE_MS = 12 * 60_000

export async function loadPresentation(sb: Sb, userId: string, id: string): Promise<PresentationRow> {
  if (!isUuid(id)) throw new AgencyInputError('ID non valido')
  const row = checked(await sb.from('agency_presentations').select('*').eq('user_id', userId).eq('id', id).maybeSingle()).data
  if (!row) throw new AgencyInputError('Presentazione non trovata')
  return row as PresentationRow
}

async function snapshot(sb: Sb, row: Pick<PresentationRow, 'user_id' | 'id' | 'version' | 'title' | 'slides' | 'theme'>, reason: string) {
  // La versione è unica per presentazione: un doppio salvataggio della stessa non è un errore.
  const res = await sb
    .from('agency_presentation_versions')
    .insert({ user_id: row.user_id, presentation_id: row.id, version: row.version, title: row.title, slides: row.slides, theme: row.theme, reason: reason.slice(0, 300) })
  if (res.error && res.error.code !== '23505') throw res.error
}

/** Slide di partenza senza AI: si costruisce a mano, o si aspetta l'agente. */
export function starterSlides(project: Pick<ProjectRow, 'title' | 'client_name'>, settings: AgencySettings): AgencySlide[] {
  return ensureFrame(
    normalizeSlides([
      { id: 'cover', kind: 'cover', title: project.title, body: `Proposta per ${project.client_name}` },
      { id: 'context', kind: 'context', title: `${project.client_name} oggi`, body: '[DA VERIFICARE] Il contesto del cliente.' },
      { id: 'solution', kind: 'solution', title: 'La nostra proposta', body: '[DA VERIFICARE] La soluzione in sintesi.' },
      { id: 'next-steps', kind: 'next_steps', title: 'I prossimi passi', items: [{ title: 'Allineamento', text: 'Rivediamo insieme la proposta.' }, { title: 'Avvio', text: 'Partiamo dopo la conferma.' }] },
      { id: 'closing', kind: 'closing', title: 'Parliamone', body: settings.contact || '[DA VERIFICARE] contatto' }
    ]),
    project.title
  )
}

export async function createPresentation(sb: Sb, project: ProjectRow, raw: Record<string, unknown> = {}): Promise<PresentationRow> {
  const settings = await getSettings(sb, project.user_id)
  const brand = normalizeClientBrand(project.client_brand)
  const theme = normalizeTheme(raw.theme, {
    style: settings.default_style,
    accent: brand.accent || settings.default_accent,
    client_logo: Boolean(brand.logo_asset_id),
    language: raw.language === 'en' ? 'en' : 'it'
  })
  let quoteId: string | null = null
  if (isUuid(raw.quote_id)) {
    const q = await readQuote(sb, project.user_id, raw.quote_id)
    if (!q || q.agency_project_id !== project.id) throw new AgencyInputError('Il preventivo non è collegato a questa opportunità')
    quoteId = q.id
  } else {
    // Di default si mostra il preventivo più recente dell'opportunità, se c'è.
    quoteId = (await projectQuotes(sb, project.user_id, project.id)).find((q) => q.status !== 'cancelled')?.id || null
  }
  const row = checked(
    await sb
      .from('agency_presentations')
      .insert({
        user_id: project.user_id,
        project_id: project.id,
        title: text(raw.title, 200) || project.title,
        slides: starterSlides(project, settings),
        theme,
        quote_id: quoteId,
        instruction: text(raw.instruction, 4000)
      })
      .select('*')
      .single()
  ).data as PresentationRow
  await snapshot(sb, row, 'Creata')
  if (project.stage === 'brief') {
    await sb.from('agency_projects').update({ stage: 'proposal', updated_at: now() }).eq('user_id', project.user_id).eq('id', project.id).eq('stage', 'brief')
  }
  return row
}

/**
 * Prende il turno per l'agente: una generazione o revisione alla volta per presentazione.
 * Due UPDATE condizionali invece di un `.or()`: con PostgREST un filtro `or` su un UPDATE
 * si applica anche alla risposta, cioè alla riga già aggiornata (status = generating), e
 * la presa in carico riuscita tornava vuota. Ognuno dei due è atomico.
 */
export async function claimGeneration(sb: Sb, row: PresentationRow) {
  const stale = new Date(Date.now() - GENERATING_STALE_MS).toISOString()
  const patch = { status: 'generating', error: null, approved_at: null, updated_at: now() }
  const base = () => sb.from('agency_presentations').update(patch).eq('user_id', row.user_id).eq('id', row.id)
  let claimed = checked(await base().neq('status', 'generating').select('*').maybeSingle()).data
  // Un giro fermo da troppo tempo (processo riavviato) si riprende.
  if (!claimed) claimed = checked(await base().eq('status', 'generating').lt('updated_at', stale).select('*').maybeSingle()).data
  if (!claimed) throw new Error('Generazione già in corso per questa presentazione (already running)')
  return claimed as PresentationRow
}

export async function buildBrief(sb: Sb, project: ProjectRow, presentation: Pick<PresentationRow, 'quote_id' | 'theme' | 'instruction'>): Promise<AgencyBrief> {
  const [settings, categories] = await Promise.all([getSettings(sb, project.user_id), listCategories(sb, project.user_id)])
  let contact: Record<string, string | null> | null = null
  if (project.contact_id) contact = await readContact(sb, project.user_id, project.contact_id).catch(() => null)
  const quote = presentation.quote_id ? quoteSummary(await readQuote(sb, project.user_id, presentation.quote_id)) : null
  const services = categories.filter((c) => project.services.includes(c.slug)).map((c) => ({ name: c.name, description: c.description }))
  return {
    project_title: project.title,
    client: {
      name: project.client_name,
      company: contact?.company || null,
      email: contact?.email || null,
      sector: contact?.industry || contact?.category || null,
      notes: contact?.note ? String(contact.note).slice(0, 1500) : null
    },
    services,
    brief: [project.brief, presentation.instruction && `Indicazioni per questa presentazione: ${presentation.instruction}`].filter(Boolean).join('\n\n'),
    agency: {
      name: settings.name,
      signature: settings.signature,
      contact: settings.contact || '[DA VERIFICARE] contatto dell’agenzia',
      about: settings.about
    },
    quote: { linked: Boolean(quote), lines: (quote?.lines || []).map((l) => [l.description, l.details].filter(Boolean).join(': ')).slice(0, 20) },
    language: normalizeTheme(presentation.theme).language
  }
}

async function finishWith(sb: Sb, row: PresentationRow, patch: Record<string, unknown>, reason: string) {
  const version = row.version + 1
  const updated = checked(
    await sb
      .from('agency_presentations')
      .update({ ...patch, status: 'ready', error: null, approved_at: null, version, updated_at: now() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      // Solo se il turno è ancora di questo giro: un giro ripreso da un'altra richiesta non va sovrascritto.
      .eq('status', 'generating')
      .eq('updated_at', row.updated_at)
      .select('*')
      .maybeSingle()
  ).data as PresentationRow | null
  if (!updated) throw new SupersededError()
  await snapshot(sb, updated, reason)
  return updated
}

class SupersededError extends Error {
  constructor() {
    super('Generazione superata da un giro più recente')
  }
}

async function failWith(sb: Sb, row: PresentationRow, error: unknown) {
  // Il turno è passato a un altro giro: non si tocca la riga, il risultato è il suo.
  if (error instanceof SupersededError) return loadPresentation(sb, row.user_id, row.id)
  const message = (error instanceof Error ? error.message : 'Errore sconosciuto').slice(0, 500)
  console.error('Speaqi Agency: agente non riuscito', { presentation: row.id, message })
  // Le slide restano quelle di prima: si può sempre correggere a mano.
  const failed = checked(
    await sb
      .from('agency_presentations')
      .update({ status: 'failed', error: message, updated_at: now() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('status', 'generating')
      .eq('updated_at', row.updated_at)
      .select('*')
      .maybeSingle()
  ).data
  return (failed as PresentationRow | null) || loadPresentation(sb, row.user_id, row.id)
}

/** Fase A-E: acquisizione dei materiali, analisi, strategia, struttura e slide. */
export async function runGeneration(sb: Sb, service: Sb, row: PresentationRow, instruction?: string): Promise<PresentationRow> {
  try {
    const project = await loadProject(sb, row.user_id, row.project_id)
    const { materials, skipped } = await loadMaterials(service, project)
    const brief = await buildBrief(sb, project, row)
    const result = await runGenerate({ brief, materials, instruction: text(instruction, 2000) || undefined })
    const theme = normalizeTheme({ ...normalizeTheme(row.theme), style: result.style || normalizeTheme(row.theme).style })
    checked(await sb.from('agency_projects').update({ analysis: result.analysis, updated_at: now() }).eq('user_id', row.user_id).eq('id', project.id))
    return await finishWith(
      sb,
      row,
      {
        slides: result.slides,
        theme,
        warnings: [...result.warnings, ...skipped.map((message) => ({ slide: '*', message }))],
        last_change: `Generata dall’agente: ${result.slides.length} slide.`,
        generated_at: now()
      },
      instruction ? `Generata: ${instruction}` : 'Generata dall’agente'
    )
  } catch (error) {
    return failWith(sb, row, error)
  }
}

/** Fase F con l'AI: un'istruzione in linguaggio naturale, solo le slide interessate cambiano. */
export async function runRevision(sb: Sb, service: Sb, row: PresentationRow, instruction: string): Promise<PresentationRow> {
  try {
    const project = await loadProject(sb, row.user_id, row.project_id)
    const { materials } = await loadMaterials(service, project)
    const brief = await buildBrief(sb, project, row)
    const theme = normalizeTheme(row.theme)
    const result = await runRevise({ brief, materials, analysis: normalizeAnalysis(project.analysis), slides: normalizeSlides(row.slides), theme, instruction })
    return await finishWith(
      sb,
      row,
      {
        slides: result.slides,
        theme: { ...theme, style: result.style || theme.style },
        // Gli avvisi delle slide non toccate restano; quelli nuovi si aggiungono.
        warnings: [...(row.warnings || []).filter((w) => !result.changed.includes(w.slide)), ...result.warnings].slice(0, 80),
        last_change: result.summary || `Modificate ${result.changed.length} slide.`
      },
      `Revisione: ${instruction}`
    )
  } catch (error) {
    return failWith(sb, row, error)
  }
}

export async function saveEdits(sb: Sb, row: PresentationRow, project: ProjectRow, raw: Record<string, unknown>): Promise<PresentationRow> {
  if (row.status === 'generating') throw new AgencyInputError('L’agente sta lavorando: riprova tra poco')
  const version = Number(raw.version)
  if (!Number.isInteger(version) || version < 1) throw new AgencyInputError('version richiesta')
  const patch: Record<string, unknown> = {}
  if (Array.isArray(raw.slides)) {
    const photos = new Set(project.assets.filter((a) => a.kind === 'photo').map((a) => a.id))
    const slides = normalizeSlides(raw.slides).map((s) => ({ ...s, image_asset_id: s.image_asset_id && photos.has(s.image_asset_id) ? s.image_asset_id : null }))
    if (!slides.length) throw new AgencyInputError('Serve almeno una slide')
    patch.slides = slides
  }
  if (raw.theme && typeof raw.theme === 'object') patch.theme = normalizeTheme(raw.theme, normalizeTheme(row.theme))
  if (typeof raw.title === 'string' && raw.title.trim()) patch.title = text(raw.title, 200)
  if (typeof raw.instruction === 'string') patch.instruction = text(raw.instruction, 4000)
  if (raw.quote_id !== undefined) {
    if (raw.quote_id === null || raw.quote_id === '') patch.quote_id = null
    else {
      const q = isUuid(raw.quote_id) ? await readQuote(sb, row.user_id, raw.quote_id) : null
      if (!q || q.agency_project_id !== row.project_id) throw new AgencyInputError('Il preventivo non è collegato a questa opportunità')
      patch.quote_id = q.id
    }
  }
  if (!Object.keys(patch).length) return row
  // Una presentazione approvata e poi modificata torna da approvare (il link si spegne).
  if (row.status === 'approved') Object.assign(patch, { status: 'ready', approved_at: null })
  if (row.status === 'draft' || row.status === 'failed') patch.status = 'ready'
  const updated = checked(
    await sb
      .from('agency_presentations')
      .update({ ...patch, version: version + 1, updated_at: now() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', version)
      .select('*')
      .maybeSingle()
  ).data as PresentationRow | null
  if (!updated) throw new Error('Version conflict: la presentazione è stata cambiata altrove, ricarica.')
  await snapshot(sb, updated, text(raw.reason, 120) || 'Modifica manuale')
  return updated
}

export async function setApproval(sb: Sb, row: PresentationRow, approve: boolean): Promise<PresentationRow> {
  if (approve) {
    if (row.status === 'generating') throw new AgencyInputError('L’agente sta lavorando: riprova tra poco')
    const todo = countTodo(normalizeSlides(row.slides), { hasQuote: Boolean(row.quote_id) })
    if (todo > 0) throw new AgencyInputError(`Restano ${todo} [DA VERIFICARE] da completare prima di approvare`)
  }
  const updated = checked(
    await sb
      .from('agency_presentations')
      .update(approve ? { status: 'approved', approved_at: now(), updated_at: now() } : { status: 'ready', approved_at: null, updated_at: now() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', row.version)
      .select('*')
      .maybeSingle()
  ).data
  if (!updated) throw new Error('Version conflict: la presentazione è stata cambiata altrove, ricarica.')
  return updated as PresentationRow
}

export async function listVersions(sb: Sb, row: PresentationRow) {
  return (
    checked(
      await sb
        .from('agency_presentation_versions')
        .select('id,version,title,reason,created_at,slides')
        .eq('user_id', row.user_id)
        .eq('presentation_id', row.id)
        .order('version', { ascending: false })
        .limit(100)
    ).data || []
  ).map((v: { slides?: unknown[] } & Record<string, unknown>) => ({ ...v, slides: undefined, slide_count: Array.isArray(v.slides) ? v.slides.length : 0 }))
}

export async function restoreVersion(sb: Sb, row: PresentationRow, project: ProjectRow, version: number) {
  const v = checked(
    await sb.from('agency_presentation_versions').select('*').eq('user_id', row.user_id).eq('presentation_id', row.id).eq('version', version).maybeSingle()
  ).data
  if (!v) throw new AgencyInputError('Versione non trovata')
  return saveEdits(sb, row, project, { version: row.version, slides: v.slides, theme: v.theme, title: v.title, reason: `Ripristinata la versione ${version}` })
}

export async function duplicatePresentation(sb: Sb, row: PresentationRow) {
  const copy = checked(
    await sb
      .from('agency_presentations')
      .insert({
        user_id: row.user_id,
        project_id: row.project_id,
        title: `${row.title} (copia)`.slice(0, 200),
        slides: row.slides,
        theme: row.theme,
        warnings: row.warnings,
        quote_id: row.quote_id,
        instruction: row.instruction,
        status: 'ready'
      })
      .select('*')
      .single()
  ).data as PresentationRow
  await snapshot(sb, copy, `Copia di "${row.title}"`)
  return copy
}

export async function deletePresentation(sb: Sb, service: Sb, row: PresentationRow) {
  await removeFolder(service, `${row.user_id}/${row.project_id}/presentations/${row.id}`)
  checked(await sb.from('agency_presentations').delete().eq('user_id', row.user_id).eq('id', row.id))
}

// ---- Viste ----------------------------------------------------------------

export async function signedUrls(service: Sb, assets: AgencyAsset[], ttl = 3600) {
  const images = assets.filter((a) => a.kind === 'photo' || a.kind === 'logo')
  const urls = new Map<string, string>()
  if (!images.length) return urls
  const { data } = await service.storage.from(AGENCY_BUCKET).createSignedUrls(images.map((a) => a.path), ttl)
  for (const entry of data || []) {
    const asset = images.find((a) => a.path === entry.path)
    if (asset && entry.signedUrl) urls.set(asset.id, entry.signedUrl)
  }
  return urls
}

export type PublicAsset = Omit<AgencyAsset, 'path'> & { url: string | null }
const publicAsset = (a: AgencyAsset, urls: Map<string, string>): PublicAsset => {
  const { path: _path, ...rest } = a
  return { ...rest, url: urls.get(a.id) || null }
}

export async function projectView(sb: Sb, service: Sb, row: ProjectRow) {
  const [urls, presentations, quotes, contact, settings, categories] = await Promise.all([
    signedUrls(service, row.assets),
    sb
      .from('agency_presentations')
      .select('id,title,status,slides,quote_id,version,updated_at,approved_at,public_token')
      .eq('user_id', row.user_id)
      .eq('project_id', row.id)
      .order('updated_at', { ascending: false })
      .then(checked),
    projectQuotes(sb, row.user_id, row.id),
    row.contact_id
      ? sb.from('contacts').select('id,name,company,email,phone,status').eq('user_id', row.user_id).eq('id', row.contact_id).maybeSingle().then(checked)
      : Promise.resolve({ data: null }),
    getSettings(sb, row.user_id),
    listCategories(sb, row.user_id)
  ])
  let deal = null
  if (row.deal_id) deal = (await sb.from('deals').select('id,title,stage,closed_at,outcome').eq('user_id', row.user_id).eq('id', row.deal_id).maybeSingle()).data || null
  return {
    ...row,
    client_brand: normalizeClientBrand(row.client_brand),
    analysis: normalizeAnalysis(row.analysis),
    assets: row.assets.map((a) => publicAsset(a, urls)),
    contact: contact.data,
    deal,
    settings,
    categories,
    presentations: ((presentations.data || []) as PresentationRow[]).map(({ slides, ...p }) => ({
      ...p,
      slide_count: (slides || []).length,
      todo: countTodo(normalizeSlides(slides), { hasQuote: Boolean(p.quote_id) })
    })),
    quotes: quotes.map((q) => ({ ...(quoteSummary(q) as QuoteSummary), created_at: String(q.created_at || "") }))
  }
}

export async function presentationView(sb: Sb, service: Sb, row: PresentationRow) {
  const project = await loadProject(sb, row.user_id, row.project_id)
  const [urls, quote, quotes, settings] = await Promise.all([
    signedUrls(service, project.assets),
    row.quote_id ? readQuote(sb, row.user_id, row.quote_id) : Promise.resolve(null),
    projectQuotes(sb, row.user_id, project.id),
    getSettings(sb, row.user_id)
  ])
  const slides = normalizeSlides(row.slides)
  return {
    ...row,
    slides,
    theme: normalizeTheme(row.theme),
    todo: countTodo(slides, { hasQuote: Boolean(row.quote_id) }),
    quote: quoteSummary(quote),
    quotes: quotes.filter((q) => q.status !== 'cancelled').map((q) => ({ id: q.id, number: q.quote_number, title: q.title, total: Number(q.total_amount), currency: q.currency, status: q.status })),
    settings,
    project: {
      id: project.id,
      title: project.title,
      client_name: project.client_name,
      contact_id: project.contact_id,
      client_brand: normalizeClientBrand(project.client_brand),
      analysis: normalizeAnalysis(project.analysis),
      assets: project.assets.map((a) => publicAsset(a, urls))
    }
  }
}

// ---- Vista pubblica e render del PDF -------------------------------------

const renderSecret = () => process.env.AGENCY_RENDER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/**
 * Chiave per far stampare a Chromium una presentazione non ancora approvata. Vale per
 * quella versione soltanto: una modifica la spegne. Senza segreto configurato non esiste.
 */
export function renderKey(token: string, version: number) {
  const secret = renderSecret()
  if (!secret) return ''
  return createHmac('sha256', secret).update(`agency-render:${token}:${version}`).digest('hex')
}

export function validRenderKey(token: string, version: number, key: unknown) {
  const expected = renderKey(token, version)
  if (!expected || typeof key !== 'string' || key.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected))
}

const PUBLIC_URL_TTL_S = 6 * 3600

export async function loadPublicRow(service: Sb, token: string): Promise<PresentationRow | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const { data } = await service.from('agency_presentations').select('*').eq('public_token', token).maybeSingle()
  return (data as PresentationRow) || null
}

export type PublicPresentation = {
  title: string
  slides: AgencySlide[]
  theme: AgencyTheme
  images: Record<string, string>
  client_name: string
  client_logo: string | null
  agency: Pick<AgencySettings, 'name' | 'signature' | 'contact'>
  quote: QuoteSummary | null
  draft: boolean
}

/** Approvata: chi ha il link la vede. Non approvata: solo con la chiave di render (il PDF delle bozze). */
export async function loadPublicPresentation(service: Sb, token: string, key?: string | null): Promise<PublicPresentation | null> {
  const row = await loadPublicRow(service, token)
  if (!row) return null
  const draft = row.status !== 'approved'
  if (draft && !validRenderKey(token, row.version, key)) return null
  const project = checked(await service.from('agency_projects').select('*').eq('id', row.project_id).eq('user_id', row.user_id).maybeSingle()).data as ProjectRow | null
  if (!project) return null
  const slides = normalizeSlides(row.slides)
  const theme = normalizeTheme(row.theme)
  const brand = normalizeClientBrand(project.client_brand)
  const used = new Set(slides.map((s) => s.image_asset_id).filter(Boolean) as string[])
  if (theme.client_logo && brand.logo_asset_id) used.add(brand.logo_asset_id)
  const urls = await signedUrls(service, project.assets.filter((a) => used.has(a.id)), PUBLIC_URL_TTL_S)
  const quoteRow = row.quote_id
    ? (checked(await service.from('quotes').select(QUOTE_FIELDS).eq('id', row.quote_id).eq('user_id', row.user_id).maybeSingle()).data as Record<string, any> | null)
    : null
  const settings = normalizeAgencySettings(
    (checked(await service.from('agency_settings').select('content').eq('user_id', row.user_id).maybeSingle()).data as { content?: unknown } | null)?.content
  )
  const quote = quoteSummary(quoteRow)
  // Il link al preventivo pubblico si mostra solo per un preventivo inviato al cliente.
  if (quote && !['sent', 'accepted', 'paid'].includes(quote.status)) quote.public_token = null
  return {
    title: row.title,
    slides,
    theme,
    images: Object.fromEntries(urls),
    client_name: project.client_name,
    client_logo: theme.client_logo && brand.logo_asset_id ? urls.get(brand.logo_asset_id) || null : null,
    agency: { name: settings.name, signature: settings.signature, contact: settings.contact },
    quote,
    draft
  }
}

// ---- Rotte ----------------------------------------------------------------

export type AgencyAuth = Exclude<Awaited<ReturnType<typeof requireAgencyOwner>>, { error: Response }>

/** Controllo d'accesso + gestione degli errori in un posto solo, per ogni rotta Agency. */
export async function agencyRoute(request: NextRequest, fn: (auth: AgencyAuth) => Promise<unknown>) {
  const auth = await requireAgencyOwner(request)
  if ('error' in auth) return auth.error as Response
  try {
    const result = await fn(auth as AgencyAuth)
    return result instanceof Response ? result : agencyResponse(result)
  } catch (error) {
    return agencyError(error)
  }
}

export async function readFiles(request: NextRequest, maxBytes: number) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new AgencyInputError('Richiesta troppo grande')
  const form = await request.formData()
  const files: UploadedFile[] = []
  for (const value of form.getAll('files')) {
    if (typeof value === 'string' || !value.size) continue
    files.push({ name: value.name, buffer: Buffer.from(await value.arrayBuffer()) })
  }
  for (const value of form.getAll('logo')) {
    if (typeof value === 'string' || !value.size) continue
    files.push({ name: value.name, buffer: Buffer.from(await value.arrayBuffer()), role: 'logo' })
  }
  return { form, files }
}

/** L'agente gira dopo la risposta: la pagina segue lo stato "In generazione". Il catch non è cosmetico (patterns.md). */
export function inBackground(label: string, job: () => Promise<unknown>) {
  void job().catch((error) => console.error(`Speaqi Agency: ${label} non riuscita`, { message: String((error as Error)?.message || error).slice(0, 300) }))
}
