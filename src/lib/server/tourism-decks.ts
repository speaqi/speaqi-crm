import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { quoteSummary } from '../agency'
import {
  DEFAULT_DECK_TEMPLATE,
  PARTNER_DECK_TEMPLATE,
  deckModel,
  applyVars,
  assignPhotos,
  countTodo,
  photoSlots,
  normalizeSlide,
  normalizeTemplate,
  type DeckInput,
  type DeckSlide,
  type DeckStatus,
  type DeckTemplate,
  type DeckWarning
} from '../tourism-deck'
import { TOURISM_TYPES, TourismInputError } from '../tourism'
import {
  DECK_BUCKET,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  documentText,
  photoForModel,
  safeFileName,
  sniffUpload,
  storagePath,
  type DeckAsset
} from './tourism-deck-assets'
import { runDeckAgent, type DeckAgentArgs, type DeckAgentResult, type DeckEntityContext, type DeckMaterials } from './tourism-deck-agent'
import { findDestinationPhotos, type DestinationPhoto } from './tourism-deck-photos'

type Sb = any

export type DeckRow = {
  id: string
  user_id: string
  entity_id: string | null
  title: string
  destination: string
  input: DeckInput
  notes: string
  assets: DeckAsset[]
  slides: DeckSlide[]
  warnings: DeckWarning[]
  status: DeckStatus
  error: string | null
  public_token: string
  generated_at: string | null
  approved_at: string | null
  version: number
  created_at: string
  updated_at: string
}

const GENERATING_STALE_MS = 6 * 60_000
const PUBLIC_URL_TTL_S = 6 * 3600
const checked = <T extends { error: unknown }>(result: T): T => {
  if (result.error) throw result.error
  return result
}

// ---- Modello generico -----------------------------------------------------

export async function getTemplate(sb: Sb, userId: string): Promise<{ template: DeckTemplate; version: number }> {
  const found = checked(await sb.from('tourism_deck_templates').select('content,version').eq('user_id', userId).eq('is_default', true).maybeSingle())
  if (found.data) {
    // Un modello senza `base` è precedente alla presentazione destinazioni di ottobre 2026:
    // si sostituisce una volta con quella. Uno salvato dopo (anche la base aziende) resta.
    if (found.data.content?.base) return { template: normalizeTemplate(found.data.content), version: found.data.version }
    const upgraded = checked(
      await sb
        .from('tourism_deck_templates')
        .update({ content: DEFAULT_DECK_TEMPLATE, version: found.data.version + 1, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_default', true)
        .eq('version', found.data.version)
        .select('content,version')
        .maybeSingle()
    )
    // Due richieste insieme: vince la prima, l'altra rilegge.
    if (!upgraded.data) return getTemplate(sb, userId)
    return { template: normalizeTemplate(upgraded.data.content), version: upgraded.data.version }
  }
  const created = checked(
    await sb.from('tourism_deck_templates').insert({ user_id: userId, content: DEFAULT_DECK_TEMPLATE }).select('content,version').single()
  )
  return { template: normalizeTemplate(created.data.content), version: created.data.version }
}

export async function saveTemplate(sb: Sb, userId: string, raw: unknown, version: number) {
  const read = normalizeTemplate(raw)
  // Un modello salvato a mano non si sostituisce mai da solo, anche se arriva senza base.
  const template = { ...read, base: read.base || 'personalizzato' }
  const current = await getTemplate(sb, userId)
  if (current.version !== version) throw new Error('Version conflict: il modello è stato cambiato altrove, ricarica.')
  const updated = checked(
    await sb
      .from('tourism_deck_templates')
      .update({ content: template, version: version + 1, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_default', true)
      .eq('version', version)
      .select('content,version')
      .maybeSingle()
  )
  if (!updated.data) throw new Error('Version conflict: il modello è stato cambiato altrove, ricarica.')
  return { template: normalizeTemplate(updated.data.content), version: updated.data.version as number }
}

// ---- Deck -----------------------------------------------------------------

export async function loadDeck(sb: Sb, userId: string, id: string): Promise<DeckRow> {
  const { data } = checked(await sb.from('tourism_decks').select('*').eq('user_id', userId).eq('id', id).maybeSingle())
  if (!data) throw new TourismInputError('Presentazione non trovata')
  return data as DeckRow
}

/**
 * Il modello di un deck: per un partner la base partner (scritta nel codice, uguale per tutti),
 * per un ente il modello salvato dal titolare. Lo decide il deck, quindi una rigenerazione
 * non cambia base.
 */
export async function templateForDeck(sb: Sb, userId: string, input: DeckInput | null | undefined): Promise<DeckTemplate> {
  if (deckModel(input) === 'partner') return structuredClone(PARTNER_DECK_TEMPLATE)
  return (await getTemplate(sb, userId)).template
}

export type DeckFields = {
  destination: string
  input: DeckInput
  notes: string
  entity_id: string | null
}

export async function createDeck(sb: Sb, userId: string, fields: DeckFields, id?: string): Promise<DeckRow> {
  if (fields.entity_id) {
    const entity = checked(await sb.from('tourism_entities').select('id').eq('user_id', userId).eq('id', fields.entity_id).maybeSingle())
    if (!entity.data) throw new TourismInputError('Ente non trovato')
  }
  const template = await templateForDeck(sb, userId, fields.input)
  const slides = applyVars(template, fields.input)
  const ente = fields.input.ente || fields.destination
  const row = checked(
    await sb
      .from('tourism_decks')
      .insert({
        ...(id ? { id } : {}),
        user_id: userId,
        entity_id: fields.entity_id,
        title: `${fields.destination} · ${ente}`.slice(0, 200),
        destination: fields.destination,
        input: fields.input,
        notes: fields.notes,
        slides
      })
      .select('*')
      .single()
  )
  return row.data as DeckRow
}

export async function entityContext(sb: Sb, userId: string, entityId: string | null): Promise<DeckEntityContext | undefined> {
  if (!entityId) return undefined
  const entity = checked(await sb.from('tourism_entities').select('name,type_code,country_code,website,details').eq('user_id', userId).eq('id', entityId).maybeSingle()).data
  if (!entity) return undefined
  const sources = checked(await sb.from('tourism_site_sources').select('id').eq('user_id', userId).eq('entity_id', entityId)).data as { id: string }[] | null
  let places: string[] = []
  if (sources?.length) {
    const pois = checked(
      await sb
        .from('tourism_poi_candidates')
        .select('name')
        .eq('user_id', userId)
        .eq('state', 'approved')
        .in('source_id', sources.map((s) => s.id))
        .limit(30)
    ).data as { name: string }[] | null
    places = (pois || []).map((p) => p.name)
  }
  return {
    name: entity.name,
    type: entity.type_code ? (TOURISM_TYPES as Record<string, string>)[entity.type_code] || entity.type_code : undefined,
    country: entity.country_code || undefined,
    website: entity.website || undefined,
    description: typeof entity.details?.description === 'string' ? entity.details.description.slice(0, 1500) : undefined,
    verified_places: places
  }
}

// ---- Foto e documenti -----------------------------------------------------

let bucketReady = false
export async function ensureDeckBucket(service: Sb) {
  if (bucketReady) return
  const { data } = await service.storage.getBucket(DECK_BUCKET)
  if (!data) {
    const created = await service.storage.createBucket(DECK_BUCKET, { public: false })
    if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error
  }
  bucketReady = true
}

export type UploadedFile = { name: string; buffer: Buffer } & Pick<DeckAsset, 'source' | 'credit' | 'source_url'>

/** Controlla, salva su Storage e registra sul deck. Tutto o niente sui limiti; un file non valido ferma la richiesta. */
export async function addAssets(sb: Sb, service: Sb, row: DeckRow, files: UploadedFile[]): Promise<DeckAsset[]> {
  const next: DeckAsset[] = []
  let photos = row.assets.filter((a) => a.kind === 'photo').length
  let documents = row.assets.filter((a) => a.kind === 'document').length
  for (const file of files) {
    const name = safeFileName(file.name)
    const sniffed = sniffUpload(file.buffer, name)
    if (!sniffed) throw new TourismInputError(`"${name}": formato non supportato (foto JPG, PNG, WebP; documenti PDF, Word, TXT o MD)`)
    if (sniffed.kind === 'photo') {
      if (file.buffer.length > MAX_PHOTO_BYTES) throw new TourismInputError(`"${name}": la foto supera ${MAX_PHOTO_BYTES / 1048576} MB`)
      if (++photos > MAX_PHOTOS) throw new TourismInputError(`Al massimo ${MAX_PHOTOS} foto per presentazione`)
    } else {
      if (file.buffer.length > MAX_DOCUMENT_BYTES) throw new TourismInputError(`"${name}": il documento supera ${MAX_DOCUMENT_BYTES / 1048576} MB`)
      if (++documents > MAX_DOCUMENTS) throw new TourismInputError(`Al massimo ${MAX_DOCUMENTS} documenti per presentazione`)
    }
    const id = randomUUID()
    next.push({
      id, kind: sniffed.kind, name, mime: sniffed.mime, size: file.buffer.length, path: storagePath(row.user_id, row.id, id, sniffed.ext),
      ...(file.source ? { source: file.source } : {}),
      ...(file.credit ? { credit: file.credit.slice(0, 200) } : {}),
      ...(file.source_url ? { source_url: file.source_url.slice(0, 500) } : {})
    })
  }
  if (!next.length) return []
  await ensureDeckBucket(service)
  const stored: DeckAsset[] = []
  try {
    for (const [i, asset] of next.entries()) {
      const up = await service.storage.from(DECK_BUCKET).upload(asset.path, files[i].buffer, { contentType: asset.mime, upsert: false })
      if (up.error) throw up.error
      stored.push(asset)
    }
    checked(await sb.from('tourism_decks').update({ assets: [...row.assets, ...next], updated_at: new Date().toISOString() }).eq('user_id', row.user_id).eq('id', row.id))
  } catch (error) {
    if (stored.length) await service.storage.from(DECK_BUCKET).remove(stored.map((a) => a.path))
    throw error
  }
  row.assets = [...row.assets, ...next]
  return next
}

export async function removeAsset(sb: Sb, service: Sb, row: DeckRow, assetId: string) {
  const asset = row.assets.find((a) => a.id === assetId)
  if (!asset) throw new TourismInputError('File non trovato')
  const assets = row.assets.filter((a) => a.id !== assetId)
  // Una foto tolta non può restare scelta da una slide.
  const slides = row.slides.map((s) => (s.image_asset_id === assetId ? { ...s, image_asset_id: null } : s))
  checked(await sb.from('tourism_decks').update({ assets, slides, updated_at: new Date().toISOString() }).eq('user_id', row.user_id).eq('id', row.id))
  await service.storage.from(DECK_BUCKET).remove([asset.path])
  row.assets = assets
  row.slides = slides
}

export async function deleteDeck(sb: Sb, service: Sb, row: DeckRow) {
  // Foto, documenti e PDF generati: tutto ciò che sta nella cartella del deck.
  const folder = `${row.user_id}/${row.id}`
  const listing = await service.storage.from(DECK_BUCKET).list(folder)
  const paths = new Set([...row.assets.map((a) => a.path), ...((listing?.data || []) as { name: string }[]).map((f) => `${folder}/${f.name}`)])
  if (paths.size) await service.storage.from(DECK_BUCKET).remove([...paths])
  checked(await sb.from('tourism_decks').delete().eq('user_id', row.user_id).eq('id', row.id))
}

const MAX_PDF_TOTAL_BYTES = 20 * 1024 * 1024

export async function loadMaterials(service: Sb, row: DeckRow): Promise<{ materials: DeckMaterials; skipped: string[] }> {
  const materials: DeckMaterials = { documents: [], photos: [] }
  const skipped: string[] = []
  let pdfBytes = 0
  for (const asset of row.assets) {
    const file = await service.storage.from(DECK_BUCKET).download(asset.path)
    if (file.error || !file.data) {
      skipped.push(`${asset.name}: non scaricabile`)
      continue
    }
    const buffer = Buffer.from(await file.data.arrayBuffer())
    if (asset.kind === 'photo') {
      const photo = await photoForModel(buffer)
      if (!photo) skipped.push(`${asset.name}: foto non elaborabile, non letta dall'agente`)
      else materials.photos.push({ id: asset.id, name: asset.name, dataUrl: `data:${photo.mime};base64,${photo.data.toString('base64')}` })
    } else if (asset.mime === 'application/pdf') {
      if (pdfBytes + buffer.length > MAX_PDF_TOTAL_BYTES) skipped.push(`${asset.name}: PDF oltre il limite complessivo, non letto`)
      else {
        pdfBytes += buffer.length
        materials.documents.push({ name: asset.name, pdf: { filename: asset.name, dataUrl: `data:application/pdf;base64,${buffer.toString('base64')}` } })
      }
    } else {
      try {
        const { text, truncated } = documentText(buffer, asset.mime === 'text/plain' ? 'text' : 'docx')
        materials.documents.push({ name: asset.name, text, truncated })
      } catch {
        skipped.push(`${asset.name}: testo non leggibile`)
      }
    }
  }
  return { materials, skipped }
}

// ---- Foto della destinazione -----------------------------------------------

export type PhotoFinder = (destination: string, count: number) => Promise<{ photos: DestinationPhoto[]; note: string | null }>

/**
 * Se mancano foto per le slide che ne vogliono una, le cerca su Wikimedia Commons e le
 * aggiunge ai materiali del deck, con autore e licenza. Una volta sola per deck: foto
 * trovate e poi tolte a mano non tornano. Non lancia: un problema diventa un avviso.
 */
export async function addDestinationPhotos(sb: Sb, service: Sb, row: DeckRow, template: DeckTemplate, find: PhotoFinder = findDestinationPhotos): Promise<string | null> {
  if (row.assets.some((a) => a.source === 'wikimedia')) return null
  const photos = row.assets.filter((a) => a.kind === 'photo').length
  const wanted = Math.min(photoSlots(template.slides).length - photos, MAX_PHOTOS - photos)
  if (wanted <= 0 || !row.destination?.trim()) return null
  try {
    const found = await find(row.destination, wanted)
    if (found.photos.length) {
      await addAssets(sb, service, row, found.photos.map((p) => ({ name: p.name, buffer: p.buffer, source: 'wikimedia', credit: p.credit, source_url: p.source_url })))
    }
    return found.note
  } catch (error) {
    return `Foto della destinazione non aggiunte: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`
  }
}

/**
 * Foto arrivate fuori dall'editor (un ordine su Telegram): si aggiungono ai materiali e vanno
 * subito sulle slide, al posto delle immagini di esempio e delle foto trovate su Commons.
 * Nessun modello, nessuna spesa. Una presentazione approvata torna in revisione, come per
 * ogni modifica. Oltre il massimo di foto, quelle in più restano fuori e lo si dice.
 */
export async function addPhotosToDeck(sb: Sb, service: Sb, row: DeckRow, files: UploadedFile[]): Promise<{ deck: DeckRow; added: number; skipped: number }> {
  // La stessa foto rimandata (o lo stesso ordine riletto da un altro giro) non si aggiunge due volte.
  const seen = new Set(row.assets.map((a) => a.source_url).filter(Boolean))
  const fresh = files.filter((f) => !f.source_url || !seen.has(f.source_url))
  const room = Math.max(0, MAX_PHOTOS - row.assets.filter((a) => a.kind === 'photo').length)
  const take = fresh.slice(0, room)
  if (!take.length) return { deck: row, added: 0, skipped: fresh.length }
  const added = await addAssets(sb, service, row, take)
  // Una generazione in corso riscrive le slide: le foto restano nei materiali e le usa lei.
  if (row.status === 'generating') return { deck: row, added: added.length, skipped: fresh.length - take.length }
  const found = new Set(row.assets.filter((a) => a.source === 'wikimedia').map((a) => a.id))
  const released = row.slides.map((s) => (s.image_asset_id && found.has(s.image_asset_id) ? { ...s, image_asset_id: null } : s))
  const slides = assignPhotos(released, deckPhotoIds(row.assets))
  const updated = checked(
    await sb
      .from('tourism_decks')
      .update({ slides, version: row.version + 1, status: row.status === 'approved' ? 'ready' : row.status, approved_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', row.version)
      .select('*')
      .maybeSingle()
  )
  return { deck: (updated.data as DeckRow) || row, added: added.length, skipped: fresh.length - take.length }
}

/** Le foto del deck in ordine di preferenza: prima quelle scelte da chi lavora, poi quelle trovate. */
export const deckPhotoIds = (assets: DeckAsset[]) => {
  const photos = assets.filter((a) => a.kind === 'photo')
  return [...photos.filter((a) => a.source !== 'wikimedia'), ...photos.filter((a) => a.source === 'wikimedia')].map((a) => a.id)
}

// ---- Generazione ----------------------------------------------------------

/**
 * Fa girare l'agente e salva. Una generazione alla volta per deck (UPDATE condizionato);
 * se l'agente fallisce il deck resta con le slide che aveva e lo stato "failed" col motivo:
 * si può sempre correggere a mano.
 */
export async function generateIntoDeck(sb: Sb, service: Sb, row: DeckRow, instruction?: string,
  agent: (args: DeckAgentArgs) => Promise<DeckAgentResult> = runDeckAgent, findPhotos: PhotoFinder = findDestinationPhotos): Promise<DeckRow> {
  const stale = new Date(Date.now() - GENERATING_STALE_MS).toISOString()
  // Due UPDATE condizionali, non un `.or()`: con PostgREST il filtro `or` di un UPDATE vale
  // anche per la risposta (la riga è già "generating"), e con select('id') la colonna
  // updated_at mancante faceva fallire la richiesta (42703). Ognuno dei due è atomico.
  const claim = () =>
    sb
      .from('tourism_decks')
      .update({ status: 'generating', error: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
  let claimed = checked(await claim().neq('status', 'generating').select('id').maybeSingle())
  if (!claimed.data) claimed = checked(await claim().eq('status', 'generating').lt('updated_at', stale).select('id').maybeSingle())
  if (!claimed.data) throw new Error('Generazione già in corso per questa presentazione (already running)')
  try {
    const template = await templateForDeck(sb, row.user_id, row.input)
    const photoNote = await addDestinationPhotos(sb, service, row, template, findPhotos)
    const { materials, skipped } = await loadMaterials(service, row)
    const entity = await entityContext(sb, row.user_id, row.entity_id)
    const result = await agent({
      template,
      input: row.input,
      notes: row.notes,
      entity,
      materials,
      instruction: instruction?.trim().slice(0, 1000) || undefined
    })
    const warnings: DeckWarning[] = [
      ...result.warnings,
      ...(photoNote ? [{ slide: '*', message: photoNote }] : []),
      ...skipped.map((message) => ({ slide: '*', message })),
      ...result.missing.map((m) => ({ slide: '*', message: `Manca: ${m}` }))
    ]
    const updated = checked(
      await sb
        .from('tourism_decks')
        .update({
          // Le foto le assegna il codice: tre diverse, mai l'immagine di esempio se c'è una foto vera.
          slides: assignPhotos(result.slides, deckPhotoIds(row.assets)),
          warnings,
          status: 'ready',
          error: null,
          generated_at: new Date().toISOString(),
          approved_at: null,
          version: row.version + 1,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', row.user_id)
        .eq('id', row.id)
        .select('*')
        .single()
    )
    return updated.data as DeckRow
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Errore sconosciuto').slice(0, 500)
    console.error('Generazione presentazione non riuscita', { deck: row.id, message })
    const failed = checked(
      await sb
        .from('tourism_decks')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('id', row.id)
        .select('*')
        .single()
    )
    return failed.data as DeckRow
  }
}

// ---- Modifica e approvazione ----------------------------------------------

export async function saveDeckEdits(
  sb: Sb,
  row: DeckRow,
  edits: { version: number; slides?: unknown; title?: unknown; notes?: unknown }
): Promise<DeckRow> {
  if (row.status === 'generating') throw new TourismInputError('Generazione in corso: riprova tra poco')
  const patch: Record<string, unknown> = {}
  if (Array.isArray(edits.slides)) {
    const ids = new Set(row.assets.filter((a) => a.kind === 'photo').map((a) => a.id))
    const slides = edits.slides.slice(0, 12).map((s, i) => normalizeSlide(s, i))
    patch.slides = slides.map((s) => ({ ...s, image_asset_id: s.image_asset_id && ids.has(s.image_asset_id) ? s.image_asset_id : null }))
    if (!slides.length) throw new TourismInputError('Serve almeno una slide')
  }
  if (typeof edits.title === 'string' && edits.title.trim()) patch.title = edits.title.trim().slice(0, 200)
  if (typeof edits.notes === 'string') patch.notes = edits.notes.slice(0, 30000)
  if (!Object.keys(patch).length) return row
  // Una presentazione approvata e poi modificata torna da approvare.
  if (row.status === 'approved') Object.assign(patch, { status: 'ready', approved_at: null })
  const updated = checked(
    await sb
      .from('tourism_decks')
      .update({ ...patch, version: edits.version + 1, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', edits.version)
      .select('*')
      .maybeSingle()
  )
  if (!updated.data) throw new Error('Version conflict: la presentazione è stata cambiata altrove, ricarica.')
  return updated.data as DeckRow
}

export async function setApproval(sb: Sb, row: DeckRow, approve: boolean): Promise<DeckRow> {
  if (approve) {
    if (row.status === 'generating') throw new TourismInputError('Generazione in corso: riprova tra poco')
    const todo = countTodo(row.slides)
    if (todo > 0) throw new TourismInputError(`Restano ${todo} [DA VERIFICARE]: completali prima di approvare`)
  }
  const updated = checked(
    await sb
      .from('tourism_decks')
      .update(approve ? { status: 'approved', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { status: 'ready', approved_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('id', row.id)
      .eq('version', row.version)
      .select('*')
      .maybeSingle()
  )
  if (!updated.data) throw new Error('Version conflict: la presentazione è stata cambiata altrove, ricarica.')
  return updated.data as DeckRow
}

// ---- Vista -----------------------------------------------------------------

export type DeckView = {
  quotes?: { id: string; number: string; title: string; status: string; total: number; currency: string }[]
  id: string
  title: string
  destination: string
  entity_id: string | null
  entity_name: string | null
  status: DeckStatus
  error: string | null
  input: DeckInput
  notes: string
  assets: (Omit<DeckAsset, 'path'> & { url: string | null })[]
  slides: DeckSlide[]
  warnings: DeckWarning[]
  todo: number
  version: number
  public_token: string
  generated_at: string | null
  approved_at: string | null
  updated_at: string
}

export async function signedAssetUrls(service: Sb, assets: DeckAsset[], ttl = 3600) {
  const photos = assets.filter((a) => a.kind === 'photo')
  const urls = new Map<string, string>()
  if (!photos.length) return urls
  const { data } = await service.storage.from(DECK_BUCKET).createSignedUrls(photos.map((a) => a.path), ttl)
  for (const entry of data || []) {
    const asset = photos.find((a) => a.path === entry.path)
    if (asset && entry.signedUrl) urls.set(asset.id, entry.signedUrl)
  }
  return urls
}

export async function toView(sb: Sb, service: Sb, row: DeckRow): Promise<DeckView> {
  const urls = await signedAssetUrls(service, row.assets)
  let entityName: string | null = null
  if (row.entity_id) {
    entityName = (checked(await sb.from('tourism_entities').select('name').eq('user_id', row.user_id).eq('id', row.entity_id).maybeSingle()).data?.name as string) || null
  }
  return {
    quotes: (await deckQuotes(sb, row)).map((q: any) => ({ id: q.id, number: q.quote_number, title: q.title, status: q.status, total: Number(q.total_amount), currency: q.currency })),
    id: row.id,
    title: row.title,
    destination: row.destination,
    entity_id: row.entity_id,
    entity_name: entityName,
    status: row.status,
    error: row.error,
    input: row.input,
    notes: row.notes,
    assets: row.assets.map(({ path: _path, ...a }) => ({ ...a, url: urls.get(a.id) || null })),
    slides: row.slides,
    warnings: row.warnings,
    todo: countTodo(row.slides),
    version: row.version,
    public_token: row.public_token,
    generated_at: row.generated_at,
    approved_at: row.approved_at,
    updated_at: row.updated_at
  }
}

/** Solo una presentazione approvata si vede da fuori, a chi ha il token. */
/**
 * Chiave con cui Chromium apre una presentazione non ancora approvata per stamparne il PDF:
 * vale per quella sola versione (una modifica la invalida) e non la conosce nessun altro,
 * quindi il link pubblico di una bozza resta chiuso. Stesso segreto di Speaqi Agency.
 */
export function deckRenderKey(token: string, version: number) {
  const secret = process.env.AGENCY_RENDER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!secret) return ''
  return createHmac('sha256', secret).update(`tourism-render:${token}:${version}`).digest('hex')
}

export function validDeckRenderKey(token: string, version: number, key: unknown) {
  const expected = deckRenderKey(token, version)
  if (!expected || typeof key !== 'string' || key.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected))
}

/** Solo approvate; una bozza solo con la chiave di render della sua versione (il PDF). */
export async function loadPublicRow(service: Sb, token: string, render?: string): Promise<DeckRow | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  let query = service.from('tourism_decks').select('*').eq('public_token', token)
  if (!render) query = query.eq('status', 'approved')
  const { data } = await query.maybeSingle()
  const row = (data as DeckRow) || null
  if (!row || row.status === 'approved') return row
  return row.status !== 'generating' && validDeckRenderKey(token, row.version, render) ? row : null
}

export async function loadPublicDeck(service: Sb, token: string, render?: string) {
  const row = await loadPublicRow(service, token, render)
  if (!row) return null
  const urls = await signedAssetUrls(service, row.assets.filter((a) => row.slides.some((s) => s.image_asset_id === a.id)), PUBLIC_URL_TTL_S)
  const quotes = await deckQuotes(service, row)
  const quote = quoteSummary(quotes.find((q: any) => ['sent', 'accepted', 'paid'].includes(q.status)))
  const credits = Object.fromEntries(row.assets.filter((a) => a.credit && urls.has(a.id)).map((a) => [a.id, a.credit as string]))
  return { title: row.title, destination: row.destination, slides: row.slides, images: Object.fromEntries(urls), credits, quote }
}

/** Una migration non ancora applicata non deve oscurare le presentazioni esistenti. */
async function deckQuotes(sb: Sb, row: Pick<DeckRow, 'id' | 'user_id'>): Promise<any[]> {
  const { data, error } = await sb.from('quotes').select('id,quote_number,title,status,total_amount,currency,public_token,created_at,items,subtotal_amount,discount_amount,tax_rate,tax_amount,deposit_amount,payment_terms_note,public_note,valid_until,billing_interval').eq('user_id', row.user_id).eq('tourism_deck_id', row.id).order('created_at', { ascending: false })
  if (error && /42703|PGRST204/.test(String(error.code)) && /tourism_deck_id/.test(String(error.message))) return []
  if (error) throw error
  return data || []
}
