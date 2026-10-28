import { createHash, randomUUID } from 'node:crypto'
import { BudgetExceeded, callModel, runAgent, type AgentContext } from './office-agents'
import { officeIsNaples } from '../office/director'
import { EXONYMS, nameKey } from '../office/entity-enricher'
import { TOURISM_TYPES } from '../tourism'
import { readEntitySite } from './office-agents/entity-enricher'
import { officeDeckAgent, presentationEntities } from './office-agents/presentations'
import { sendDeckToTelegram } from './office-deck-telegram'
import { officeAgentHandler } from './office-agents/registry'
import { officeRows } from './office-read'
import { createLeadFromInput } from './lead-ops'
import { loadDirectorPlan } from './opportunities'
import { directorPlanBrief } from '../office/director-plan'
import { photoForModel, sniffUpload, safeFileName } from './tourism-deck-assets'
import { errorMessage } from './http'
import { searchPattern } from '../command-center'
import { officeRomeDay } from '../office/finance'
import {
  CONTACT_CATEGORY_LABELS, DIRECTOR_ORDER_SCHEMA, contactNextStep, directorOrderPrompt, directorStatusLines,
  directorEventsReply, directorEventSourcesReply, directorInvoiceReply, directorQuoteLabel, interpretDirectorOrder, queuedWorkReport, quoteIsInvoiceable,
  directorHelpText, emailFromSite, looksLikeTourismBody, parsePartnerSearch, partnerSearchPrompt, PARTNER_SEARCH_SCHEMA, PARTNER_TYPE_CODES,
  directorTaskDue, directorTaskReply, pickPresentationRecipient, presentationEmail, directorFollowUp, readAwaiting, AWAITING_TTL_MS,
  type DirectorAwaiting, type DirectorEventRow, type DirectorEventSourcesResult, type DirectorInvoiceQuote, type DirectorOrderPlan, type DirectorTaskItem, type DirectorTaskOutcome, type QueuedWork,
} from '../office/director-orders'
import { addTaskToCalendar } from './gcal'
import { sendNotificationText } from './whatsapp'
import { createServiceRoleClient } from './supabase'
import { activateEntityForOrder, verifiedDestination, type ActivationEntity } from './office-entity-activation'
import { enqueueOfficeWork, missingWorkSchema, officeWorkEnabled, QUEUE_WORK_ACTION } from './office-work-routing'
import { cityForEntity, compactName, entitySearchPattern, pickOrderEntity, siteMatchesEntity, websiteFromText } from '../office/entity-activation'
import { DIRECTOR_BUCKET, directorPhotoFiles } from './office-director-photos'
import { OfficeStudioError, officeStudioRequest } from './office-agents/maps-bridge'
import { addPhotosToDeck, createDeck, generateIntoDeck, type DeckRow } from './tourism-decks'

const TOURISM_TYPE_LABEL = (code: string | null) => (code && (TOURISM_TYPES as Record<string, string>)[code])
  || (code === 'accommodation' ? 'Struttura ricettiva' : code === 'transport' ? 'Trasporti' : 'Operatore')
import { isGmailReconnectRequired, openGmailDraftSession, saveContactDraftWithSession, simpleTextToHtml } from './gmail'
import { gmailDraftUrl } from './trade-fair-gmail-draft'
import { createInvoiceDraftFromQuote, invoiceProblems, loadInvoiceSettings } from './invoices'

/**
 * Ordini al Direttore. Tre garanzie da non smontare:
 * 1. L'ordine si salva PRIMA di qualunque lavoro: un guasto lascia la traccia.
 * 2. Il lavoro è una corsa del Direttore con chiave order:<id>: budget prenotato,
 *    interruttore rispettato, e rielaborare lo stesso ordine non spende due volte.
 * 3. Nessuna scrittura sul CRM prima del clic, salvo le attività To Do del titolare
 *    (personali, come dal bot Telegram) e le code degli agenti, che lavorano solo
 *    se il loro interruttore è acceso.
 */

export { DIRECTOR_BUCKET }
export const MAX_ORDER_FILES = 4
export const MAX_ORDER_FILE_BYTES = 8 * 1024 * 1024
const ORDER_MODEL_OUTPUT_TOKENS = 1500

export type DirectorOrderRow = {
  id: string; user_id: string; source: 'web' | 'telegram'; text: string
  attachments: Array<{ path: string; name: string; mime: string; bytes: number }>
  status: 'received' | 'working' | 'done' | 'waiting_you' | 'failed' | 'waiting' | 'blocked' | 'cancelled'; intent: string | null
  interpretation: Record<string, unknown> | null; reply: string | null; output_ids: string[]
  queued: Array<Record<string, unknown>>; telegram_chat_id: string | null; run_id: string | null
  error: string | null; created_at: string; updated_at: string
}
export type OrderFile = { name: string; buffer: Buffer }
type Admin = any

let bucketReady = false
async function ensureDirectorBucket(admin: Admin) {
  if (bucketReady) return
  const { data } = await admin.storage.getBucket(DIRECTOR_BUCKET)
  if (!data) {
    const created = await admin.storage.createBucket(DIRECTOR_BUCKET, { public: false })
    if (created.error && !/already exists/i.test(created.error.message || '')) throw created.error
  }
  bucketReady = true
}

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

/** Controlla i file prima di scrivere: un file non valido ferma l'ordine intero. */
export function validateOrderFiles(files: OrderFile[]) {
  if (files.length > MAX_ORDER_FILES) throw new Error(`Al massimo ${MAX_ORDER_FILES} foto per ordine`)
  return files.map((file) => {
    if (file.buffer.length > MAX_ORDER_FILE_BYTES) throw new Error(`${safeFileName(file.name)}: più di 8 MB`)
    const sniffed = sniffUpload(file.buffer, file.name)
    if (sniffed?.kind !== 'photo') throw new Error(`${safeFileName(file.name)}: servono foto JPG, PNG o WebP`)
    return { ...file, name: safeFileName(file.name) }
  })
}

export async function createDirectorOrder(admin: Admin, userId: string, input: {
  source: 'web' | 'telegram'; text: string; files?: OrderFile[]; telegramChatId?: string | null
}): Promise<DirectorOrderRow> {
  const text = String(input.text || '').trim().slice(0, 4000)
  const files = validateOrderFiles(input.files || [])
  if (!text && !files.length) throw new Error('Scrivi qualcosa al Direttore o allega una foto')
  const order = checked(await admin.from('office_director_orders').insert({
    user_id: userId, source: input.source, text, telegram_chat_id: input.telegramChatId || null,
    ...(files.length ? { status: 'working', interpretation: { intake: 'attachments' } } : {}),
  }).select('*').single()) as DirectorOrderRow
  if (!files.length) return order
  try {
    await ensureDirectorBucket(admin)
    const attachments = []
    for (const file of files) {
      // Si conserva la foto ridotta: è quella che legge il modello, e pesa poco.
      const photo = await photoForModel(file.buffer)
      if (!photo) throw new Error(`${file.name}: foto non leggibile`)
      const path = `${userId}/${order.id}/${randomUUID()}.jpg`
      const uploaded = await admin.storage.from(DIRECTOR_BUCKET).upload(path, photo.data, { contentType: 'image/jpeg', upsert: false })
      if (uploaded.error) throw uploaded.error
      attachments.push({ path, name: file.name, mime: 'image/jpeg', bytes: photo.data.length })
    }
    return checked(await admin.from('office_director_orders').update({ attachments, status: 'received', interpretation: null }).eq('id', order.id).eq('user_id', userId).select('*').single())
  } catch (error) {
    await admin.from('office_director_orders').update({ status: 'failed', error: errorMessage(error, 'Foto non salvate'),
      reply: 'Non sono riuscito a salvare le foto. Riprova.' }).eq('id', order.id)
    throw error
  }
}

export async function listDirectorOrders(admin: Admin, userId: string, limit = 20): Promise<DirectorOrderRow[]> {
  return checked(await admin.from('office_director_orders').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(limit)) || []
}

export async function orderImages(admin: Admin, order: DirectorOrderRow): Promise<string[]> {
  const images: string[] = []
  for (const attachment of order.attachments || []) {
    const { data, error } = await admin.storage.from(DIRECTOR_BUCKET).download(attachment.path)
    if (error || !data) throw new Error('Foto dell’ordine non leggibile')
    images.push(`data:image/jpeg;base64,${Buffer.from(await data.arrayBuffer()).toString('base64')}`)
  }
  return images
}

type QueueResult = { agent: string; queued: boolean; enabled: boolean; reason?: string }
export async function queueForAgent(admin: Admin, userId: string, agentId: string, entry: Record<string, unknown>): Promise<QueueResult> {
  if (officeWorkEnabled()) {
    const action = QUEUE_WORK_ACTION[agentId]
    if (!action) return { agent: agentId, queued: false, enabled: false, reason: 'agent_missing' }
    const { key, origin: _origin, queued_at: _queuedAt, ...payload } = entry
    await enqueueOfficeWork(admin, userId, { agent_id: agentId, action, origin: 'approval',
      order_id: typeof entry.order_id === 'string' ? entry.order_id : null,
      source_key: `queue:${agentId}:${String(key || '')}`, payload, status: 'ready' })
    const agent = checked(await admin.from('office_agents').select('enabled').eq('id', agentId).eq('user_id', userId).maybeSingle()) as { enabled: boolean } | null
    return { agent: agentId, queued: true, enabled: !!agent?.enabled }
  }
  const { data, error } = await admin.rpc('office_director_queue', { p_user_id: userId, p_agent_id: agentId, p_entry: entry })
  if (error) throw error
  return { agent: agentId, queued: !!data?.queued, enabled: !!data?.enabled, reason: data?.reason }
}

const AGENT_NAMES: Record<string, string> = {
  mymaps_builder: 'Costruttore My Maps', maps_quality: 'Controllo qualità mappe', presentations: 'Presentazioni', agency: 'Agenzia',
  languages_voice: 'Lingue e voce',
}

function queueSentence(result: QueueResult) {
  const name = AGENT_NAMES[result.agent] || result.agent
  if (result.reason === 'agent_missing') return `L’agente ${name} non è ancora installato: il lavoro non è stato accodato.`
  const what = result.queued ? `Ho passato il lavoro a ${name}`
    : result.reason === 'updated' ? `${name} lo aveva già in coda: ho aggiornato la voce con i dati nuovi`
    : `${name} lo aveva già in coda`
  return result.enabled ? `${what}, che parte adesso.` : `${what}. È spento: accendilo dall’Ufficio (scheda Squadra) e premi «Fai girare adesso».`
}

const BUSY_RETRY_MS = 20_000
const BUSY_RETRIES = 9

/**
 * Un agente occupato da un'altra corsa non è un errore: si aspetta e si riprova
 * (al più tre minuti), invece di chiedere al titolare di rimandare l'ordine.
 */
export async function runAgentWhenFree(agentId: string, handler: Parameters<typeof runAgent>[1], options: Parameters<typeof runAgent>[2],
  wait: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const sleep = wait.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let result = await runAgent(agentId, handler, options)
  for (let attempt = 0; result.skipped === 'running' && attempt < (wait.retries ?? BUSY_RETRIES); attempt += 1) {
    await sleep(wait.delayMs ?? BUSY_RETRY_MS)
    result = await runAgent(agentId, handler, options)
  }
  return result
}

/** Un agente acceso a cui è appena arrivato lavoro parte subito, in background. */
export function startQueuedAgents(userId: string, results: QueueResult[], key: string): Promise<QueuedWork[]> {
  if (officeWorkEnabled()) return Promise.resolve([])
  const started = results.filter((result) => result.enabled && result.reason !== 'agent_missing')
  return Promise.all(started.map(async (result): Promise<QueuedWork | null> => {
    const handler = officeAgentHandler(result.agent)
    if (!handler) return null
    const name = AGENT_NAMES[result.agent] || result.agent
    try {
      const done = await runAgentWhenFree(result.agent, handler, { userId, key: `${key}:${result.agent}` })
      if (done.skipped) return { name, state: 'skipped', summary: '', reason: done.skipped === 'running' ? 'sta già lavorando a un’altra cosa' : done.skipped === 'disabled' ? 'è spento' : 'lavoro già fatto', outputs: [] }
      if (done.error || !done.run) return { name, state: 'failed', summary: '', reason: done.error || 'corsa non avviata', outputs: [] }
      const outputs = await readRunOutputs(userId, done.run.id)
      if (done.run.status === 'failed' || done.run.status === 'skipped_budget') {
        return { name, state: 'failed', summary: '', reason: done.run.error || (done.run.status === 'skipped_budget' ? 'budget finito' : 'errore'), outputs }
      }
      return { name, state: 'ok', summary: String(done.run.summary || ''), outputs }
    } catch (error) {
      console.error('[direttore] corsa non avviata', result.agent, errorMessage(error, ''))
      return { name, state: 'failed', summary: '', reason: errorMessage(error, 'errore'), outputs: [] }
    }
  })).then((rows) => rows.filter((row): row is QueuedWork => !!row))
}

async function readRunOutputs(userId: string, runId: string): Promise<QueuedWork['outputs']> {
  const { data } = await createServiceRoleClient().from('office_agent_outputs').select('title,body,status')
    .eq('user_id', userId).eq('run_id', runId).order('created_at', { ascending: true }).limit(10)
  return (data || []) as QueuedWork['outputs']
}

/**
 * Il lavoro passato agli agenti non resta un «parte adesso»: quando finiscono,
 * l'esito si scrive sull'ordine e arriva su Telegram. Non può far fallire l'ordine.
 */
export async function reportQueuedWork(admin: Admin, userId: string, orderId: string | null, title: string, pending: Promise<QueuedWork[]>) {
  try {
    const work = await pending
    if (!work.length) return
    const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
    const report = queuedWorkReport(work, `${base}/ufficio`)
    if (orderId) {
      const { data } = await admin.from('office_director_orders').select('reply').eq('id', orderId).eq('user_id', userId).maybeSingle()
      if (data) await admin.from('office_director_orders').update({ reply: `${String(data.reply || '').trim()}\n\nEsito:\n${report}` }).eq('id', orderId).eq('user_id', userId)
    }
    const sent = await sendNotificationText(`*${title}*\n${report}`, { requiredChannel: 'telegram' })
    if (!sent.ok) console.error('[direttore] esito non inviato su Telegram:', sent.error)
  } catch (error) {
    console.error('[direttore] esito non registrato', errorMessage(error, ''))
  }
}

export async function findEntity(admin: Admin, userId: string, names: Array<string | null>) {
  for (const name of names) {
    const pattern = name ? entitySearchPattern(name) : null
    if (!pattern) continue
    // Archiviati e doppioni fuori già dalla query: altrimenti occupano i posti del limite.
    const { data, error } = await admin.from('tourism_entities').select('id,name,kind,status,website,email,phone,country_code,type_code,aliases,disabled,version').eq('user_id', userId)
      .eq('kind', 'organization').eq('disabled', false).not('status', 'in', '(INACTIVE,DUPLICATE)').ilike('name', pattern).limit(10)
    if (error) throw error
    const pick = pickOrderEntity((data || []) as Array<ActivationEntity & { kind: string }>, name!)
    if (pick) return pick
  }
  // Un nome di prima (rinomina) resta solo fra gli alias: lì si cerca uguale, non per pezzi.
  for (const name of names) {
    const wanted = name?.trim()
    if (!wanted) continue
    const { data, error } = await admin.from('tourism_entities').select('id,name,kind,status,website,email,phone,country_code,type_code,aliases,disabled,version').eq('user_id', userId)
      .eq('kind', 'organization').eq('disabled', false).not('status', 'in', '(INACTIVE,DUPLICATE)').filter('aliases', 'cs', `{"${wanted.replace(/[\\"]/g, (c) => `\\${c}`)}"}`).limit(10)
    if (error) throw error
    const pick = pickOrderEntity((data || []) as Array<ActivationEntity & { kind: string }>, wanted)
    if (pick) return pick
  }
  return null
}

/**
 * La presentazione di un ente: se non è ancora attivo (non verificato o senza una
 * destinazione), il Direttore lo attiva lui — sito, email, contatto nel CRM — perché
 * l'ordine del titolare è l'autorizzazione. Si ferma solo per chiedere il sito o la città.
 */
async function presentationFor(admin: Admin, ctx: AgentContext, userId: string, entity: ActivationEntity,
  plan: Extract<DirectorOrderPlan, { intent: 'presentation' }>, orderText: string, label: string, photos: string[] = [], contactId: string | null = null): Promise<Outcome> {
  let destination = entity.status === 'VERIFIED' ? await verifiedDestination(admin, userId, entity.id) : null
  let note = ''
  if (!destination) {
    const activated = await activateEntityForOrder(admin, ctx, userId, entity, { orderText, proposedCity: plan.city, contactId })
    if (!activated.ok) return { status: 'waiting_you', outputs: [], queued: [], reply: activated.reply, awaiting: awaitingOf(activated) }
    destination = activated.placeId
    note = `${activated.note} `
  }
  // «Fammela in inglese»: un deck nuovo in inglese, quello italiano resta com'è.
  if (plan.language === 'en') return englishPresentation(admin, ctx, userId, entity, destination, label, note, photos)
  if (!photos.length) {
    // C'è già una presentazione pronta per questo ente: non si rifà, si manda.
    const ready = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('entity_id', entity.id)
      .in('status', ['ready', 'approved', 'failed']).order('updated_at', { ascending: false }).limit(1).maybeSingle()) as DeckRow | null
    if (ready?.status === 'failed') return retryFailedDeck(admin, ctx, ready, label, note)
    if (ready) {
      const sent = await sendDeckToTelegram(admin, ready)
      const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
      return { status: 'done', outputs: [], queued: [], reply: `Presentazione per ${label}: c’è già, «${ready.title}»${sent.pdf ? ', te l’ho mandata qui in PDF' : ''}. ${note}${ready.status === 'approved' ? `Per l’email da mandare scrivimi «prepara la bozza per ${label}». ` : ''}Per rifarla da capo usa «Rigenera» nell’editor: ${base}/tourism/presentazioni/${ready.id}` }
    }
  }
  if (photos.length) {
    // Le foto mandate col comando sono della presentazione: se esiste già, ci vanno adesso.
    const existing = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('entity_id', entity.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()) as DeckRow | null
    if (existing) {
      const files = await directorPhotoFiles(admin, userId, photos)
      const { deck, added, skipped } = await addPhotosToDeck(admin, admin, existing, files)
      // Una presentazione rimasta a metà, con le foto nuove dentro, si rifà: le foto da sole non bastano.
      if (deck.status === 'failed') return retryFailedDeck(admin, ctx, deck, label, note)
      const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
      const extra = skipped ? ` ${skipped === 1 ? 'Una foto è rimasta fuori' : `${skipped} foto sono rimaste fuori`}: la presentazione ne tiene al massimo 8.` : ''
      const review = existing.status === 'approved' && added ? ' Era approvata: è tornata in revisione, riapprovala dopo averla guardata.' : ''
      return { status: added ? 'done' : 'failed', outputs: [], queued: [], reply: added
        ? `Presentazione per ${label}: ${note}ho aggiunto ${added === 1 ? 'la foto' : `${added} foto`} a «${deck.title}», al posto di quelle di esempio.${review}${extra} ${base}/tourism/presentazioni/${deck.id}`
        : `Presentazione per ${label}: non sono riuscito ad aggiungere le foto a «${existing.title}».${extra}` }
    }
  }
  const result = await queueForAgent(admin, userId, 'presentations', { key: `presentation:${entity.id}`, entity_id: entity.id,
    ...(destination ? { destination_id: destination } : {}), ...(photos.length ? { photos } : {}) })
  const withPhotos = photos.length ? ` Le ${photos.length === 1 ? 'foto che mi hai mandato andrà' : `${photos.length} foto che mi hai mandato andranno`} nella presentazione.` : ''
  return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `Presentazione per ${label}: ${note}${queueSentence(result)}${withPhotos}${result.enabled && result.reason !== 'agent_missing' ? ' Quando è pronta ti arriva qui in PDF, con il pulsante per approvarla.' : ''}` }
}

/**
 * «Abbiamo la presentazione per Visit Bergamo, creami la bozza e mettila in Gmail»: l'email col
 * link della presentazione approvata, al contatto CRM dell'ente. Nasce come bozza del CRM
 * (`source = 'office'`, stessa chiave della bozza che prepara l'approvazione) e si copia fra le
 * bozze di Gmail. Non parte niente: la invia il titolare.
 */
export async function presentationEmailFor(admin: Admin, ctx: AgentContext, userId: string,
  plan: Extract<DirectorOrderPlan, { intent: 'presentation_email' }>): Promise<Outcome> {
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const fail = (reply: string): Outcome => ({ status: 'failed', outputs: [], queued: [], reply })
  const entity = await findEntity(admin, userId, [plan.target])
  if (!entity) return fail(`Non trovo «${plan.target}» in Tourism Intelligence. Scrivimi il nome come è nel catalogo.`)
  const deck = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('entity_id', entity.id)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()) as DeckRow | null
  if (!deck) return fail(`Per ${entity.name} non c’è ancora una presentazione. Scrivimi «presentazione per ${entity.name}» e poi la mandiamo.`)
  const editor = `${base}/tourism/presentazioni/${deck.id}`
  if (deck.status !== 'approved') {
    // Il link pubblico funziona solo da approvata: un'email con un link chiuso non serve.
    const sent = deck.status === 'ready' ? await sendDeckToTelegram(admin, deck).catch(() => ({ pdf: false })) : { pdf: false }
    return { status: 'waiting_you', outputs: [], queued: [], reply: `La presentazione per ${entity.name} non è ancora approvata, e il link si apre solo dopo.${sent.pdf ? ' Te l’ho rimandata qui: approvala col pulsante,' : ' Approvala dall’editor,'} poi riscrivimi e preparo l’email. ${editor}` }
  }

  const links = (checked(await admin.from('tourism_crm_links').select('contact_id').eq('user_id', userId).eq('entity_id', entity.id)) || []) as Array<{ contact_id: string }>
  const contacts = links.length ? (checked(await admin.from('contacts').select('id,name,email,hidden,email_unsubscribed_at')
    .eq('user_id', userId).in('id', links.map((l) => l.contact_id))) || []) : []
  const recipient = pickPresentationRecipient(contacts as Array<{ id: string; name: string | null; email: string | null; hidden: boolean | null; email_unsubscribed_at: string | null }>, entity.email)
  if (!recipient) return fail(links.length
    ? `${entity.name} è collegato a un contatto senza un’email utilizzabile (manca, oppure si è disiscritto). Sistemala nella scheda e riscrivimi: ${base}/tourism?entity=${entity.id}`
    : `${entity.name} non ha un contatto nel CRM. Aprilo e usa «Conferma e aggiungi ai contatti», poi riscrivimi: ${base}/tourism?entity=${entity.id}`)

  const key = `presentation:${deck.id}`
  let draft = checked(await admin.from('email_drafts').select('id,status,subject,body_text,body_html,gmail_draft_id,sent_at,contact_id')
    .eq('user_id', userId).eq('office_key', key).maybeSingle()) as { id: string; status: string; subject: string; body_text: string | null; body_html: string | null; gmail_draft_id: string | null; sent_at: string | null; contact_id: string } | null
  if (draft?.status === 'sent') return { status: 'done', outputs: [], queued: [], reply: `L’email con la presentazione per ${entity.name} risulta già inviata. Le bozze sono in ${base}/email` }
  if (draft && draft.status !== 'pending') draft = null
  if (!draft) {
    const link = `${base}/presentazione/${deck.public_token}`
    const email = presentationEmail({ destination: deck.destination || entity.name, link, pdf: `${link}/pdf` })
    const html = simpleTextToHtml(email.text)
    const { data, error } = await admin.rpc('create_office_email_draft', { p_run_id: ctx.runId, p_contact_id: recipient.id, p_key: key,
      p_subject: email.subject, p_text: email.text, p_html: html, p_note: 'Preparata dal Direttore su richiesta del titolare. Rileggila e inviala tu.' })
    if (error) throw error
    if (!data?.id) return fail(data?.reason === 'pending_draft'
      ? `${recipient.name || recipient.email} ha già una bozza in attesa nel CRM: inviala o scartala, poi riscrivimi. ${base}/email`
      : `Non sono riuscito a preparare la bozza per ${entity.name}.`)
    draft = checked(await admin.from('email_drafts').select('id,status,subject,body_text,body_html,gmail_draft_id,sent_at,contact_id').eq('id', data.id).eq('user_id', userId).single())
  }
  const to = String(recipient.email).trim()
  const crm = `Bozza per ${entity.name} pronta, a ${to}, con il link della presentazione «${deck.title}».`

  // In Gmail: così l'invio passa dalla finestra di Gmail (firma, tracciamento) e la riconciliazione la chiude da sola.
  try {
    const session = await openGmailDraftSession(admin, userId)
    if (!session) return { status: 'done', outputs: [], queued: [], reply: `${crm} Gmail non è collegato al CRM, quindi è solo fra le bozze del CRM: ${base}/email` }
    const text = String(draft!.body_text || '')
    const saved = await saveContactDraftWithSession(session, { email: to, name: recipient.name || '' }, {
      subject: draft!.subject || '(nessun oggetto)', html: String(draft!.body_html || '') || simpleTextToHtml(text), text,
      appendSignature: true, gmailDraftId: draft!.gmail_draft_id,
    })
    checked(await admin.from('email_drafts').update({ gmail_draft_id: saved.draftId, gmail_draft_message_id: saved.messageId })
      .eq('id', draft!.id).eq('user_id', userId).eq('status', 'pending'))
    const url = saved.messageId ? gmailDraftUrl(session.account.email, saved.messageId) : 'https://mail.google.com/mail/#drafts'
    return { status: 'done', outputs: [], queued: [], reply: `${crm} È fra le bozze di Gmail (${session.account.email}): rileggila e inviala tu, da sola non parte. ${url}` }
  } catch (error) {
    const why = isGmailReconnectRequired(error) ? 'l’autorizzazione di Gmail è scaduta, ricollegalo dalle impostazioni' : `Gmail non ha risposto (${errorMessage(error, 'errore')})`
    return { status: 'done', outputs: [], queued: [], reply: `${crm} Non l’ho messa in Gmail: ${why}. La trovi fra le bozze del CRM, da lì «Prepara tutte in Gmail»: ${base}/email` }
  }
}

/**
 * La presentazione di un ente in inglese: un deck a parte (`input.lingua = 'en'`, base inglese), così
 * quella italiana resta com'è. Ce n'è una sola per ente: chiederla di nuovo rimanda quella che c'è.
 * La genera il Direttore nel suo budget; l'approvazione resta un clic del titolare.
 */
async function englishPresentation(admin: Admin, ctx: AgentContext, userId: string, entity: ActivationEntity, destinationId: string | null,
  label: string, note: string, photos: string[]): Promise<Outcome> {
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  let deck = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('entity_id', entity.id).eq('input->>lingua', 'en')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()) as DeckRow | null
  const link = (row: DeckRow) => `${base}/tourism/presentazioni/${row.id}`
  if (deck?.status === 'failed') return retryFailedDeck(admin, ctx, deck, `${label} (inglese)`, note)
  if (!deck) {
    if (!destinationId) return { status: 'waiting_you', outputs: [], queued: [], reply: `Presentazione in inglese per ${label}: non trovo la destinazione verificata dell’ente. Scrivimi la città.` }
    let source: Awaited<ReturnType<typeof presentationEntities>>
    try { source = await presentationEntities(admin, userId, { entity_id: entity.id, destination_id: destinationId }) }
    catch (error) { return { status: 'failed', outputs: [], queued: [], reply: `Presentazione in inglese per ${label}: ${errorMessage(error, 'mancano i dati verificati')}.` } }
    const { entity: org, destination } = source
    const evidence = (checked(await admin.from('tourism_evidence').select('fields,source_url,excerpt').eq('user_id', userId).eq('status', 'VERIFIED')
      .in('entity_id', [org.id, destination.id]).order('id').limit(100)) || []) as Array<{ fields: unknown; source_url: string | null; excerpt: string | null }>
    const notes = JSON.stringify({ ente: org.name, destinazione: destination.name, lingua: 'inglese',
      evidenze: evidence.map((e) => ({ fields: e.fields, excerpt: e.excerpt, source_url: e.source_url })) }).slice(0, 30000)
    deck = await createDeck(admin, userId, { entity_id: org.id, destination: destination.name, notes,
      input: { destinazione: destination.name, ente: org.name, paese: destination.country_code || org.country_code || '', prezzo: '', contatto: '[DA VERIFICARE]', lingua: 'en' } },
      stableId(`en-deck:${org.id}`))
  }
  if (photos.length) deck = (await addPhotosToDeck(admin, admin, deck, await directorPhotoFiles(admin, userId, photos))).deck
  let generated = deck.status !== 'draft'
  if (!generated) {
    try {
      deck = await generateIntoDeck(admin, admin, deck, undefined, officeDeckAgent(ctx))
      generated = true
    } catch (error) {
      if (error instanceof BudgetExceeded) throw error
      console.error('[direttore] presentazione in inglese non generata', errorMessage(error, ''))
    }
  } else if (deck.status === 'ready' || deck.status === 'approved') {
    const sent = await sendDeckToTelegram(admin, deck)
    return { status: 'done', outputs: [], queued: [], reply: `Presentazione in inglese per ${label}: c’è già, «${deck.title}»${sent.pdf ? ', te l’ho mandata qui in PDF' : ''}. ${note}${link(deck)}` }
  }
  if (!generated || deck.status !== 'ready') return { status: 'failed', outputs: [], queued: [], reply: `Presentazione in inglese per ${label}: ho preparato il testo di base in inglese ma l’adattamento non è riuscito. Puoi rivederla e rigenerarla da qui: ${link(deck)}` }
  const telegram = await sendDeckToTelegram(admin, deck)
  return { status: 'done', outputs: [], queued: [], reply: `Presentazione in inglese per ${label} pronta da rivedere: l’ho fatta nuova, quella italiana resta com’è.${telegram.pdf ? ' Il PDF della bozza te l’ho mandato qui su Telegram.' : ''} ${note}${link(deck)}` }
}

/**
 * «Fammi la fattura per …» e «SNAV ha approvato, fai la fattura»: prepara la bozza dal
 * preventivo, come «Genera fattura» nella scheda. Se l'ordine dice che il cliente ha approvato,
 * prima segna il preventivo come accettato (solo da bozza o inviato). Non lo segna mai pagato
 * e non invia niente allo SDI: quello resta un clic in Fatture.
 */
export async function invoiceFor(admin: Admin, userId: string, plan: Extract<DirectorOrderPlan, { intent: 'invoice' }>): Promise<Outcome> {
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const columns = 'id,quote_number,customer_name,customer_company,total_amount,status,payment_state,billing_interval,contact_id'
  const waiting = async () => (checked(await admin.from('quotes').select(columns).eq('user_id', userId).in('status', ['sent', 'accepted'])
    .order('created_at', { ascending: false }).limit(5)) || []) as DirectorInvoiceQuote[]
  let quotes: DirectorInvoiceQuote[]
  if (plan.quote_number) {
    quotes = checked(await admin.from('quotes').select(columns).eq('user_id', userId).ilike('quote_number', plan.quote_number).limit(2)) || []
  } else {
    const pattern = searchPattern(plan.customer || '')
    const found = pattern ? (checked(await admin.from('quotes').select(columns).eq('user_id', userId).neq('status', 'cancelled')
      .or(`customer_name.ilike.${pattern},customer_company.ilike.${pattern}`).order('created_at', { ascending: false }).limit(10)) || []) as DirectorInvoiceQuote[] : []
    // Fra più preventivi dello stesso cliente conta quello da fatturare (o, per un'approvazione, quello in attesa).
    const open = found.filter((q) => (plan.approved ? ['draft', 'sent'].includes(q.status) : false) || quoteIsInvoiceable(q))
    quotes = open.length ? open : found
  }
  const what = plan.quote_number || `«${plan.customer}»`
  if (!quotes.length) {
    // Un nome capito male (un vocale: «snob» per SNAV) non deve finire nel vuoto: si mostra cosa è in attesa.
    const pending = await waiting()
    return { status: 'waiting_you', outputs: [], queued: [], reply: pending.length
      ? `Non trovo il preventivo ${what}. Quelli in attesa sono:\n${pending.map((q) => `• ${directorQuoteLabel(q)}`).join('\n')}\nRiscrivimi il numero di quello giusto.`
      : `Non trovo il preventivo ${what}. Controlla in Preventivi: ${base}/preventivi` }
  }
  if (quotes.length > 1) return { status: 'waiting_you', outputs: [], queued: [], reply: `Per ${what} ci sono più preventivi:\n${quotes.slice(0, 5).map((q) => `• ${directorQuoteLabel(q)}`).join('\n')}\nScrivimi il numero di quello da fatturare.` }
  let quote = quotes[0]
  if (quote.billing_interval === 'year' && quote.status !== 'paid' && quote.payment_state !== 'paid') {
    // Un abbonamento si paga con carta e la bozza nasce dal pagamento: farla prima la raddoppierebbe.
    return { status: 'waiting_you', outputs: [], queued: [], reply: `${directorQuoteLabel(quote)} è un abbonamento con carta: la bozza della fattura si prepara da sola quando arriva il pagamento.` }
  }
  let approvedNow = false
  if (plan.approved && ['draft', 'sent'].includes(quote.status)) {
    const now = new Date().toISOString()
    // Il filtro di un UPDATE su PostgREST vale anche per la risposta (la riga non è più «sent»):
    // si rilegge e si riconosce la propria scrittura dalla data.
    checked(await admin.from('quotes').update({ status: 'accepted', accepted_at: now }).eq('user_id', userId).eq('id', quote.id).in('status', ['draft', 'sent']))
    const reread = checked(await admin.from('quotes').select(`${columns},accepted_at`).eq('user_id', userId).eq('id', quote.id).single()) as DirectorInvoiceQuote & { accepted_at: string | null }
    const previous = quote.status
    quote = reread
    if (reread.status === 'accepted' && reread.accepted_at && Date.parse(reread.accepted_at) === Date.parse(now)) {
      approvedNow = true
      if (quote.contact_id) {
        await admin.from('activities').insert({ user_id: userId, contact_id: quote.contact_id, type: 'system',
          content: `Preventivo ${quote.quote_number}: stato ${previous} -> accepted (approvazione del cliente comunicata al Direttore).`,
          metadata: { quote_id: quote.id, previous_status: previous, next_status: 'accepted', source: 'director' } })
      }
    }
  }
  if (!quoteIsInvoiceable(quote)) {
    const state = quote.status === 'sent' ? 'inviato, non ancora approvato' : quote.status === 'draft' ? 'in bozza' : quote.status === 'cancelled' ? 'annullato' : quote.status
    return { status: 'waiting_you', outputs: [], queued: [], reply: [
      `Il preventivo ${directorQuoteLabel(quote)} risulta ${state}: la fattura si fa quando il cliente l’ha approvato.`,
      quote.status === 'cancelled' ? '' : `Quando ti dà l’ok scrivimi «${quote.customer_company || quote.customer_name || 'il cliente'} ha approvato ${quote.quote_number}, fai la fattura».`,
    ].filter(Boolean).join('\n') }
  }
  const { invoice, created } = await createInvoiceDraftFromQuote(admin, userId, quote.id)
  const { settings } = await loadInvoiceSettings(admin, userId)
  const draft = invoice.status === 'draft'
  return { status: 'done', outputs: [], queued: [], result: { invoice_id: invoice.id }, reply: directorInvoiceReply({
    quote, created, invoiceStatus: invoice.status, numero: invoice.numero || null, approvedNow,
    problems: draft ? invoiceProblems(invoice, settings) : [], warnings: draft && Array.isArray(invoice.warnings) ? invoice.warnings : [],
    link: `${base}/fatture?invoice=${invoice.id}`,
  }) }
}

type PresentationPlan = Extract<DirectorOrderPlan, { intent: 'presentation' }>

/** Più esiti in una risposta sola: aspetta te se uno lo chiede, fallito solo se tutti falliscono. */
function combineOutcomes(outcomes: Outcome[], footer = ''): Outcome {
  if (outcomes.length === 1 && !footer) return outcomes[0]
  // Si riprende solo una domanda per volta: con due in sospeso, la risposta non saprebbe a quale va.
  const asking = outcomes.filter((o) => o.awaiting)
  const status: Outcome['status'] = outcomes.some((o) => o.status === 'waiting_you') ? 'waiting_you'
    : outcomes.length && outcomes.every((o) => o.status === 'failed') ? 'failed' : 'done'
  return { status, outputs: outcomes.flatMap((o) => o.outputs), queued: outcomes.flatMap((o) => o.queued),
    reply: [...outcomes.map((o) => `• ${o.reply}`), footer].filter(Boolean).join('\n'), ...(asking.length === 1 ? { awaiting: asking[0].awaiting } : {}) }
}

/** La domanda dell'attivazione, nella forma che l'ordine salva. */
function awaitingOf(result: { need?: 'site' | 'city'; resume?: string }): DirectorAwaiting | undefined {
  return result.need && result.resume ? { need: result.need, resume: result.resume } : undefined
}

/**
 * Una presentazione rimasta «non riuscita» non si rimanda così com'è (sono le slide del modello):
 * richiesta di nuovo dal titolare, il Direttore la rigenera lui, nel suo budget. È la sua richiesta
 * esplicita a farla ripartire: nessun ritentativo automatico.
 */
async function retryFailedDeck(admin: Admin, ctx: AgentContext, failed: DeckRow, label: string, note: string): Promise<Outcome> {
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const link = `${base}/tourism/presentazioni/${failed.id}`
  let deck = failed
  try {
    deck = await generateIntoDeck(admin, admin, failed, undefined, officeDeckAgent(ctx), undefined, { onlyIfUnchanged: true })
  } catch (error) {
    if (error instanceof BudgetExceeded) return { status: 'failed', outputs: [], queued: [], reply: `Presentazione per ${label}: per rifarla serve budget e quello di oggi del Direttore è finito. Riprova domani o usa «Rigenera» nell’editor: ${link}` }
    return { status: 'failed', outputs: [], queued: [], reply: `Presentazione per ${label}: ho riprovato a generarla ma non ci sono riuscito (${errorMessage(error, 'errore')}). Puoi usare «Rigenera» nell’editor: ${link}` }
  }
  if (deck.status !== 'ready') return { status: 'failed', outputs: [], queued: [], reply: `Presentazione per ${label}: ho riprovato ma non è riuscita (${deck.error || 'motivo non indicato'}). ${link}` }
  // Il compito dell'agente Presentazioni segue il deck: pronto, come se l'avesse fatta lui.
  const task = await admin.from('office_presentation_tasks').update({ state: 'ready' }).eq('id', deck.id).eq('state', 'failed')
  // Il deck è rifatto comunque; se il compito resta «failed» la bozza email dell'ufficio non parte, e va detto.
  const taskNote = task.error ? ` (Non ho aggiornato il compito dell’agente Presentazioni: ${task.error.message}. La bozza email dopo l’approvazione potrebbe non prepararsi da sola.)` : ''
  const sent = await sendDeckToTelegram(admin, deck)
  return { status: 'done', outputs: [], queued: [], reply: `Presentazione per ${label}: ${note}l’avevo lasciata a metà, l’ho rifatta adesso${sent.pdf ? ' e te l’ho mandata qui in PDF' : ''}. ${link}${taskNote}` }
}

/** La presentazione di un nome: ente del catalogo, contatto di un ente, oppure lavoro da agenzia. */
async function presentationTarget(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: PresentationPlan, target: string, photos: string[]): Promise<Outcome> {
  const userId = order.user_id
  const entity = await findEntity(admin, userId, [target])
  if (entity) return presentationFor(admin, ctx, userId, entity, plan, order.text, entity.name, photos)
  const pattern = searchPattern(target)
  const contacts = pattern ? checked(await admin.from('contacts').select('id,name,company,country,email').eq('user_id', userId)
    .or(`name.ilike.${pattern},company.ilike.${pattern}`).limit(3)) as Array<{ id: string; name: string; company: string | null; country: string | null; email: string | null }> : []
  // Fra più schede dello stesso ente basta che dicano la stessa organizzazione.
  const companies = [...new Set(contacts.map((c) => c.company && compactName(c.company)).filter(Boolean))]
  const contact = contacts.length === 1 || (contacts.length > 1 && companies.length === 1 && contacts.every((c) => c.company)) ? contacts[0] : null
  // L'ente da presentare: l'organizzazione del contatto, oppure il nome scritto.
  const orgName = contact?.company || (contacts.length ? null : target)
  if (contact?.company) {
    // Il contatto di un ente del catalogo: la presentazione è quella dell'ente.
    const owner = await findEntity(admin, userId, [contact.company])
    if (owner) return presentationFor(admin, ctx, userId, owner, plan, order.text, `${owner.name} (${contact.name})`, photos, contact.id)
  }
  if (orgName && (looksLikeTourismBody(orgName) || plan.type_code)) {
    // Un ente del turismo che non è ancora nel catalogo: il Direttore lo aggiunge e lo attiva, poi la presentazione.
    const country = plan.country_code || countryCode(contact?.country) || emailCountry(contact?.email)
    if (!country) return { status: 'waiting_you', outputs: [], queued: [], reply: `${orgName} non è ancora in Tourism Intelligence e non so di quale paese è. Scrivimi il paese e lo aggiungo io.`,
      awaiting: { need: 'country', resume: `presentazione per ${orgName}${plan.city ? `, ${plan.city}` : ''}` } }
    const found = await ensureCatalogEntity(admin, userId, order.id, { name: orgName, country_code: country, type_code: plan.type_code || 'dmo', website: websiteFromText(order.text) })
    if ('reply' in found) return { status: 'waiting_you', outputs: [], queued: [], reply: found.reply }
    const outcome = await presentationFor(admin, ctx, userId, found.entity, plan, order.text, `${found.entity.name}${contact ? ` (${contact.name})` : ''}`, photos, contact?.id || null)
    return found.created ? { ...outcome, reply: `Ho aggiunto ${found.entity.name} a Tourism Intelligence. ${outcome.reply}` } : outcome
  }
  if (contact) {
    const result = await queueForAgent(admin, userId, 'agency', { key: `agency:contact:${contact.id}`, contact_id: contact.id, brief: plan.brief || order.text })
    return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `${contact.name} non è un ente del turismo, quindi è un lavoro da agenzia. ${queueSentence(result)}` }
  }
  return { status: 'failed', outputs: [], queued: [], reply: contacts.length
    ? `Ho trovato più contatti per «${target}» (${contacts.map((c) => c.name).join(', ')}): dimmi quale.`
    : `Non trovo «${target}» né fra gli enti del catalogo Tourism né fra i contatti. Se è un ente del turismo, scrivimi «aggiungi ${target} a Tourism Intelligence»; se è un cliente, mandami il contatto.` }
}

/** Un UUID fisso per (ordine, nome): rielaborare lo stesso ordine ritrova la stessa presentazione. */
function stableId(seed: string) {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${(8 + (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * Presentazione per un partner (hotel, agenzia, compagnia): base Partner, città della guida
 * dall'ordine. La fa il Direttore subito, nel suo budget; le condizioni restano
 * [DA VERIFICARE] finché il titolare non le scrive, quindi non si approva da sola.
 */
async function partnerPresentation(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: PresentationPlan, target: string): Promise<Outcome> {
  const userId = order.user_id
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const entity = await findEntity(admin, userId, [target])
  const name = entity?.name || target
  const city = plan.city
  if (!city) return { status: 'waiting_you', outputs: [], queued: [], reply: `Per quale città è la guida che proponi a ${name}? Scrivimi «presentazione partner per ${name}, guida di …».` }
  if (officeIsNaples(city)) return { status: 'failed', outputs: [], queued: [], reply: 'Napoli resta fuori dal lavoro degli agenti.' }
  if (entity) {
    const existing = checked(await admin.from('tourism_decks').select('id,title').eq('user_id', userId).eq('entity_id', entity.id)
      .eq('input->>modello', 'partner').ilike('destination', city).limit(1).maybeSingle()) as { id: string; title: string } | null
    if (existing) return { status: 'done', outputs: [], queued: [], reply: `${name}: la presentazione partner per ${city} c’è già, «${existing.title}». ${base}/tourism/presentazioni/${existing.id}` }
  }
  const id = stableId(`partner-deck:${order.id}:${nameKey(name)}`)
  let deck = checked(await admin.from('tourism_decks').select('*').eq('user_id', userId).eq('id', id).maybeSingle()) as DeckRow | null
  if (!deck) {
    const notes = [entity ? `Partner nel catalogo Tourism: ${entity.name}${entity.website ? `, sito ${entity.website}` : ''}.` : `Partner: ${name}.`,
      plan.brief ? `Richiesta del titolare: ${plan.brief}` : '', `Ordine: ${order.text.slice(0, 1500)}`].filter(Boolean).join('\n')
    deck = await createDeck(admin, userId, { entity_id: entity?.id || null, destination: city, notes,
      input: { destinazione: city, ente: name, paese: entity?.country_code || '', modello: 'partner' } }, id)
  }
  let generated = deck.status !== 'draft'
  if (!generated) {
    try {
      deck = await generateIntoDeck(admin, admin, deck, undefined, officeDeckAgent(ctx))
      generated = true
    } catch (error) {
      if (error instanceof BudgetExceeded) throw error
      console.error('[direttore] presentazione partner non generata', errorMessage(error, ''))
    }
  }
  const link = `${base}/tourism/presentazioni/${deck.id}`
  const telegram = generated ? await sendDeckToTelegram(admin, deck) : { ok: false, pdf: false }
  const onTelegram = telegram.pdf ? ' Il PDF della bozza te l’ho mandato qui su Telegram.' : ''
  return { status: 'done', outputs: [], queued: [], reply: generated
    ? `${name}: presentazione partner per la guida di ${city} pronta da rivedere.${onTelegram} Le condizioni (commissione, prezzo dei codici) restano [DA VERIFICARE]: scrivile nell’editor, poi approvala. ${link}`
    : `${name}: ho preparato la presentazione partner per ${city} con il testo di base, ma l’adattamento non è riuscito. Puoi rivederla e rigenerarla da qui: ${link}` }
}

export const DESTINATION_TYPES = ['dmo', 'nto', 'cvb', 'rto']

/**
 * «Preparami 5 presentazioni di destinazioni»: il Direttore sceglie lui, fra gli enti del
 * turismo con un sito che non hanno ancora una presentazione, prima quelli con priorità.
 * Ognuno passa dall'attivazione (sito, prove, contatto nel CRM) e va alla coda Presentazioni.
 */
async function autoDestinationPresentations(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: PresentationPlan): Promise<Outcome> {
  const userId = order.user_id
  const wanted = plan.count || 1
  const [decks, rows] = await Promise.all([
    officeRows<{ entity_id: string | null }>(admin, userId, 'tourism_decks', 'id,entity_id'),
    admin.from('tourism_entities').select('id,name,kind,status,website,email,phone,country_code,type_code,aliases,disabled,version,outreach_priority')
      .eq('user_id', userId).eq('kind', 'organization').eq('disabled', false).in('type_code', DESTINATION_TYPES)
      .in('status', ['VERIFIED', 'UNVERIFIED', 'NEEDS_REVIEW']).not('website', 'is', null)
      .order('outreach_priority', { ascending: true, nullsFirst: false }).order('name').limit(200),
  ])
  if (rows.error) throw rows.error
  const done = new Set(decks.map((d) => d.entity_id).filter(Boolean))
  const candidates = ((rows.data || []) as Array<ActivationEntity & { outreach_priority: number | null }>)
    .filter((e) => !done.has(e.id) && !officeIsNaples(e.name))
    // Si attiva solo chi ha una città leggibile dal nome («Visit Bergamo»): gli altri si fermerebbero a chiederla.
    .filter((e) => e.status === 'VERIFIED' || cityForEntity({ proposed: null, entityName: e.name, aliases: e.aliases, orderText: '' }))
    // A parità di priorità prima chi è già verificato: costa meno attivarlo.
    .sort((a, b) => (a.outreach_priority ?? 9) - (b.outreach_priority ?? 9) || Number(b.status === 'VERIFIED') - Number(a.status === 'VERIFIED'))
  if (!candidates.length) return { status: 'failed', outputs: [], queued: [], reply: 'Non trovo enti del turismo con un sito e senza presentazione nel catalogo. Dimmi tu per chi.' }
  const outcomes: Outcome[] = []
  const skipped: string[] = []
  let queued = 0
  for (const entity of candidates.slice(0, wanted * 3)) {
    if (queued >= wanted) break
    try {
      const outcome = await presentationFor(admin, ctx, userId, entity, plan, order.text, entity.name)
      if (outcome.status === 'waiting_you' || outcome.status === 'failed') { skipped.push(`${entity.name}: ${outcome.reply.split('. ')[0]}`); continue }
      outcomes.push(outcome)
      queued++
    } catch (error) {
      if (error instanceof BudgetExceeded) { skipped.push('budget di oggi del Direttore finito: mi sono fermato'); break }
      skipped.push(`${entity.name}: ${errorMessage(error, 'errore')}`)
    }
  }
  const header = `Ho scelto ${queued} ${queued === 1 ? 'destinazione' : 'destinazioni'} su ${wanted} fra quelle senza presentazione:`
  const footer = skipped.length ? `Saltate: ${skipped.slice(0, 5).join('; ')}.` : ''
  const result = combineOutcomes(outcomes, footer)
  return { ...result, status: queued ? 'done' : 'failed', reply: queued ? `${header}\n${result.reply}` : `Non sono riuscito a preparare presentazioni. ${footer}` }
}

const PARTNER_DB_TYPES = [...PARTNER_TYPE_CODES, 'accommodation', 'transport']

/**
 * «Trovami 5 partner per Venezia»: prima il catalogo (operatori che nominano la città),
 * poi il web per quelli che mancano. Ognuno diventa una proposta «Nuovo contatto»
 * di tipo partner: nel CRM entra solo con il clic del titolare.
 */
async function findPartners(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: Extract<DirectorOrderPlan, { intent: 'find_partners' }>): Promise<Outcome> {
  const userId = order.user_id
  const names = [plan.city, ...(EXONYMS[nameKey(plan.city)] || [])]
  const patterns = names.map((n) => `%${n.replace(/[%_,()*\\]/g, ' ').trim()}%`)
  const filters = patterns.flatMap((p) => [`name.ilike.${p}`, `details->>description.ilike.${p}`, `details->>hq_city.ilike.${p}`]).join(',')
  const [rows, pending] = await Promise.all([
    admin.from('tourism_entities').select('id,name,type_code,status,website,email,phone,country_code,details')
      .eq('user_id', userId).eq('kind', 'organization').eq('disabled', false).in('type_code', PARTNER_DB_TYPES)
      .not('status', 'in', '(INACTIVE,DUPLICATE)').or(filters).limit(80),
    admin.from('office_agent_outputs').select('body').eq('user_id', userId).eq('agent_id', 'director').eq('status', 'pending')
      .eq('body->>action', 'create_contact').limit(200),
  ])
  if (rows.error) throw rows.error
  const proposed = new Set(((pending.data || []) as Array<{ body: any }>).map((o) => compactName(String(o.body?.contact?.company || o.body?.contact?.name || ''))))
  const seen = new Set<string>()
  type Pick = { name: string; website: string | null; email: string | null; phone: string | null; country: string | null; kind: string; why: string; source: string; entity_id: string | null }
  const picks: Pick[] = []
  const consider = async (pick: Pick) => {
    const key = compactName(pick.name)
    const host = pick.website ? new URL(pick.website).hostname.replace(/^www\./, '') : null
    if (!key || seen.has(key) || (host && seen.has(host)) || proposed.has(key)) return false
    const dup = await findDuplicates(admin, userId, { company: pick.name, email: pick.email, phone: null })
    if (dup.length) return false
    seen.add(key); if (host) seen.add(host)
    picks.push(pick)
    return true
  }
  const catalog = ((rows.data || []) as any[])
    // Prima chi ha un recapito, poi chi ha la città nel nome.
    .sort((a, b) => Number(!!b.email) - Number(!!a.email) || Number(!!b.website) - Number(!!a.website)
      || Number(names.some((n) => nameKey(b.name).includes(nameKey(n)))) - Number(names.some((n) => nameKey(a.name).includes(nameKey(n)))))
  const linked = catalog.length ? new Set(((checked(await admin.from('tourism_crm_links').select('entity_id').eq('user_id', userId)
    .in('entity_id', catalog.map((e) => e.id))) || []) as Array<{ entity_id: string }>).map((l) => l.entity_id)) : new Set<string>()
  for (const e of catalog) {
    if (picks.length >= plan.count) break
    if (linked.has(e.id)) continue
    await consider({ name: e.name, website: e.website || null, email: e.email || null, phone: e.phone || null, country: e.country_code || null,
      kind: TOURISM_TYPE_LABEL(e.type_code), why: String(e.details?.description || '').slice(0, 200), source: 'Catalogo Tourism Intelligence', entity_id: e.id })
  }
  const notes: string[] = []
  if (picks.length < plan.count) {
    try {
      const missing = plan.count - picks.length
      const answer = await callModel(ctx, { model: ctx.agent.model, maxOutputTokens: 1200, webSearch: { maxResults: 8 },
        input: partnerSearchPrompt({ city: plan.city, count: missing + 3, brief: plan.brief, exclude: picks.map((p) => p.name) }),
        jsonSchema: { name: 'partner_search', schema: PARTNER_SEARCH_SCHEMA as unknown as Record<string, unknown> } })
      let parsed: unknown = null
      try { parsed = JSON.parse(answer.text) } catch { /* Risposta illeggibile: restano quelli del catalogo. */ }
      for (const candidate of parsePartnerSearch(parsed)) {
        if (picks.length >= plan.count) break
        // Il sito proposto dal modello vale solo se la pagina letta nomina davvero l'azienda.
        let pages: Array<{ text: string }> = []
        try { pages = await readEntitySite(candidate.website) } catch { continue }
        if (!siteMatchesEntity(candidate.website, pages.map((p) => p.text).join('\n'), candidate.name)) continue
        await consider({ ...candidate, email: emailFromSite(candidate.website, pages.map((p) => p.text)), phone: null, country: null,
          source: `Ricerca web, sito letto: ${candidate.website}`, entity_id: null })
      }
    } catch (error) {
      if (error instanceof BudgetExceeded) notes.push('la ricerca sul web si è fermata: budget di oggi del Direttore finito')
      else notes.push(`la ricerca sul web non è riuscita (${errorMessage(error, 'errore')})`)
    }
  }
  if (!picks.length) return { status: 'failed', outputs: [], queued: [], reply: `Non ho trovato partner nuovi per ${plan.city}${notes.length ? `: ${notes.join(', ')}` : ''}.` }
  const outputs: string[] = []
  for (const [i, p] of picks.entries()) {
    const contact = { name: null, role: null, company: p.name, email: p.email, phone: p.phone, website: p.website, city: plan.city, country: p.country }
    outputs.push(await ctx.addOutput({
      kind: 'proposal', key: `order:${order.id}:partner:${i}`, title: `Partner per ${plan.city}: ${p.name}`,
      target_table: 'office_director_orders', target_id: order.id,
      body: {
        action: 'create_contact', order_id: order.id, contact, evidence: { company: p.source, ...(p.email ? { email: p.source } : {}) },
        category: 'partner', tipo: CONTACT_CATEGORY_LABELS.partner, perche: `${p.kind}${p.why ? ` · ${p.why}` : ''}`,
        brief: `Potenziale partner per la guida di ${plan.city}.`, card_text: null, scartati: [],
        entity_id: p.entity_id, ente_nel_catalogo: p.entity_id ? p.name : null, possibili_doppioni: [], duplicate_ids: [],
        dopo_il_clic: contactNextStep('partner'),
      },
    }))
  }
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const list = picks.map((p) => `• ${p.name} (${p.kind})${p.email ? ` · ${p.email}` : p.website ? ` · ${p.website.replace(/^https:\/\//, '')}` : ''}`).join('\n')
  const short = picks.length < plan.count ? ` Ne ho trovati ${picks.length} su ${plan.count}.` : ''
  return { status: 'waiting_you', outputs, queued: [], reply: [
    `Partner per ${plan.city}: te li propongo in «Aspetta te», uno per uno. Approvando entrano nei contatti con un’opportunità di distribuzione.${short}`,
    list, notes.length ? `Nota: ${notes.join(', ')}.` : '', `${base}/ufficio`,
  ].filter(Boolean).join('\n') }
}

/**
 * «Aggiungi Venezuela Tourism a Tourism Intelligence e ai contatti»: l'ente si ritrova nel
 * catalogo o si crea (non verificato), poi l'attivazione cerca il sito, scrive le prove,
 * lo verifica e lo porta nel CRM. Il titolare che lo chiede è l'autorizzazione.
 */
async function addEntity(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: Extract<DirectorOrderPlan, { intent: 'add_entity' }>): Promise<Outcome> {
  const userId = order.user_id
  const found = await ensureCatalogEntity(admin, userId, order.id, plan)
  if ('reply' in found) return { status: 'waiting_you', outputs: [], queued: [], reply: found.reply }
  const { entity, created } = found
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const link = `${base}/tourism?entity=${entity.id}`
  const crm = checked(await admin.from('tourism_crm_links').select('contact_id').eq('user_id', userId).eq('entity_id', entity.id).limit(1).maybeSingle())
  if (entity.status === 'VERIFIED' && crm) return { status: 'done', outputs: [], queued: [], reply: `${entity.name} è già in Tourism Intelligence, verificato e nei contatti. ${link}` }
  const city = plan.city || (DESTINATION_TYPES.includes(plan.type_code) || plan.type_code === 'ministry' ? countryName(plan.country_code) : null)
  // Un contatto del CRM con l'organizzazione dell'ente (uno solo) si collega, invece di crearne un altro.
  const contact = crm ? null : await contactOfOrganization(admin, userId, entity.name)
  // Alla risposta del titolare si riparte da qui: con la presentazione, se l'aveva chiesta.
  const resume = plan.presentation ? `presentazione per ${entity.name}` : `aggiungi ${entity.name} a Tourism Intelligence e ai contatti`
  const activated = await activateEntityForOrder(admin, ctx, userId, entity, { orderText: `${order.text}\n${city || ''}`, proposedCity: city, contactId: contact?.id || null, resume })
  const first = created ? `Ho aggiunto ${entity.name} a Tourism Intelligence.` : `${entity.name} era già in Tourism Intelligence.`
  if (!activated.ok) return { status: 'waiting_you', outputs: [], queued: [], reply: `${first} ${activated.reply} ${link}`, awaiting: awaitingOf(activated) }
  if (!plan.presentation) return { status: 'done', outputs: [], queued: [], reply: `${first} ${activated.note} ${link}` }
  // «…e poi fammi la presentazione»: l'ente è attivo, la presentazione parte subito.
  const fresh = await findEntity(admin, userId, [entity.name]) || { ...entity, status: 'VERIFIED' }
  const deckPlan: PresentationPlan = { intent: 'presentation', targets: [entity.name], count: null, audience: 'destinazione', brief: null,
    city, skipped: [], country_code: entity.country_code, type_code: entity.type_code }
  const deck = await presentationFor(admin, ctx, userId, fresh, deckPlan, order.text, entity.name, [], contact?.id || activated.contactId)
  return { ...deck, reply: `${first} ${activated.note} ${link}\n${deck.reply}` }
}

const ENTITY_COLUMNS = 'id,name,kind,status,website,email,phone,country_code,type_code,aliases,disabled,version'

/**
 * «Rinomina X in Y»: cambia il nome dell'ente come la scheda Tourism (modifica condizionata
 * sulla versione), il vecchio nome resta fra gli alias così lo si ritrova ancora. Il catalogo
 * toglie la verifica a un ente che cambia nome: se lo era, torna da rivedere, e una presentazione
 * chiesta nello stesso ordine lo riattiva con le prove nuove.
 */
async function renameEntity(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: Extract<DirectorOrderPlan, { intent: 'rename_entity' }>): Promise<Outcome> {
  const userId = order.user_id
  const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
  const found = await findEntity(admin, userId, [plan.from])
  // Si rinomina solo l'ente con quel nome (o alias): «Visit Lima» non deve rinominare «Visit Lima Norte».
  const entity = found && [found.name, ...(found.aliases || [])].some((n) => compactName(n) === compactName(plan.from)) ? found : null
  if (!entity) return { status: 'failed', outputs: [], queued: [], reply: found
    ? `Non trovo un ente che si chiami esattamente «${plan.from}»: il più vicino è «${found.name}». Se è lui, scrivimi «rinomina ${found.name} in ${plan.to}».`
    : `Non trovo «${plan.from}» fra gli enti di Tourism Intelligence. Scrivimi il nome come lo vedi nella scheda.` }
  if (officeIsNaples(entity.name)) return { status: 'failed', outputs: [], queued: [], reply: 'Gli enti di Napoli restano fuori dal lavoro degli agenti: rinominalo tu dalla scheda Tourism.' }
  const link = `${base}/tourism?entity=${entity.id}`
  let renamed: ActivationEntity = entity
  let first = `${entity.name} si chiama già così.`
  if (nameKey(entity.name) !== nameKey(plan.to)) {
    // Il nome di prima va in testa: con 50 alias già pieni è l'ultimo vecchio a uscire, non lui.
    const aliases = [entity.name, ...(entity.aliases || []).filter((a) => compactName(a) !== compactName(entity.name))].slice(0, 50)
    const patch: Record<string, unknown> = { name: plan.to, aliases }
    // Un sito scritto nell'ordine riempie solo un campo vuoto, come l'attivazione.
    if (plan.website && !entity.website) patch.website = plan.website
    const saved = await admin.from('tourism_entities').update(patch).eq('user_id', userId).eq('id', entity.id)
      .eq('version', entity.version).select(ENTITY_COLUMNS).maybeSingle()
    if (saved.error) {
      if ((saved.error as { code?: string }).code === '23505') return { status: 'failed', outputs: [], queued: [], reply: `C’è già un ente che si chiama ${plan.to} nello stesso paese: non rinomino ${entity.name} per non fare un doppione. ${link}` }
      throw saved.error
    }
    if (!saved.data) return { status: 'failed', outputs: [], queued: [], reply: `${entity.name} è stato modificato proprio adesso da un’altra parte: rimandami l’ordine. ${link}` }
    renamed = saved.data
    const unverified = entity.status === 'VERIFIED' ? ' Era verificato: con il nome nuovo torna da rivedere.' : ''
    first = `Ho rinominato «${entity.name}» in «${renamed.name}» (il vecchio nome resta come alias).${unverified}`
  }
  if (!plan.presentation) return { status: 'done', outputs: [], queued: [], reply: `${first} ${link}` }
  // Un ente nazionale promuove il paese: come in add_entity, la «città» della presentazione è il paese.
  const national = renamed.type_code === 'nto' || renamed.type_code === 'ministry'
  const deckPlan: PresentationPlan = { intent: 'presentation', targets: [renamed.name], count: null, audience: 'destinazione', brief: null,
    city: national && renamed.country_code ? countryName(renamed.country_code) : null, skipped: [], country_code: renamed.country_code, type_code: renamed.type_code }
  const photos = (order.attachments || []).map((a) => a.path)
  if (renamed !== entity) {
    // Una presentazione fatta col nome di prima non si manda come nuova: si riattiva l'ente e si chiede di rigenerarla.
    const old = checked(await admin.from('tourism_decks').select('id,title').eq('user_id', userId).eq('entity_id', entity.id)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()) as { id: string; title: string } | null
    if (old) {
      const activated = await activateEntityForOrder(admin, ctx, userId, renamed, { orderText: order.text, proposedCity: deckPlan.city, resume: `presentazione per ${renamed.name}` })
      const state = activated.ok ? activated.note : activated.reply
      return { status: activated.ok ? 'done' : 'waiting_you', outputs: [], queued: [], awaiting: activated.ok ? undefined : awaitingOf(activated),
        reply: `${first}\n${state}\nC’è già una presentazione fatta col nome di prima, «${old.title}»: aprila e usa «Rigenera» per rifarla con il nome nuovo. ${base}/tourism/presentazioni/${old.id}` }
    }
  }
  const deck = await presentationFor(admin, ctx, userId, renamed, deckPlan, order.text, renamed.name, photos)
  return { ...deck, reply: `${first}\n${deck.reply}` }
}

/**
 * L'ente nel catalogo Tourism: ritrovato per nome, oppure inserito non verificato
 * (lo verifica poi l'attivazione, con le prove del sito). Un archiviato non si riusa.
 */
export async function ensureCatalogEntity(admin: Admin, userId: string, orderId: string,
  input: { name: string; country_code: string; type_code: string; website: string | null }): Promise<{ entity: ActivationEntity; created: boolean } | { reply: string }> {
  const existing = await findEntity(admin, userId, [input.name])
  if (existing) return { entity: existing, created: false }
  const row = { user_id: userId, kind: 'organization', name: input.name, country_code: input.country_code, type_code: input.type_code,
    website: input.website, details: { acquisition: { source: 'office_director', order_id: orderId } } }
  const inserted = await admin.from('tourism_entities').insert(row).select(ENTITY_COLUMNS).single()
  if (!inserted.error) return { entity: inserted.data, created: true }
  if ((inserted.error as { code?: string }).code !== '23505') throw inserted.error
  // Stesso nome e paese già nel catalogo (magari archiviato): si riusa quello.
  const same = checked(await admin.from('tourism_entities').select(ENTITY_COLUMNS).eq('user_id', userId).eq('kind', 'organization')
    .eq('country_code', input.country_code).eq('name_key', nameKey(input.name)).maybeSingle()) as ActivationEntity | null
  if (!same) return { reply: `Non sono riuscito ad aggiungere ${input.name} al catalogo.` }
  if (same.disabled || same.status === 'INACTIVE' || same.status === 'DUPLICATE') return { reply: `${same.name} c’è già nel catalogo ma è archiviato: riattivalo dalla scheda Tourism.` }
  return { entity: same, created: false }
}

/** L'unico contatto del CRM che lavora per quell'organizzazione (stessa azienda, spazi e maiuscole a parte). */
async function contactOfOrganization(admin: Admin, userId: string, organization: string) {
  const pattern = searchPattern(organization)
  if (!pattern) return null
  const rows = (checked(await admin.from('contacts').select('id,name,company').eq('user_id', userId).ilike('company', pattern).limit(5)) || []) as Array<{ id: string; name: string; company: string | null }>
  const same = rows.filter((row) => row.company && compactName(row.company) === compactName(organization))
  return same.length === 1 ? same[0] : null
}

/** Il paese di un contatto del CRM come codice ISO, se si riconosce. */
function countryCode(value: string | null | undefined): string | null {
  const text = (value || '').trim()
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase()
  if (!text) return null
  const names = new Intl.DisplayNames(['it'], { type: 'region' })
  const english = new Intl.DisplayNames(['en'], { type: 'region' })
  const wanted = nameKey(text)
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b)
    try { if ([names.of(code), english.of(code)].some((n) => n && n !== code && nameKey(n) === wanted)) return code } catch { /* codice inesistente */ }
  }
  return null
}

/** Il paese dal dominio nazionale dell'email («@sibiu-turism.ro» → RO). I domini generici non dicono niente. */
export function emailCountry(email: string | null | undefined): string | null {
  const tld = /@[^@\s]+\.([a-z]{2})$/i.exec((email || '').trim())?.[1]?.toUpperCase()
  if (!tld || ['EU', 'IO', 'AI', 'CO', 'ME', 'TV', 'FM', 'LY', 'AC', 'TO', 'GG', 'SH', 'WS', 'CC', 'NU'].includes(tld)) return null
  const code = tld === 'UK' ? 'GB' : tld
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) !== code ? code : null } catch { return null }
}

function countryName(code: string) {
  try { return new Intl.DisplayNames(['it'], { type: 'region' }).of(code) || null } catch { return null }
}

async function findDuplicates(admin: Admin, userId: string, contact: Record<string, string | null>) {
  const found = new Map<string, { id: string; name: string; email: string | null; phone: string | null; company: string | null }>()
  const add = (rows: any[] | null) => (rows || []).forEach((row) => found.set(row.id, row))
  const columns = 'id,name,email,phone,company'
  if (contact.email) add(checked(await admin.from('contacts').select(columns).eq('user_id', userId).ilike('email', contact.email).limit(5)))
  const phone = (contact.phone || '').replace(/\D/g, '')
  if (phone.length >= 8) {
    const rows = checked(await admin.from('contacts').select(columns).eq('user_id', userId).ilike('phone', `%${phone.slice(-4)}%`).limit(50)) as any[]
    add(rows.filter((row) => (row.phone || '').replace(/\D/g, '').endsWith(phone.slice(-8))))
  }
  if (contact.company) add(checked(await admin.from('contacts').select(columns).eq('user_id', userId).ilike('company', contact.company).limit(5)))
  return [...found.values()].slice(0, 5)
}

async function statusReport(admin: Admin, userId: string, now: Date) {
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString()
  const monday = new Date(`${officeRomeDay(now)}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  const [deals, quotes, overdue, activities, timeline, pending, runs, agents, ledger] = await Promise.all([
    officeRows<{ stage: string | null; value: number | null }>(admin, userId, 'deals', 'id,stage,value', (q) => q.is('closed_at', null)),
    officeRows<{ total_amount: number | null }>(admin, userId, 'quotes', 'id,total_amount', (q) => q.eq('status', 'sent')),
    admin.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending')
      .not('contact_id', 'is', null).lt('due_date', now.toISOString()),
    admin.from('activities').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', weekAgo),
    admin.from('activities').select('created_at,content,contact:contacts(name)').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(8),
    admin.from('office_agent_outputs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending'),
    admin.from('office_agent_runs').select('agent_id,status,summary,started_at').eq('user_id', userId).gte('started_at', weekAgo)
      .not('status', 'in', '(skipped_disabled,running)').order('started_at', { ascending: false }).limit(20),
    admin.from('office_agents').select('id,name').eq('user_id', userId),
    officeRows<{ actual_cents: number | null; reserved_cents: number }>(admin, userId, 'office_budget_ledger', 'id,actual_cents,reserved_cents',
      (q) => q.gte('day', monday.toISOString().slice(0, 10))),
  ])
  const names = new Map(((agents.data || []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]))
  return directorStatusLines({
    deals, quotesAwaiting: quotes, overdueTasks: overdue.count || 0, activities7d: activities.count || 0,
    timeline: ((timeline.data || []) as any[]).map((row) => ({ at: row.created_at, who: (Array.isArray(row.contact) ? row.contact[0] : row.contact)?.name || null, content: String(row.content || '') })),
    pendingOutputs: pending.count || 0,
    runs: ((runs.data || []) as any[]).map((run) => ({ agent: names.get(run.agent_id) || run.agent_id, status: run.status, summary: String(run.summary || ''), started_at: run.started_at })),
    spendWeekCents: ledger.reduce((sum, row) => sum + (row.actual_cents ?? row.reserved_cents ?? 0), 0),
  }, { brief: true })
}

/** Tetto di una ricerca fonti in StudioMap (2 $, più margine) e attesa massima della risposta. */
export const EVENT_SOURCES_RESERVE_USD = 2.5
const EVENT_SOURCES_TIMEOUT_MS = 300_000

/** La stessa richiesta per lo stesso ordine: rilavorarlo ritrova la ricevuta in StudioMap invece di ripagare. */
export function eventSourcesRequestId(orderId: string) {
  const h = createHash('sha256').update(`event-sources:${orderId}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * «Trovami le fonti eventi di Marsiglia»: la ricerca la fa StudioMap (la stessa di
 * «Cerca siti eventi»), il CRM la prenota nel budget del Direttore prima e la salda col
 * costo dichiarato dopo. Un rifiuto di StudioMap (400: città assente, Napoli, ricerca già
 * in corso) non ha speso niente; un altro errore lascia la riserva, perché l'esito è incerto.
 */
export async function eventSourcesFor(ctx: AgentContext, order: Pick<DirectorOrderRow, 'id'>,
  plan: Extract<DirectorOrderPlan, { intent: 'event_sources' }>, request = officeStudioRequest): Promise<Outcome> {
  const secret = process.env.OFFICE_BRIDGE_SECRET
  if (!secret || secret.length < 32) return { status: 'failed', outputs: [], queued: [],
    reply: 'Il collegamento con StudioMap non è configurato (OFFICE_BRIDGE_SECRET): non posso cercare le fonti degli eventi.' }
  let origin: string
  try {
    const url = new URL(process.env.OFFICE_STUDIOMAP_URL || 'https://studiomap.speaqi.com')
    if (url.protocol !== 'https:') throw new Error('protocollo')
    origin = url.origin
  } catch {
    return { status: 'failed', outputs: [], queued: [], reply: 'L’indirizzo di StudioMap (OFFICE_STUDIOMAP_URL) non è valido.' }
  }
  const rate = Number(process.env.OFFICE_USD_TO_EUR || '1')
  const usdToEur = Number.isFinite(rate) && rate > 0 ? rate : 1
  let ledgerId: string
  try { ledgerId = await ctx.reserve(Math.ceil(EVENT_SOURCES_RESERVE_USD * 100 * usdToEur)) }
  catch (error) {
    if (error instanceof BudgetExceeded) return { status: 'failed', outputs: [], queued: [],
      reply: `Fonti eventi di ${plan.city}: il budget di oggi del Direttore non basta per la ricerca (fino a 2,50 €). Rimandamelo domani o alza il budget.` }
    throw error
  }
  let result: DirectorEventSourcesResult
  try {
    result = await request('/api/office/event-sources/research',
      { request_id: eventSourcesRequestId(order.id), slug: plan.slug, city: plan.city }, EVENT_SOURCES_TIMEOUT_MS) as DirectorEventSourcesResult
  } catch (error) {
    if (error instanceof OfficeStudioError && error.status === 400) {
      await ctx.settle(ledgerId, 0)
      const reason = errorMessage(error, '').replace(/^StudioMap HTTP 400 — /, '').replace(/: esito da verificare prima di riprovare$/, '')
      return { status: 'failed', outputs: [], queued: [], reply: `Fonti eventi di ${plan.city}: ${reason}` }
    }
    ctx.log(`Fonti eventi ${plan.city}: esito incerto, riserva lasciata impegnata`)
    return { status: 'failed', outputs: [], queued: [], reply: `Fonti eventi di ${plan.city}: StudioMap non ha risposto in modo chiaro (${errorMessage(error, 'errore')}). Controlla il catalogo fonti prima di rimandarmelo, la ricerca potrebbe essere già partita.` }
  }
  const usd = Number(result.cost_usd)
  const cents = Number.isFinite(usd) && usd > 0 ? Math.ceil(usd * 100 * usdToEur) : 0
  await ctx.settle(ledgerId, cents, { model: 'studiomap-event-sources' })
  return { status: result.searched ? 'done' : 'failed', outputs: [], queued: [], reply: directorEventSourcesReply(result, origin, cents) }
}

/** `awaiting`: il dato che il Direttore ha chiesto al titolare, per riprendere l'ordine quando arriva. */
type Outcome = { status: DirectorOrderRow['status']; reply: string; outputs: string[]; queued: QueueResult[]; awaiting?: DirectorAwaiting; result?: { invoice_id: string } }

/** Esegue il piano già validato. Scrive solo uscite, To Do e code. */
export async function executePlan(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: DirectorOrderPlan, now: Date): Promise<Outcome> {
  const userId = order.user_id
  if (plan.intent === 'new_contact') {
    const entity = plan.category === 'destinazione' ? await findEntity(admin, userId, [plan.contact.company, plan.contact.name]) : null
    const duplicates = await findDuplicates(admin, userId, plan.contact)
    const who = plan.contact.name || plan.contact.company!
    const id = await ctx.addOutput({
      kind: 'proposal', key: `order:${order.id}:contact`, title: `Nuovo contatto: ${who}${plan.contact.company && plan.contact.name ? ` (${plan.contact.company})` : ''}`,
      target_table: 'office_director_orders', target_id: order.id,
      body: {
        action: 'create_contact', order_id: order.id, contact: plan.contact, evidence: plan.evidence,
        category: plan.category, tipo: CONTACT_CATEGORY_LABELS[plan.category], perche: plan.category_reason,
        brief: plan.brief, card_text: plan.card_text, scartati: plan.dropped,
        entity_id: entity?.id || null, ente_nel_catalogo: entity?.name || (plan.category === 'destinazione' ? 'Non trovato nel catalogo Tourism' : null),
        possibili_doppioni: duplicates.map((row) => `${row.name}${row.company ? ` · ${row.company}` : ''}${row.email ? ` · ${row.email}` : ''}`),
        duplicate_ids: duplicates.map((row) => row.id),
        dopo_il_clic: contactNextStep(plan.category),
      },
    })
    const dup = duplicates.length ? ` Attenzione: nel CRM c’è già qualcuno di simile (${duplicates[0].name}), controlla prima di approvare.` : ''
    const dropped = plan.dropped.length ? ` Ho lasciato fuori ${plan.dropped.length === 1 ? 'un dato che non trovavo scritto' : `${plan.dropped.length} dati che non trovavo scritti`}.` : ''
    return { status: 'waiting_you', outputs: [id], queued: [], reply:
      `Ho letto ${who}: ${CONTACT_CATEGORY_LABELS[plan.category].split(' (')[0].toLowerCase()}. Te lo propongo in «Aspetta te»: ${contactNextStep(plan.category)}${dup}${dropped}` }
  }
  if (plan.intent === 'build_map') {
    const result = await queueForAgent(admin, userId, 'mymaps_builder', { key: `build_map:${plan.slug}`, slug: plan.slug, city: plan.city, ...(plan.source ? { source: plan.source } : {}) })
    const source = plan.source ? '' : ' Non mi hai dato il link della My Maps: userà solo una fonte già collegata in StudioMap, se c’è.'
    return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `Mappa di ${plan.city}: ${queueSentence(result)}${source}` }
  }
  if (plan.intent === 'check_map') {
    const result = await queueForAgent(admin, userId, 'maps_quality', { key: `check_map:${plan.slug}`, slug: plan.slug, city: plan.city })
    return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `Controllo della mappa di ${plan.city}: ${queueSentence(result)}` }
  }
  if (plan.intent === 'presentation') {
    const photos = (order.attachments || []).map((a) => a.path)
    if (!plan.targets.length) return autoDestinationPresentations(admin, ctx, order, plan)
    const outcomes: Outcome[] = []
    // Le foto mandate con l'ordine vanno alla presentazione nominata, non a tutte.
    for (const target of plan.targets) {
      const one = photos.length && plan.targets.length === 1 ? photos : []
      try {
        outcomes.push(plan.audience === 'partner'
          ? await partnerPresentation(admin, ctx, order, plan, target)
          : await presentationTarget(admin, ctx, order, plan, target, one))
      } catch (error) {
        if (error instanceof BudgetExceeded) { outcomes.push({ status: 'failed', outputs: [], queued: [], reply: `${target}: il budget di oggi del Direttore è finito, rimandamelo domani o alza il budget.` }); break }
        outcomes.push({ status: 'failed', outputs: [], queued: [], reply: `${target}: non ci sono riuscito (${errorMessage(error, 'errore')}).` })
      }
    }
    const skipped = plan.skipped.length ? 'Napoli l’ho lasciata fuori: resta fuori dal lavoro degli agenti.' : ''
    return combineOutcomes(outcomes, skipped)
  }
  if (plan.intent === 'find_partners') return findPartners(admin, ctx, order, plan)
  if (plan.intent === 'add_entity') return addEntity(admin, ctx, order, plan)
  if (plan.intent === 'rename_entity') return renameEntity(admin, ctx, order, plan)
  if (plan.intent === 'help') {
    const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
    return { status: 'done', outputs: [], queued: [], reply: directorHelpText(base) }
  }
  if (plan.intent === 'events') {
    const today = officeRomeDay(now)
    const [events, scout] = await Promise.all([
      admin.from('office_events').select('name,start_date,end_date,city,kind,url,deadlines').eq('user_id', userId)
        .gte('start_date', today).order('start_date', { ascending: true }).limit(8),
      admin.from('office_agents').select('enabled,settings').eq('id', 'events_scout').eq('user_id', userId).maybeSingle(),
    ])
    if (events.error) throw events.error
    if (scout.error) throw scout.error
    const sources = Array.isArray(scout.data?.settings?.sources) ? scout.data.settings.sources.length : 0
    return { status: 'done', outputs: [], queued: [], reply: directorEventsReply((events.data || []) as DirectorEventRow[],
      { installed: !!scout.data, enabled: !!scout.data?.enabled, sources }) }
  }
  if (plan.intent === 'event_sources') return eventSourcesFor(ctx, order, plan)
  if (plan.intent === 'invoice') return invoiceFor(admin, userId, plan)
  if (plan.intent === 'presentation_email') return presentationEmailFor(admin, ctx, userId, plan)
  if (plan.intent === 'task') {
    const outcomes = await createDirectorTasks(admin, userId, order, plan.items)
    return { status: 'done', outputs: [], queued: [], reply: directorTaskReply(outcomes, plan.dropped) }
  }
  if (plan.intent === 'status') {
    // Corta apposta: arriva anche su Telegram. Il dettaglio sta nell'Ufficio.
    const [plan, status] = await Promise.all([loadDirectorPlan(admin, userId, now), statusReport(admin, userId, now)])
    const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
    return { status: 'done', outputs: [], queued: [], reply: ['Il piano di oggi', ...directorPlanBrief(plan), '', 'La situazione', ...status, '', `Tutto il dettaglio nell’Ufficio: ${base}/ufficio`].join('\n') }
  }
  // Una domanda con il dato da completare aspetta la risposta: il messaggio dopo riprende l'ordine.
  if (plan.intent === 'unknown') return plan.awaiting
    ? { status: 'waiting_you', outputs: [], queued: [], reply: plan.question, awaiting: plan.awaiting }
    : { status: 'failed', outputs: [], queued: [], reply: plan.question }
  return { status: 'failed', outputs: [], queued: [], reply: 'Non ho capito cosa devo fare. Scrivimi «cosa posso chiederti?» per l’elenco dei comandi.' }
}

/**
 * Le cose da fare di un ordine: nel To Do, e in Google Calendar quelle con un giorno.
 * Una per riga con la sua chiave (`director-order:<ordine>:<n>`), quindi un ordine rilavorato
 * ritrova le righe e non le raddoppia; un evento già creato non si ricrea. Calendar che non
 * risponde non toglie niente al To Do: lo si dice nella risposta.
 */
async function createDirectorTasks(admin: Admin, userId: string, order: DirectorOrderRow, items: DirectorTaskItem[]): Promise<DirectorTaskOutcome[]> {
  const note = [order.source === 'telegram' ? 'Dal Direttore, su Telegram.' : 'Dal Direttore.', order.text.slice(0, 1000)].filter(Boolean).join('\n\n')
  const outcomes: DirectorTaskOutcome[] = []
  let firstError: unknown = null
  for (const [index, item] of items.entries()) {
    const key = `director-order:${order.id}:${index}`
    const due = directorTaskDue(item)
    let task: { id: string; calendar_event_id: string | null } | null = null
    // Una voce che non si salva non ferma le altre: si dice nella risposta, e rilavorando l'ordine
    // le righe già scritte si ritrovano dalla chiave.
    try {
      const inserted = await admin.from('tasks').insert({
        user_id: userId, contact_id: null, type: 'todo', title: item.title, note,
        due_date: due, priority: 'medium', area: 'speaqi', progress_state: 'todo', progress_percent: 0, status: 'pending',
        idempotency_key: key,
      }).select('id,calendar_event_id').maybeSingle()
      if (inserted.error && (inserted.error as { code?: string }).code !== '23505') throw inserted.error
      task = inserted.data || (checked(await admin.from('tasks').select('id,calendar_event_id').eq('user_id', userId)
        .eq('idempotency_key', key).maybeSingle()) as typeof task)
    } catch (error) {
      firstError ??= error
      outcomes.push({ ...item, calendar: 'not_saved' })
      continue
    }
    if (!due) { outcomes.push({ ...item, calendar: 'no_date' }); continue }
    if (task?.calendar_event_id) { outcomes.push({ ...item, calendar: 'already' }); continue }
    try {
      const event = await addTaskToCalendar(admin, userId, {
        summary: `CRM · ${item.title}`,
        description: ['Attività pianificata in Speaqi CRM', note].join('\n\n'),
        startAt: due,
        allDay: !item.time,
        durationMinutes: item.minutes ?? 30,
      })
      if (!event) { outcomes.push({ ...item, calendar: 'not_connected' }); continue }
      if (task) {
        const saved = await admin.from('tasks').update({
          calendar_event_id: event.id, calendar_event_link: event.htmlLink, calendar_synced_at: new Date().toISOString(),
        }).eq('user_id', userId).eq('id', task.id)
        if (saved.error) console.error('[direttore] evento Calendar non legato al task', { task: task.id, message: saved.error.message })
      }
      outcomes.push({ ...item, calendar: 'added' })
    } catch (error) {
      console.error('[direttore] Google Calendar non ha risposto', { order: order.id, message: errorMessage(error, '').slice(0, 300) })
      outcomes.push({ ...item, calendar: 'failed' })
    }
  }
  // Nessuna salvata: è un errore vero, l'ordine lo riporta. Altrimenti la risposta dice quali mancano.
  if (firstError && outcomes.every((o) => o.calendar === 'not_saved')) throw firstError
  return outcomes
}

/**
 * L'ultimo ordine dalla stessa parte (stessa chat Telegram, o la pagina) prima di `before`,
 * se aspetta una risposta del titolare da meno di un giorno. Solo l'ultimo: una domanda
 * superata da un altro ordine non si riprende più.
 */
export async function pendingDirectorQuestion(admin: Admin, userId: string,
  where: { source: DirectorOrderRow['source']; chatId: string | null; before: string; now?: Date }): Promise<{ id: string; awaiting: DirectorAwaiting } | null> {
  let query = admin.from('office_director_orders').select('id,status,interpretation,updated_at').eq('user_id', userId)
    .eq('source', where.source).lt('created_at', where.before)
  if (where.source === 'telegram') query = where.chatId ? query.eq('telegram_chat_id', where.chatId) : query.is('telegram_chat_id', null)
  let { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  // Una risposta breve può essere la ricevuta di ripresa dello stesso lavoro.
  // La domanda successiva resta sul suo ordine originale, senza creare catene.
  if (!error && data?.status === 'done' && officeWorkEnabled() && typeof data.interpretation?.resumed_from === 'string') {
    let original = admin.from('office_director_orders').select('id,status,interpretation,updated_at')
      .eq('user_id', userId).eq('id', data.interpretation.resumed_from).eq('source', where.source)
    if (where.source === 'telegram') original = where.chatId ? original.eq('telegram_chat_id', where.chatId) : original.is('telegram_chat_id', null)
    const resumed = await original.maybeSingle()
    data = resumed.data; error = resumed.error
  }
  if (error || !data || (data.status !== 'waiting_you' && !(officeWorkEnabled() && data.status === 'blocked'))) return null
  if ((where.now || new Date()).getTime() - new Date(data.updated_at).getTime() > AWAITING_TTL_MS) return null
  const awaiting = readAwaiting(data.interpretation)
  return awaiting ? { id: data.id, awaiting } : null
}

export async function processDirectorOrder(admin: Admin, userId: string, orderId: string, options: { now?: () => Date } = {}): Promise<DirectorOrderRow> {
  const order = checked(await admin.from('office_director_orders').select('*').eq('id', orderId).eq('user_id', userId).single()) as DirectorOrderRow
  if (order.status !== 'received') return order
  if (officeWorkEnabled()) {
    try {
      await enqueueOfficeWork(admin, userId, { agent_id: 'director', action: 'interpret_order', source_key: `order:${order.id}:interpret`,
        origin: 'order', order_id: order.id, priority: 80, status: 'ready', payload: { order_id: order.id } })
    } catch (error) {
      if (!missingWorkSchema(error)) throw error
      // Lo schema può arrivare dopo il codice: il turno successivo recupera l'ordine salvato.
      const reply = 'Ordine salvato. Aggiornamento dell’Ufficio in corso: verrà ripreso automaticamente.'
      checked(await admin.from('office_director_orders').update({ reply }).eq('id', order.id).eq('user_id', userId))
      return { ...order, reply }
    }
    return { ...order, reply: 'Ordine salvato. Il Direttore lo prende in carico nel prossimo turno, senza bisogno di rimandarlo.' }
  }
  // Solo chi sposta l'ordine da "ricevuto" a "in lavorazione" lo lavora.
  const taken = checked(await admin.from('office_director_orders').update({ status: 'working' }).eq('id', order.id)
    .eq('user_id', userId).eq('status', 'received').select('id')) as Array<{ id: string }> | null
  if (!taken?.length) return order
  const now = options.now?.() || new Date()
  let outcome: Outcome | null = null
  let plan: DirectorOrderPlan | null = null
  // La risposta a una domanda del Direttore («ecco il sito …») riprende l'ordine rimasto in
  // sospeso, con le parole che il Direttore aveva chiesto: non è un ordine nuovo senza contesto.
  const pending = order.attachments?.length ? null
    : await pendingDirectorQuestion(admin, userId, { source: order.source, chatId: order.telegram_chat_id, before: order.created_at, now })
  const resumedText = pending ? directorFollowUp(pending.awaiting, order.text) : null
  const work: DirectorOrderRow = resumedText ? { ...order, text: resumedText } : order
  const handler = async (ctx: AgentContext) => {
    const images = await orderImages(admin, work)
    const model = typeof ctx.agent.settings?.model === 'string' ? ctx.agent.settings.model : ctx.agent.model
    const today = officeRomeDay(now)
    const answer = await callModel(ctx, { model, input: directorOrderPrompt(work.text, images.length, today), images,
      maxOutputTokens: ORDER_MODEL_OUTPUT_TOKENS, jsonSchema: { name: 'director_order', schema: DIRECTOR_ORDER_SCHEMA as unknown as Record<string, unknown> } })
    let parsed: unknown = null
    try { parsed = JSON.parse(answer.text) } catch { /* Risposta illeggibile: diventa "non ho capito". */ }
    plan = interpretDirectorOrder(parsed, { text: work.text, today, images: images.length })
    outcome = await executePlan(admin, ctx, work, plan, now)
    return { summary: `Ordine: ${outcome.reply.split('\n')[0].slice(0, 300)}` }
  }
  const result = await runAgentWhenFree('director', handler, { userId, key: `order:${order.id}` })
  const done = outcome as Outcome | null
  const patch: Record<string, unknown> = { run_id: result.run?.id || null }
  if (done) {
    Object.assign(patch, { status: done.status, reply: done.reply, intent: (plan as DirectorOrderPlan | null)?.intent || null,
      interpretation: { ...(plan as DirectorOrderPlan | null || {}),
        ...(done.status === 'waiting_you' && done.awaiting ? { awaiting: done.awaiting } : {}),
        ...(resumedText && pending ? { resumed_from: pending.id, resumed_text: resumedText } : {}) },
      output_ids: done.outputs, queued: done.queued, error: null })
    if (resumedText && pending) {
      // L'ordine di prima non aspetta più te: la sua domanda ha avuto risposta qui.
      await admin.from('office_director_orders').update({ status: 'done' })
        .eq('id', pending.id).eq('user_id', userId).eq('status', 'waiting_you')
    }
    void reportQueuedWork(admin, userId, order.id, 'Esito del lavoro', startQueuedAgents(userId, done.queued, `order:${order.id}`))
  } else if (result.skipped) {
    Object.assign(patch, { status: 'failed', reply: result.skipped === 'disabled'
      ? 'Il Direttore è spento: accendilo dall’Ufficio e rimandami l’ordine.'
      : result.skipped === 'running' ? 'Il Direttore è rimasto occupato per più di tre minuti: rimandami l’ordine.'
      : 'Questo ordine era già stato elaborato.', error: result.skipped })
  } else {
    Object.assign(patch, { status: 'failed', reply: `Non ci sono riuscito: ${result.error || 'errore sconosciuto'}.`, error: result.error || 'errore' })
  }
  const save = () => admin.from('office_director_orders').update(patch).eq('id', order.id).eq('user_id', userId).select('*').single()
  let saved = await save()
  // Un'intenzione più nuova del vincolo sul database (migration non ancora applicata) non deve
  // lasciare l'ordine «in lavorazione» per sempre: si salva senza, l'interpretazione resta.
  if (saved.error && (saved.error as { code?: string }).code === '23514' && patch.intent) {
    patch.intent = null
    saved = await save()
  }
  return checked(saved)
}

const OPPORTUNITY_BY_CATEGORY: Record<string, { pipeline: string; role: string; next_step: string } | undefined> = {
  destinazione: { pipeline: 'tourism', role: 'destinazione', next_step: 'Preparare e mandare la presentazione' },
  partner: { pipeline: 'distribuzione', role: 'distributore', next_step: 'Proporre come distribuire le guide e un pilota' },
  agenzia: { pipeline: 'agency', role: 'cliente_agenzia', next_step: 'Capire il brief e preparare la proposta' },
}

/**
 * Il contatto entra nel percorso unico: un'opportunità nella pipeline del suo
 * tipo, con il prossimo passo fra due giorni. Una già aperta non si duplica.
 */
async function openContactOpportunity(admin: Admin, userId: string, contactId: string, body: any): Promise<string | null> {
  const plan = OPPORTUNITY_BY_CATEGORY[body.category as string]
  const due = new Date(Date.now() + 2 * 86400_000).toISOString()
  if (!plan) {
    if (body.category !== 'cliente_mappe') return null
    // La trattativa di vendita nasce già con il contatto: le si dà solo il ruolo.
    await admin.from('deals').update({ role: 'cliente_mappe' }).eq('user_id', userId).eq('contact_id', contactId)
      .eq('pipeline', 'vendite').is('closed_at', null)
    return null
  }
  const who = body.contact?.company || body.contact?.name || 'contatto'
  const { error } = await admin.from('deals').insert({
    user_id: userId, contact_id: contactId, pipeline: plan.pipeline, role: plan.role, stage: 'qualificata',
    title: `${plan.pipeline === 'tourism' ? 'Tourism' : plan.pipeline === 'distribuzione' ? 'Distribuzione' : 'Agency'} · ${who}`,
    entity_id: body.entity_id || null, next_step: plan.next_step, next_step_due: due,
    evidence: [{ kind: body.card_text ? 'bigliettino' : 'ordine', text: `Contatto passato dal titolare al Direttore${body.brief ? `: ${String(body.brief).slice(0, 300)}` : ''}.` }],
  })
  if (error && (error as { code?: string }).code !== '23505') {
    console.error('[direttore] opportunità non aperta', errorMessage(error, ''))
    return 'L’opportunità non si è aperta: aprila da /opportunita.'
  }
  return `Aperta l’opportunità in ${plan.pipeline} con il prossimo passo «${plan.next_step}».`
}

/**
 * Il clic su "Inserisci il contatto". Prima si prende la proposta (una richiesta
 * alla volta), poi si crea il contatto con legacy_id fisso (unico per workspace:
 * un secondo tentativo lo ritrova invece di duplicarlo), poi si accoda il lavoro
 * e solo alla fine la proposta risulta approvata.
 */
export async function approveDirectorContact(admin: Admin, userId: string, outputId: string) {
  // Una lettura prima: le altre proposte passano dalla sola decisione transazionale.
  const mine = checked(await admin.from('office_agent_outputs').select('id').eq('id', outputId).eq('user_id', userId)
    .eq('agent_id', 'director').eq('kind', 'proposal').eq('body->>action', 'create_contact').maybeSingle())
  if (!mine) return null
  const claim = checked(await admin.rpc('office_director_contact_claim', { p_output_id: outputId, p_user_id: userId })) as { state: string; body?: any }
  if (claim.state === 'not_found') return null
  if (claim.state === 'already_decided') return { error: 'Questa proposta è già stata decisa. Aggiorna la pagina.', status: 409 }
  if (claim.state === 'busy') return { error: 'Sto già inserendo questo contatto: aspetta qualche secondo e aggiorna.', status: 409 }
  const body = claim.body || {}
  const contact = body.contact || {}
  const legacyId = `office-director:${outputId}`
  const readExisting = async () => checked(await admin.from('contacts').select('id,name').eq('user_id', userId).eq('legacy_id', legacyId).maybeSingle()) as { id: string; name: string } | null
  let created = await readExisting()
  if (!created) {
    const note = [contact.role ? `Ruolo: ${contact.role}.` : null, contact.website ? `Sito: ${contact.website}.` : null,
      contact.city ? `Città: ${contact.city}.` : null, body.brief ? `Richiesta: ${body.brief}` : null].filter(Boolean).join(' ')
    try {
      const lead = await createLeadFromInput(admin, userId, {
        name: contact.name || contact.company, company: contact.company, email: contact.email, phone: contact.phone,
        country: contact.country, category: body.category === 'dubbio' ? null : CONTACT_CATEGORY_LABELS[body.category as keyof typeof CONTACT_CATEGORY_LABELS]?.split(' (')[0] || null,
        source: 'office_director', note: note || null, task_note: `Primo contatto: ${contactNextStep(body.category || 'dubbio')}`,
      }, {
        legacyId, isPartner: body.category === 'partner',
        activity: { content: `Arrivato dal Direttore${body.card_text ? ' (bigliettino da visita)' : ''}. Tipo: ${CONTACT_CATEGORY_LABELS[body.category as keyof typeof CONTACT_CATEGORY_LABELS] || 'da decidere'}.`,
          metadata: { event: 'lead_created', source: 'office_director', output_id: outputId, order_id: body.order_id || null } },
      })
      created = { id: lead.lead.id, name: lead.lead.name }
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error
      created = await readExisting()
      if (!created) throw error
    }
  }
  const queued: QueueResult[] = []
  const notes: string[] = []
  if (body.category === 'destinazione') {
    if (body.entity_id) queued.push(await queueForAgent(admin, userId, 'presentations', { key: `presentation:${body.entity_id}`, entity_id: body.entity_id,
      ...(officeWorkEnabled() ? { order_id: body.order_id || null } : {}) }))
    else notes.push('L’ente non è nel catalogo Tourism: aggiungilo (o fallo trovare all’Arricchimento enti), poi chiedimi la presentazione.')
  }
  if (body.category === 'agenzia') {
    queued.push(await queueForAgent(admin, userId, 'agency', { key: `agency:contact:${created!.id}`, contact_id: created!.id, brief: body.brief || null }))
  }
  notes.push(...queued.map(queueSentence))
  const opportunity = await openContactOpportunity(admin, userId, created!.id, body)
  if (opportunity) notes.push(opportunity)
  const done = checked(await admin.rpc('office_director_contact_done', { p_output_id: outputId, p_user_id: userId,
    p_contact_id: created!.id, p_result: { queued, notes } })) as { output: unknown; reason?: string }
  if (!done.output) return { error: 'Questa proposta è già stata decisa. Aggiorna la pagina.', status: 409 }
  void reportQueuedWork(admin, userId, body.order_id || null, `Esito: ${created!.name}`, startQueuedAgents(userId, queued, `contact:${outputId}`))
  const notice = [`Contatto inserito: ${created!.name}.`, ...notes].join(' ')
  if (body.order_id && !officeWorkEnabled()) {
    // L'ordine da cui è nato il contatto non aspetta più te.
    await admin.from('office_director_orders').update({ status: 'done', reply: notice })
      .eq('id', body.order_id).eq('user_id', userId).eq('status', 'waiting_you')
  }
  return { output: done.output, contact_id: created!.id, notice }
}


/**
 * Un'approvazione che accoda lavoro (proposta mappe del Direttore, ente arricchito
 * → Presentazioni) fa partire subito il destinatario se è acceso, come gli ordini,
 * e l'esito arriva su Telegram. Senza, il lavoro aspettava il turno successivo.
 */
export async function startAfterApproval(admin: Admin, userId: string, output: { id: string; agent_id: string; kind: string; title: string; body: any; status: string }) {
  if (officeWorkEnabled()) return
  if (output.status !== 'approved') return
  const recipient = output.agent_id === 'director' && output.kind === 'proposal' ? String(output.body?.recipient_agent_id || '')
    : output.agent_id === 'entity_enricher' && output.body?.action === 'enrich_entity' ? 'presentations' : ''
  if (!recipient) return
  const { data } = await admin.from('office_agents').select('enabled').eq('id', recipient).eq('user_id', userId).maybeSingle()
  if (!data) return
  void reportQueuedWork(admin, userId, null, `Esito: ${output.title}`,
    startQueuedAgents(userId, [{ agent: recipient, queued: true, enabled: !!data.enabled }], `approval:${output.id}`))
}
