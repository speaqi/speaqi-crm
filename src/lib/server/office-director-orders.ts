import { randomUUID } from 'node:crypto'
import { callModel, runAgent, type AgentContext } from './office-agents'
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
  directorEventsReply, interpretDirectorOrder, queuedWorkReport, type DirectorEventRow, type DirectorOrderPlan, type QueuedWork,
} from '../office/director-orders'
import { sendNotificationText } from './whatsapp'
import { createServiceRoleClient } from './supabase'
import { activateEntityForOrder, verifiedDestination, type ActivationEntity } from './office-entity-activation'
import { entitySearchPattern, pickOrderEntity } from '../office/entity-activation'

/**
 * Ordini al Direttore. Tre garanzie da non smontare:
 * 1. L'ordine si salva PRIMA di qualunque lavoro: un guasto lascia la traccia.
 * 2. Il lavoro è una corsa del Direttore con chiave order:<id>: budget prenotato,
 *    interruttore rispettato, e rielaborare lo stesso ordine non spende due volte.
 * 3. Nessuna scrittura sul CRM prima del clic, salvo le attività To Do del titolare
 *    (personali, come dal bot Telegram) e le code degli agenti, che lavorano solo
 *    se il loro interruttore è acceso.
 */

export const DIRECTOR_BUCKET = 'office-director'
export const MAX_ORDER_FILES = 4
export const MAX_ORDER_FILE_BYTES = 8 * 1024 * 1024
const ORDER_MODEL_OUTPUT_TOKENS = 1500

export type DirectorOrderRow = {
  id: string; user_id: string; source: 'web' | 'telegram'; text: string
  attachments: Array<{ path: string; name: string; mime: string; bytes: number }>
  status: 'received' | 'working' | 'done' | 'waiting_you' | 'failed'; intent: string | null
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
    return checked(await admin.from('office_director_orders').update({ attachments }).eq('id', order.id).eq('user_id', userId).select('*').single())
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

async function orderImages(admin: Admin, order: DirectorOrderRow): Promise<string[]> {
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

async function findEntity(admin: Admin, userId: string, names: Array<string | null>) {
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
  return null
}

/**
 * La presentazione di un ente: se non è ancora attivo (non verificato o senza una
 * destinazione), il Direttore lo attiva lui — sito, email, contatto nel CRM — perché
 * l'ordine del titolare è l'autorizzazione. Si ferma solo per chiedere il sito o la città.
 */
async function presentationFor(admin: Admin, ctx: AgentContext, userId: string, entity: ActivationEntity,
  plan: Extract<DirectorOrderPlan, { intent: 'presentation' }>, orderText: string, label: string): Promise<Outcome> {
  let destination = entity.status === 'VERIFIED' ? await verifiedDestination(admin, userId, entity.id) : null
  let note = ''
  if (!destination) {
    const activated = await activateEntityForOrder(admin, ctx, userId, entity, { orderText, proposedCity: plan.city })
    if (!activated.ok) return { status: 'waiting_you', outputs: [], queued: [], reply: activated.reply }
    destination = activated.placeId
    note = `${activated.note} `
  }
  const result = await queueForAgent(admin, userId, 'presentations', { key: `presentation:${entity.id}`, entity_id: entity.id, ...(destination ? { destination_id: destination } : {}) })
  return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `Presentazione per ${label}: ${note}${queueSentence(result)}` }
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

type Outcome = { status: DirectorOrderRow['status']; reply: string; outputs: string[]; queued: QueueResult[] }

/** Esegue il piano già validato. Scrive solo uscite, To Do e code. */
async function executePlan(admin: Admin, ctx: AgentContext, order: DirectorOrderRow, plan: DirectorOrderPlan, now: Date): Promise<Outcome> {
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
    const entity = await findEntity(admin, userId, [plan.target])
    if (entity) return presentationFor(admin, ctx, userId, entity, plan, order.text, entity.name)
    const pattern = searchPattern(plan.target)
    const contacts = pattern ? checked(await admin.from('contacts').select('id,name,company').eq('user_id', userId)
      .or(`name.ilike.${pattern},company.ilike.${pattern}`).limit(3)) as Array<{ id: string; name: string; company: string | null }> : []
    if (contacts.length === 1) {
      // Il contatto di un ente del catalogo: la presentazione è quella dell'ente.
      const owner = contacts[0].company ? await findEntity(admin, userId, [contacts[0].company]) : null
      if (owner) return presentationFor(admin, ctx, userId, owner, plan, order.text, `${owner.name} (${contacts[0].name})`)
      const result = await queueForAgent(admin, userId, 'agency', { key: `agency:contact:${contacts[0].id}`, contact_id: contacts[0].id, brief: plan.brief || order.text })
      return { status: result.reason === 'agent_missing' ? 'failed' : 'done', outputs: [], queued: [result], reply: `${contacts[0].name} non è un ente del catalogo Tourism, quindi è un lavoro da agenzia. ${queueSentence(result)}` }
    }
    return { status: 'failed', outputs: [], queued: [], reply: contacts.length
      ? `Ho trovato più contatti per «${plan.target}» (${contacts.map((c) => c.name).join(', ')}): dimmi quale.`
      : `Non trovo «${plan.target}» né fra gli enti del catalogo Tourism né fra i contatti. Se è nuovo, mandami prima il contatto.` }
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
  if (plan.intent === 'task') {
    const { error } = await admin.from('tasks').insert({
      user_id: userId, contact_id: null, type: 'todo', title: plan.title, note: order.text.slice(0, 1000) || null,
      due_date: plan.due_date, priority: 'medium', area: 'speaqi', progress_state: 'todo', progress_percent: 0, status: 'pending',
      idempotency_key: `director-order:${order.id}`,
    })
    if (error && (error as { code?: string }).code !== '23505') throw error
    return { status: 'done', outputs: [], queued: [], reply: `Segnato nel To Do: «${plan.title}»${plan.due_date ? ` per il ${plan.due_date.slice(8, 10)}/${plan.due_date.slice(5, 7)}` : ''}.` }
  }
  if (plan.intent === 'status') {
    // Corta apposta: arriva anche su Telegram. Il dettaglio sta nell'Ufficio.
    const [plan, status] = await Promise.all([loadDirectorPlan(admin, userId, now), statusReport(admin, userId, now)])
    const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
    return { status: 'done', outputs: [], queued: [], reply: ['Il piano di oggi', ...directorPlanBrief(plan), '', 'La situazione', ...status, '', `Tutto il dettaglio nell’Ufficio: ${base}/ufficio`].join('\n') }
  }
  return { status: 'failed', outputs: [], queued: [], reply: plan.question }
}

export async function processDirectorOrder(admin: Admin, userId: string, orderId: string, options: { now?: () => Date } = {}): Promise<DirectorOrderRow> {
  const order = checked(await admin.from('office_director_orders').select('*').eq('id', orderId).eq('user_id', userId).single()) as DirectorOrderRow
  if (order.status !== 'received') return order
  // Solo chi sposta l'ordine da "ricevuto" a "in lavorazione" lo lavora.
  const taken = checked(await admin.from('office_director_orders').update({ status: 'working' }).eq('id', order.id)
    .eq('user_id', userId).eq('status', 'received').select('id')) as Array<{ id: string }> | null
  if (!taken?.length) return order
  const now = options.now?.() || new Date()
  let outcome: Outcome | null = null
  let plan: DirectorOrderPlan | null = null
  const handler = async (ctx: AgentContext) => {
    const images = await orderImages(admin, order)
    const model = typeof ctx.agent.settings?.model === 'string' ? ctx.agent.settings.model : ctx.agent.model
    const today = officeRomeDay(now)
    const answer = await callModel(ctx, { model, input: directorOrderPrompt(order.text, images.length, today), images,
      maxOutputTokens: ORDER_MODEL_OUTPUT_TOKENS, jsonSchema: { name: 'director_order', schema: DIRECTOR_ORDER_SCHEMA as unknown as Record<string, unknown> } })
    let parsed: unknown = null
    try { parsed = JSON.parse(answer.text) } catch { /* Risposta illeggibile: diventa "non ho capito". */ }
    plan = interpretDirectorOrder(parsed, { text: order.text, today, images: images.length })
    outcome = await executePlan(admin, ctx, order, plan, now)
    return { summary: `Ordine: ${outcome.reply.split('\n')[0].slice(0, 300)}` }
  }
  const result = await runAgentWhenFree('director', handler, { userId, key: `order:${order.id}` })
  const done = outcome as Outcome | null
  const patch: Record<string, unknown> = { run_id: result.run?.id || null }
  if (done) {
    Object.assign(patch, { status: done.status, reply: done.reply, intent: (plan as DirectorOrderPlan | null)?.intent || null,
      interpretation: plan, output_ids: done.outputs, queued: done.queued, error: null })
    void reportQueuedWork(admin, userId, order.id, 'Esito del lavoro', startQueuedAgents(userId, done.queued, `order:${order.id}`))
  } else if (result.skipped) {
    Object.assign(patch, { status: 'failed', reply: result.skipped === 'disabled'
      ? 'Il Direttore è spento: accendilo dall’Ufficio e rimandami l’ordine.'
      : result.skipped === 'running' ? 'Il Direttore è rimasto occupato per più di tre minuti: rimandami l’ordine.'
      : 'Questo ordine era già stato elaborato.', error: result.skipped })
  } else {
    Object.assign(patch, { status: 'failed', reply: `Non ci sono riuscito: ${result.error || 'errore sconosciuto'}.`, error: result.error || 'errore' })
  }
  return checked(await admin.from('office_director_orders').update(patch).eq('id', order.id).eq('user_id', userId).select('*').single())
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
    if (body.entity_id) queued.push(await queueForAgent(admin, userId, 'presentations', { key: `presentation:${body.entity_id}`, entity_id: body.entity_id }))
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
  if (body.order_id) {
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
  if (output.status !== 'approved') return
  const recipient = output.agent_id === 'director' && output.kind === 'proposal' ? String(output.body?.recipient_agent_id || '')
    : output.agent_id === 'entity_enricher' && output.body?.action === 'enrich_entity' ? 'presentations' : ''
  if (!recipient) return
  const { data } = await admin.from('office_agents').select('enabled').eq('id', recipient).eq('user_id', userId).maybeSingle()
  if (!data) return
  void reportQueuedWork(admin, userId, null, `Esito: ${output.title}`,
    startQueuedAgents(userId, [{ agent: recipient, queued: true, enabled: !!data.enabled }], `approval:${output.id}`))
}
