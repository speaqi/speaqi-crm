/** Contratto comune dei lavori dell'Ufficio: azioni chiuse e stati operativi. */
export const OFFICE_WORK_STATUSES = ['waiting', 'ready', 'running', 'blocked', 'waiting_owner', 'succeeded', 'failed', 'cancelled'] as const
export type OfficeWorkStatus = typeof OFFICE_WORK_STATUSES[number]
export type WorkStatus = OfficeWorkStatus
export type AutomationOutcome = 'succeeded' | 'skipped' | 'blocked' | 'failed'
export const OFFICE_WORK_LABELS: Record<OfficeWorkStatus, string> = {
  waiting: 'In attesa', ready: 'Pronto', running: 'In esecuzione', blocked: 'Bloccato', waiting_owner: 'Aspetta te',
  succeeded: 'Riuscito', failed: 'Fallito', cancelled: 'Annullato',
}
export const OFFICE_WORK_ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  director: ['interpret_order', 'director_status', 'list_events', 'record_task', 'create_contact', 'plan', 'agent_run'],
  entity_enricher: ['verify_tourism_entity', 'agent_run'], presentations: ['prepare_presentation', 'agent_run'],
  mymaps_builder: ['import_mymaps', 'agent_run'], maps_quality: ['check_map', 'agent_run'],
  languages_voice: ['complete_languages', 'refresh_outdated', 'agent_run'],
  sales_followup: ['agent_run'], finance: ['agent_run'], db_cleaner: ['agent_run'], news_watch: ['agent_run'],
  events_scout: ['agent_run'], social: ['agent_run'],
})
export const WORK_TERMINAL = new Set<OfficeWorkStatus>(['succeeded', 'failed', 'cancelled'])
export function workStatusLabel(status: string) { return OFFICE_WORK_LABELS[status as OfficeWorkStatus] || status }
export function validWorkAction(agentId: string, action: string) { return Object.hasOwn(OFFICE_WORK_ACTIONS, agentId) && OFFICE_WORK_ACTIONS[agentId].includes(action) }

export type OfficeWorkItem = {
  id: string; user_id: string; order_id: string | null; deal_id: string | null; agent_id: string; action: string
  origin: 'order' | 'approval' | 'director_plan' | 'schedule' | 'manual' | 'legacy'; source_key: string
  source_output_id?: string | null; payload: Record<string, unknown>; payload_version: number; payload_hash?: string
  status: OfficeWorkStatus; priority: number; available_at: string; due_at?: string | null; phase: string | null
  checkpoint: Record<string, unknown>; result: Record<string, unknown>; result_summary: string | null
  reason_code: string | null; reason: string | null; required_action: string | null; responsible: string | null
  next_check_at: string | null; lease_token: string | null; lease_until: string | null; heartbeat_at?: string | null
  attempt_count: number; max_attempts: number; last_run_id: string | null; revision: number
  approval_output_id?: string | null; created_at: string; updated_at: string; finished_at?: string | null
}
export type WorkItem = OfficeWorkItem
export type OfficeWorkSpec = {
  id?: string; agent_id: string; action: string; source_key: string; origin?: OfficeWorkItem['origin']; order_id?: string | null
  deal_id?: string | null; source_output_id?: string | null; payload?: Record<string, unknown>
  approval_output_id?: string | null
  status?: OfficeWorkStatus; priority?: number; available_at?: string; due_at?: string | null; depends_on?: string[]
  reason_code?: string; reason?: string; required_action?: string; responsible?: string; next_check_at?: string | null
}
export type WorkOutcome = {
  status: Exclude<OfficeWorkStatus, 'ready' | 'running'>; phase?: string; checkpoint?: Record<string, unknown>
  result?: Record<string, unknown>; result_summary?: string; reason_code?: string; reason?: string
  required_action?: string; responsible?: string; next_check_at?: string | null; available_at?: string
  output_ids?: string[]; approval_output_id?: string | null; children?: OfficeWorkSpec[]; close_plan?: boolean
}
export type WorkPatch = Omit<Partial<WorkOutcome>, 'children'> & { children?: OfficeWorkSpec[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAYLOAD_FIELDS = new Set(['order_id', 'entity_id', 'destination_id', 'place_id', 'contact_id', 'map_id', 'map_slug', 'slug', 'city',
  'source', 'website', 'target', 'brief', 'title', 'text', 'due_date', 'proposal_id', 'source_output_id', 'slot', 'approved',
  'queue_entry', 'settings', 'action_key', 'target_table', 'target_id', 'include', 'audio', 'proposed_city', 'order_text', 'photos'])
/** Il validatore impedisce deleghe libere e protegge i campi di controllo dal payload. */
export function validateWorkPayload(agentId: string, action: string, raw: unknown): Record<string, unknown> {
  if (!validWorkAction(agentId, action)) throw new Error('Azione o agente non ammesso per un lavoro')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 20_000) throw new Error('Dati del lavoro non validi (massimo 20 KB)')
  const payload = raw as Record<string, unknown>
  for (const [key, value] of Object.entries(payload)) {
    if (!PAYLOAD_FIELDS.has(key)) throw new Error(`Campo del lavoro non ammesso: ${key}`)
    if (key === 'photos' && (action !== 'prepare_presentation' || !Array.isArray(value) || value.length > 8
      || value.some((path) => typeof path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/i.test(path)))) throw new Error('Foto del lavoro non valide')
    if (['order_id', 'entity_id', 'destination_id', 'place_id', 'contact_id', 'map_id', 'proposal_id', 'source_output_id'].includes(key)
      && value !== null && (typeof value !== 'string' || !UUID.test(value))) throw new Error(`Identificativo non valido: ${key}`)
    if (['source', 'website'].includes(key) && value !== null && (typeof value !== 'string' || value.length > 2000)) throw new Error(`Fonte non valida: ${key}`)
    if (['slug', 'map_slug'].includes(key) && value !== null && (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(value))) throw new Error('Slug della mappa non valido')
    if (['text', 'order_text', 'brief'].includes(key) && value !== null && (typeof value !== 'string' || value.length > 4000)) throw new Error('Testo del lavoro troppo lungo')
  }
  if (['import_mymaps', 'check_map', 'complete_languages', 'refresh_outdated'].includes(action)) {
    const identity = [payload.slug, payload.map_slug, payload.city, payload.map_id].filter((x) => typeof x === 'string').join(' ')
    let decoded = identity
    try { decoded = decodeURIComponent(identity) } catch { /* Anche l'identificativo grezzo viene controllato. */ }
    if (/napoli|naples/i.test(decoded.normalize('NFKD'))) throw new Error('Napoli è esclusa dai lavori sulle mappe')
  }
  return structuredClone(payload)
}
export function officeWorkSpec(raw: OfficeWorkSpec): OfficeWorkSpec {
  if (!raw || typeof raw !== 'object' || typeof raw.source_key !== 'string' || !raw.source_key.trim() || raw.source_key.length > 200) throw new Error('Chiave del lavoro non valida')
  if (raw.status && !OFFICE_WORK_STATUSES.includes(raw.status)) throw new Error('Stato del lavoro non valido')
  if (raw.priority !== undefined && (!Number.isInteger(raw.priority) || raw.priority < 0 || raw.priority > 100)) throw new Error('Priorità del lavoro non valida')
  for (const key of ['id', 'order_id', 'deal_id', 'source_output_id', 'approval_output_id'] as const) if (raw[key] && !UUID.test(raw[key]!)) throw new Error(`Identificativo non valido: ${key}`)
  if (raw.depends_on && (raw.depends_on.length > 20 || raw.depends_on.some((id) => !UUID.test(id)))) throw new Error('Dipendenze del lavoro non valide')
  return { ...raw, payload: validateWorkPayload(raw.agent_id, raw.action, raw.payload || {}) }
}
export function aggregateAutomationOutcome(states: AutomationOutcome[]): AutomationOutcome {
  return states.includes('failed') ? 'failed' : states.includes('blocked') ? 'blocked' : states.includes('succeeded') ? 'succeeded' : 'skipped'
}
export function workAutomationOutcome(status: OfficeWorkStatus): AutomationOutcome {
  return status === 'failed' ? 'failed' : status === 'blocked' || status === 'waiting_owner' ? 'blocked' : status === 'succeeded' ? 'succeeded' : 'skipped'
}

/** Prima mezzanotte del calendario italiano successiva alla data indicata, anche nel cambio ora. */
export function nextOfficeBudgetCheck(now: Date, period: 'day' | 'week' | 'month' = 'day'): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((part) => [part.type, part.value]))
  const local = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
  if (period === 'month') local.setUTCMonth(local.getUTCMonth() + 1, 1)
  else local.setUTCDate(local.getUTCDate() + (period === 'week' ? 7 - (local.getUTCDay() + 6) % 7 : 1))
  const wanted = local.getTime()
  let result = wanted
  for (let pass = 0; pass < 3; pass++) {
    const wall = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
      hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(result)).map((p) => [p.type, p.value]))
    const actual = Date.UTC(Number(wall.year), Number(wall.month) - 1, Number(wall.day), Number(wall.hour), Number(wall.minute), Number(wall.second))
    const diff = wanted - actual
    if (!diff) break
    result += diff
  }
  return new Date(result).toISOString()
}
