import type { SupabaseClient } from '@supabase/supabase-js'
import { aggregateAutomationOutcome, nextOfficeBudgetCheck, officeWorkNotice, officeWorkSpec, workAutomationOutcome,
  type AutomationOutcome, type WorkNoticeSource, type OfficeWorkItem, type OfficeWorkSpec, type WorkOutcome, type WorkPatch } from '../office-work'
import { createOfficeStore, runAgent, type AgentContext, type OfficeStore } from './office-agents'
import { createServiceRoleClient } from './supabase'
import { errorMessage } from './http'
import { officeWorkEnabled, enqueueOfficeWork } from './office-work-routing'
export { officeWorkEnabled, enqueueOfficeWork } from './office-work-routing'

type Admin = SupabaseClient | any
export class WorkLeaseLost extends Error {
  constructor() { super('La presa in carico del lavoro è scaduta: il vecchio processo si ferma'); this.name = 'WorkLeaseLost' }
}
export function officeWorkSchemaMissing(error: unknown) {
  const e = error as { code?: string; message?: string } | null
  return !!e && (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(e.code || '')
    || /office_work_.*(?:does not exist|schema cache)|(?:table|function).*office_work_.*(?:not found|does not exist)/i.test(e.message || ''))
}
export type WorkEvent = { id: string; user_id: string; work_id: string; event_key: string; body: Record<string, unknown>;
  telegram_chat_id: string | null; lease_token: string; status: string }
export type OfficeWorkStore = {
  enqueue(userId: string, spec: OfficeWorkSpec): Promise<OfficeWorkItem>
  claim(userId: string, limit: number): Promise<OfficeWorkItem[]>
  heartbeat(workId: string, token: string): Promise<boolean>
  active(workId: string, token: string): Promise<boolean>
  transition(workId: string, token: string, patch: WorkPatch): Promise<OfficeWorkItem>
  linkRun(workId: string, token: string, runId: string): Promise<void>
  recover(userId: string): Promise<unknown>
  materializeRecurring?(userId: string): Promise<unknown>
  materializeReport?(userId: string): Promise<unknown>
  retryResearch?(userId: string): Promise<number>
  seedOrders(userId: string): Promise<unknown>
  importQueue?(userId: string): Promise<unknown>
  budgetCheck?(userId: string, agentId: string, now: Date): Promise<string>
  uncertainRun(runId: string): Promise<boolean>
  openState(userId: string): Promise<{ blocked: number; waiting: number }>
  claimEvents(userId: string, limit: number): Promise<WorkEvent[]>
  finishEvent(eventId: string, token: string, status: 'sent' | 'uncertain' | 'failed', error: string | null): Promise<void>
  /** Lo stato attuale dei lavori degli avvisi: decide quali meritano un messaggio. */
  eventWorks?(userId: string, workIds: string[]): Promise<Map<string, WorkNoticeSource>>
}

export function createOfficeWorkStore(admin: Admin): OfficeWorkStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(name, args)
    if (error) throw error
    return data as T
  }
  return {
    enqueue: (userId, spec) => rpc('office_work_enqueue', { p_user_id: userId, p_spec: officeWorkSpec(spec) }),
    claim: (userId, limit) => rpc('office_work_claim', { p_user_id: userId, p_limit: limit }),
    heartbeat: (id, token) => rpc('office_work_heartbeat', { p_work_id: id, p_token: token }),
    active: (id, token) => rpc('office_work_assert_active', { p_work_id: id, p_token: token }),
    transition: (id, token, patch) => rpc('office_work_transition', { p_work_id: id, p_token: token, p_patch: patch }),
    async linkRun(id, token, runId) { await rpc('office_work_link_run', { p_work_id: id, p_token: token, p_run_id: runId }) },
    recover: (userId) => rpc('office_work_recover', { p_user_id: userId }),
    async materializeRecurring(userId) {
      try { return await rpc('office_recurring_materialize', { p_user_id: userId, p_limit: 5 }) }
      catch (error) {
        if (['42883', 'PGRST202', '42P01', 'PGRST205'].includes((error as { code?: string }).code || '')) return null
        throw error
      }
    },
    async materializeReport(userId) {
      try { return await rpc('office_report_materialize', { p_user_id: userId }) }
      catch (error) {
        if (['42883', 'PGRST202', '42P01', 'PGRST205'].includes((error as { code?: string }).code || '')) return null
        throw error
      }
    },
    async retryResearch(userId) {
      const { data, error } = await admin.from('office_work_items').select('id,revision,phase,checkpoint,attempt_count,max_attempts')
        .eq('user_id', userId).eq('agent_id', 'director').eq('action', 'interpret_order').eq('status', 'blocked')
        .in('reason_code', ['entity_missing', 'needs_information']).limit(100)
      if (error) throw error
      let resumed = 0
      for (const work of data || []) {
        const plan = work.checkpoint?.plan
        if (work.phase === 'effect_started' || work.checkpoint?.research_results || plan?.intent !== 'presentation'
          || !Array.isArray(plan.targets) || !plan.targets.length || work.attempt_count >= work.max_attempts) continue
        const result = await rpc<any>('office_work_owner_action', { p_user_id: userId, p_work_id: work.id,
          p_action: 'resume', p_patch: { expected_revision: work.revision } })
        if (result?.work) resumed++
      }
      return resumed
    },
    seedOrders: (userId) => rpc('office_work_seed_orders', { p_user_id: userId }),
    importQueue: (userId) => rpc('office_work_import_queue', { p_user_id: userId }),
    async budgetCheck(userId, agentId, now) {
      const [agent, summary] = await Promise.all([
        admin.from('office_agents').select('daily_budget_cents,weekly_budget_cents,monthly_budget_cents').eq('user_id', userId).eq('id', agentId).maybeSingle(),
        admin.rpc('office_budget_summary', { p_user_id: userId }),
      ])
      if (agent.error) throw agent.error
      if (summary.error) throw summary.error
      const used = (summary.data || []).find((row: any) => row.agent_id === agentId)
      const periods: Array<'day' | 'week' | 'month'> = ['day']
      if (used && agent.data) {
        if (used.week_actual + used.week_reserved >= agent.data.weekly_budget_cents) periods.push('week')
        if (used.month_actual + used.month_reserved >= agent.data.monthly_budget_cents) periods.push('month')
      }
      return periods.map((period) => nextOfficeBudgetCheck(now, period)).sort().at(-1)!
    },
    async uncertainRun(runId) {
      const { data, error } = await admin.from('office_budget_ledger').select('id').eq('run_id', runId)
        .is('actual_cents', null).gt('reserved_cents', 0).limit(1)
      if (error) throw error
      return !!data?.length
    },
    async openState(userId) {
      const counts = await Promise.all([
        admin.from('office_work_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['blocked', 'waiting_owner']),
        admin.from('office_work_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['waiting', 'ready', 'running']),
      ])
      for (const count of counts) if (count.error) throw count.error
      return { blocked: counts[0].count || 0, waiting: counts[1].count || 0 }
    },
    claimEvents: (userId, limit) => rpc('office_work_claim_events', { p_user_id: userId, p_limit: limit }),
    async finishEvent(id, token, status, error) {
      await rpc('office_work_finish_event', { p_event_id: id, p_token: token, p_status: status, p_error: error })
    },
    async eventWorks(userId, workIds) {
      if (!workIds.length) return new Map()
      const { data, error } = await admin.from('office_work_items').select('id,status,action,reason_code,required_action,result')
        .eq('user_id', userId).in('id', workIds)
      if (error) throw error
      return new Map((data || []).map((row: WorkNoticeSource & { id: string }) => [row.id, row]))
    },
  }
}

/** Prima della migration gli ordini restano ricevuti: nessun lavoro volatile di riserva. */
export async function officeWorkAvailable(admin: Admin): Promise<boolean> {
  const { error } = await admin.from('office_work_items').select('id').limit(0)
  if (officeWorkSchemaMissing(error)) return false
  if (error) throw error
  return true
}
export const createWorkStore = createOfficeWorkStore
export const enqueueWork = enqueueOfficeWork
export async function enqueueDirectorOrder(admin: Admin, userId: string, orderId: string) {
  try {
    return await enqueueOfficeWork(admin, userId, { agent_id: 'director', action: 'interpret_order',
      source_key: `order:${orderId}:interpret`, origin: 'order', order_id: orderId, payload: { order_id: orderId }, priority: 90 })
  } catch (error) { if (officeWorkSchemaMissing(error)) return null; throw error }
}

export type WorkExecutor = (ctx: AgentContext, work: OfficeWorkItem, admin: Admin) => Promise<WorkOutcome>
type RunAgent = typeof runAgent
export type WorkRunResult = { id: string; status: OfficeWorkItem['status']; outcome: AutomationOutcome; reason?: string }
export type OfficeWorkerResult = { outcome: AutomationOutcome; reason: string; results: WorkRunResult[]; recovered?: unknown;
  seeded?: unknown; imported?: unknown; notifications?: { sent: number; uncertain: number; failed: number; skipped: number } }
type WorkerOptions = {
  admin?: Admin; store?: OfficeWorkStore; agentStore?: OfficeStore; execute?: WorkExecutor; run?: RunAgent
  now?: () => Date; limit?: number; heartbeatMs?: number; enabled?: boolean; deliverNotifications?: boolean
  sendEvent?: (event: WorkEvent) => Promise<{ ok: boolean; error?: string; certainFailure?: boolean }>
}

// Il recupero dei vecchi blocchi è una bonifica, non serve a ogni turno.
const researchRetryAt = new Map<string, number>()
const RESEARCH_RETRY_INTERVAL_MS = 60 * 60_000

function waiting(work: OfficeWorkItem, reasonCode: string, reason: string, now: Date): WorkOutcome {
  const next = new Date(now.getTime() + 60_000).toISOString()
  return { status: 'waiting', reason_code: reasonCode, reason, required_action: reasonCode === 'agent_disabled'
    ? 'Il titolare può riaccendere l’agente; il lavoro resta salvato' : 'Attendere che l’agente sia disponibile',
  responsible: reasonCode === 'agent_disabled' ? 'titolare' : work.agent_id, next_check_at: next, available_at: next }
}
function blocked(reasonCode: string, reason: string, responsible = 'titolare'): WorkOutcome {
  return { status: 'blocked', reason_code: reasonCode, reason, required_action: reasonCode === 'reconciliation_required'
    ? 'Verificare il tentativo e la ricevuta prima di riprendere: nessuna nuova spesa automatica' : 'Correggere i dati o la configurazione del lavoro',
  responsible, next_check_at: null }
}

async function executeClaimedWork(work: OfficeWorkItem, userId: string, store: OfficeWorkStore, admin: Admin,
  options: WorkerOptions): Promise<WorkRunResult> {
  if (!work.lease_token) throw new WorkLeaseLost()
  const token = work.lease_token
  let lost = false
  const assertActive = async () => { if (lost || !await store.active(work.id, token)) { lost = true; throw new WorkLeaseLost() } }
  const interval = options.heartbeatMs ?? 30_000
  const timer = interval > 0 ? setInterval(() => {
    void store.heartbeat(work.id, token).then((ok) => { if (!ok) lost = true }).catch(() => { lost = true })
  }, interval) : null
  timer?.unref()
  let outcome: WorkOutcome | null = null
  let runId: string | null = null
  try {
    await assertActive()
    const run = options.run || runAgent
    const result = await run(work.agent_id, async (ctx) => {
      runId = ctx.runId
      await store.linkRun(work.id, token, ctx.runId)
      await assertActive()
      const execute = options.execute || (await import('./office-work-handlers')).executeOfficeWork
      outcome = await execute(ctx, work, admin)
      return { summary: outcome.result_summary || outcome.reason || 'Lavoro elaborato' }
    }, { userId, key: `work:${work.id}:v${work.payload_version}:attempt:${work.attempt_count}`,
      store: options.agentStore || createOfficeStore(admin), assertActive })
    if (lost) throw new WorkLeaseLost()
    if (result.skipped === 'disabled' || result.skipped === 'running') {
      outcome = waiting(work, result.skipped === 'disabled' ? 'agent_disabled' : 'agent_busy',
        result.skipped === 'disabled' ? 'L’agente è spento: il lavoro resta in attesa' : 'L’agente sta completando un altro incarico', options.now?.() || new Date())
    } else if (result.skipped === 'duplicate') {
      // Un risultato già concluso non prova che il checkpoint del lavoro sia stato salvato.
      outcome = blocked('reconciliation_required', 'Tentativo già eseguito: verificare il risultato persistente prima di riprendere', work.agent_id)
    } else if (result.run?.status === 'skipped_budget' || (result.run?.status === 'partial' && /budget/i.test(result.error || result.run.error || ''))) {
      const now = options.now?.() || new Date()
      const next = store.budgetCheck ? await store.budgetCheck(userId, work.agent_id, now) : nextOfficeBudgetCheck(now)
      const uncertain = runId ? await store.uncertainRun(runId) : false
      outcome = uncertain || (result.run.cost_cents_actual || 0) > 0 ? blocked('reconciliation_required', 'Il budget si è fermato dopo una spesa: verificare il checkpoint prima di riprendere', work.agent_id) : { ...blocked('budget_exhausted', 'Il budget disponibile non basta; i limiti del titolare restano invariati', work.agent_id),
        required_action: 'Attendere il rinnovo del budget o una modifica esplicita del titolare', next_check_at: next, available_at: next, phase: 'ready' }
    } else if (result.error || result.run?.status === 'failed' || !result.run) {
      const reason = result.error || result.run?.error || 'La corsa non è stata avviata'
      const uncertain = runId ? await store.uncertainRun(runId) : false
      outcome = uncertain || /riserva mantenuta|esito incerto|riconcilia/i.test(reason) ? blocked('reconciliation_required', reason, work.agent_id)
        : /source|fonte|sito|HTTP 400|non configurat|missing|not configured/i.test(reason) ? blocked('input', reason)
          : { status: 'failed', result_summary: reason, reason_code: 'execution', reason,
            required_action: 'Verificare l’errore e riprendere questo lavoro dopo la correzione', responsible: work.agent_id, next_check_at: null }
    }
    if (!outcome) outcome = blocked('reconciliation_required', 'La corsa è terminata senza un risultato verificabile del lavoro', work.agent_id)
    if (runId && await store.uncertainRun(runId)) {
      outcome = blocked('reconciliation_required', 'La corsa conserva una riserva senza saldo: verificare la ricevuta prima di proseguire', work.agent_id)
    }
    if (outcome.status === 'succeeded' && !Object.keys(outcome.result || {}).length) {
      outcome = blocked('reconciliation_required', 'Il lavoro dichiara successo ma manca un riferimento verificabile al risultato', work.agent_id)
    }
    await assertActive()
    const updated = await store.transition(work.id, token, outcome)
    return { id: work.id, status: updated.status, outcome: workAutomationOutcome(updated.status), reason: updated.reason || undefined }
  } catch (error) {
    if (lost || error instanceof WorkLeaseLost || /presa in carico scaduta/i.test(errorMessage(error, ''))) {
      return { id: work.id, status: 'waiting', outcome: 'skipped', reason: 'Presa in carico scaduta: il recupero persistente gestirà il lavoro' }
    }
    const message = errorMessage(error, 'Errore durante il lavoro')
    // Un guasto durante un handler può essere successivo a un effetto esterno: conservare la traccia e riconciliare.
    try {
      const result = await store.transition(work.id, token, blocked('reconciliation_required', message, work.agent_id))
      return { id: work.id, status: result.status, outcome: 'blocked', reason: message }
    } catch (transitionError) {
      return { id: work.id, status: 'failed', outcome: 'failed', reason: `${message}. Esito non salvato: ${errorMessage(transitionError, 'database non disponibile')}` }
    }
  } finally { if (timer) clearInterval(timer) }
}

async function defaultSendEvent(event: WorkEvent) {
  const message = typeof event.body.message === 'string' ? event.body.message : String(event.body.summary || '')
  if (!message.trim()) return { ok: false, error: 'Evento senza messaggio', certainFailure: true }
  if (event.telegram_chat_id) {
    const { telegramConfig, isAllowedChat, sendTelegramMessage } = await import('./telegram')
    const config = telegramConfig()
    if (!config || !isAllowedChat(config, event.telegram_chat_id)) return { ok: false, error: 'Chat Telegram non configurata o non autorizzata', certainFailure: true }
    return sendTelegramMessage(config, event.telegram_chat_id, message)
  }
  const { sendNotificationText } = await import('./whatsapp')
  return sendNotificationText(message, { requiredChannel: 'telegram' })
}

/** Gli avvisi che non portano niente al titolare non partono; restano nello storico come non inviati. */
export const SKIPPED_NOTICE = 'Non inviato: passaggio intermedio, nessuna novità per il titolare.'

export async function deliverOfficeWorkEvents(userId: string, store: OfficeWorkStore, send = defaultSendEvent) {
  const events = await store.claimEvents(userId, 10)
  const counts = { sent: 0, uncertain: 0, failed: 0, skipped: 0 }
  const works = store.eventWorks ? await store.eventWorks(userId, [...new Set(events.map((event) => event.work_id))]) : null
  for (const event of events) {
    let message: string | null = null
    if (works) {
      message = officeWorkNotice(event.body, works.get(event.work_id) || null)
      if (!message) {
        await store.finishEvent(event.id, event.lease_token, 'failed', SKIPPED_NOTICE)
        counts.skipped++
        continue
      }
    }
    let result: { ok: boolean; error?: string; certainFailure?: boolean }
    try { result = await send(message ? { ...event, body: { ...event.body, message } } : event) } catch (error) { result = { ok: false, error: errorMessage(error, 'Consegna incerta') } }
    const status = result.ok ? 'sent' : result.certainFailure ? 'failed' : 'uncertain'
    await store.finishEvent(event.id, event.lease_token, status, result.error || null)
    counts[status]++
  }
  return counts
}

/** Un giro limitato del worker. L'invocazione periodica appartiene al pianificatore già esistente. */
export async function runOfficeWorker(userId: string, options: WorkerOptions = {}): Promise<OfficeWorkerResult> {
  if (!(options.enabled ?? officeWorkEnabled())) return { outcome: 'skipped', reason: 'Worker dei lavori spento: nessun incarico consumato', results: [] }
  try {
    const admin = options.admin || createServiceRoleClient()
    const store = options.store || createOfficeWorkStore(admin)
    if (store.materializeRecurring) await store.materializeRecurring(userId)
    const seeded = await store.seedOrders(userId)
    const imported = store.importQueue ? await store.importQueue(userId) : undefined
    const recovered = await store.recover(userId)
    const now = options.now?.() || new Date()
    if (store.retryResearch && now.getTime() >= (researchRetryAt.get(userId) || 0)) {
      // Un errore della bonifica non deve impedire di elaborare gli altri lavori.
      researchRetryAt.set(userId, now.getTime() + RESEARCH_RETRY_INTERVAL_MS)
      try { await store.retryResearch(userId) }
      catch (error) { console.error('[ufficio] recupero ricerche:', errorMessage(error, 'database non disponibile')) }
    }
    const works = await store.claim(userId, Math.min(10, Math.max(1, options.limit || 4)))
    // Lavori indipendenti procedono in parallelo; il claim SQL e quello della corsa proteggono ogni agente.
    const results = await Promise.all((works || []).map((work) => executeClaimedWork(work, userId, store, admin, options)))
    let reportError: string | null = null
    if (store.materializeReport) {
      try { await store.materializeReport(userId) }
      catch (error) { reportError = errorMessage(error, 'database non disponibile'); console.error('[ufficio] report periodico:', reportError) }
    }
    const open = await store.openState(userId)
    const states = results.map((result) => result.outcome)
    if (open.blocked) states.push('blocked')
    if (reportError) states.push('blocked')
    const outcome = aggregateAutomationOutcome(states)
    let notifications: OfficeWorkerResult['notifications']
    if (options.deliverNotifications !== false) {
      try { notifications = await deliverOfficeWorkEvents(userId, store, options.sendEvent) }
      catch (error) { console.error('[ufficio] notifiche lavori non consegnate:', errorMessage(error, 'database non disponibile')) }
    }
    return { outcome, reason: outcome === 'failed' ? 'Uno o più lavori richiedono verifica dell’errore'
      : reportError ? `Riepilogo periodico non creato: ${reportError}`
      : outcome === 'blocked' ? 'Lavori in attesa di dati, autorizzazione o riconciliazione'
        : outcome === 'succeeded' ? 'Risultati dei lavori salvati' : open.waiting ? 'I lavori restano in attesa della prossima azione' : 'Nessun lavoro pronto',
    results, recovered, seeded, ...(imported === undefined ? {} : { imported }), ...(notifications ? { notifications } : {}) }
  } catch (error) {
    if (officeWorkSchemaMissing(error)) return { outcome: 'blocked', reason: 'Aggiornamento dei lavori in corso: applicare la migration prima di avviare il worker', results: [] }
    return { outcome: 'failed', reason: errorMessage(error, 'Worker dei lavori non disponibile'), results: [] }
  }
}
