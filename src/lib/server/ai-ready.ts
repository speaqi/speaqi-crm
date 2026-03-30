import { isClosedStatus } from '@/lib/data'
import { isCallTaskType } from '@/lib/schedule'
import type { LeadMemory, NextActionSuggestion, SpecLead } from '@/types'

export type LeadIntent = 'interested' | 'objection' | 'info' | 'not_interested' | 'no_response'
export type LeadStatus = 'new' | 'contacted' | 'replied' | 'interested' | 'not_interested' | 'call_scheduled' | 'closed'
export type TaskAction = 'send_email' | 'call' | 'wait'
export type TaskPriority = 'low' | 'medium' | 'high'

type ContactRow = {
  id: string
  email?: string | null
  phone?: string | null
  name?: string | null
  category?: string | null
  company?: string | null
  country?: string | null
  language?: string | null
  status?: string | null
  score?: number | null
  source?: string | null
  assigned_agent?: string | null
  responsible?: string | null
  value?: number | null
  note?: string | null
  last_contact_at?: string | null
  next_action_at?: string | null
  created_at?: string | null
  updated_at?: string | null
  priority?: number | null
  next_followup_at?: string | null
}

function asDate(value?: string | Date | null) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function nowIso() {
  return new Date().toISOString()
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFreeText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value))
}

function isUniqueViolation(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code) === '23505'
}

function sameDayTime(value: Date, hoursToAdd: number) {
  const next = new Date(value)
  next.setHours(next.getHours() + hoursToAdd)
  return next
}

function moveToCallableSlot(value: string | Date) {
  const date = asDate(value) || new Date()
  const next = new Date(date)

  if (next.getHours() === 0 && next.getMinutes() === 0) {
    next.setHours(10, 0, 0, 0)
  }

  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1)
    next.setHours(10, 0, 0, 0)
  }

  return next.toISOString()
}

export function normalizeLeadStatus(status?: string | null): LeadStatus {
  const normalized = normalizeText(status)

  if (!normalized || normalized === 'new') return 'new'
  if (normalized === 'contacted') return 'contacted'
  if (normalized === 'replied') return 'replied'
  if (normalized === 'interested' || normalized === 'quote') return 'interested'
  if (normalized === 'call booked' || normalized === 'call_booked' || normalized === 'call scheduled') {
    return 'call_scheduled'
  }
  if (normalized === 'closed') return 'closed'
  if (normalized === 'lost' || normalized === 'not interested' || normalized === 'not_interested') {
    return 'not_interested'
  }

  if (normalized.includes('call')) return 'call_scheduled'
  if (normalized.includes('interest') || normalized.includes('quote')) return 'interested'
  if (normalized.includes('reply')) return 'replied'
  if (normalized.includes('contact')) return 'contacted'
  if (normalized.includes('lost') || normalized.includes('not interes')) return 'not_interested'
  if (normalized.includes('closed')) return 'closed'
  return 'new'
}

export function toInternalLeadStatus(status?: string | null, fallback = 'New') {
  switch (normalizeLeadStatus(status)) {
    case 'new':
      return 'New'
    case 'contacted':
      return 'Contacted'
    case 'replied':
      return 'Interested'
    case 'interested':
      return 'Interested'
    case 'call_scheduled':
      return 'Call booked'
    case 'not_interested':
      return 'Lost'
    case 'closed':
      return 'Closed'
    default:
      return fallback
  }
}

export function normalizeTaskPriority(value?: string | null): TaskPriority {
  const normalized = normalizeText(value)
  if (normalized === 'high') return 'high'
  if (normalized === 'low') return 'low'
  return 'medium'
}

export function priorityLevelFromNumber(value?: number | null): TaskPriority {
  const normalized = Number(value || 0)
  if (normalized >= 3) return 'high'
  if (normalized >= 2) return 'medium'
  return 'low'
}

export function priorityNumberFromLevel(priority?: string | null) {
  switch (normalizeTaskPriority(priority)) {
    case 'high':
      return 3
    case 'medium':
      return 2
    default:
      return 1
  }
}

export function normalizeTaskAction(action?: string | null, type?: string | null): TaskAction {
  const normalizedAction = normalizeText(action)
  if (normalizedAction === 'send email' || normalizedAction === 'send_email') return 'send_email'
  if (normalizedAction === 'call') return 'call'
  if (normalizedAction === 'wait') return 'wait'

  const normalizedType = normalizeText(type)
  if (normalizedType === 'email') return 'send_email'
  if (normalizedType === 'follow up' || normalizedType === 'follow-up' || normalizedType === 'call') return 'call'
  return 'wait'
}

export function taskTypeForAction(action?: string | null, fallback?: string | null) {
  const normalizedFallback = normalizeText(fallback)
  if (normalizedFallback === 'email' || normalizedFallback === 'call' || normalizedFallback === 'follow-up') {
    return fallback as string
  }

  switch (normalizeTaskAction(action, fallback)) {
    case 'send_email':
      return 'email'
    case 'call':
      return 'call'
    default:
      return 'follow-up'
  }
}

export function toInternalTaskStatus(status?: string | null) {
  const normalized = normalizeText(status)
  return normalized === 'completed' || normalized === 'done' ? 'done' : 'pending'
}

export function normalizeTaskStatus(status?: string | null) {
  const normalized = normalizeText(status)
  return normalized === 'done' || normalized === 'completed' ? 'completed' : 'pending'
}

export function normalizeActivityType(type?: string | null, metadata?: Record<string, unknown> | null) {
  const normalized = normalizeText(type)
  if (normalized === 'email sent' || normalized === 'email_sent') return 'email_sent'
  if (normalized === 'email open' || normalized === 'email_open') return 'email_open'
  if (normalized === 'email click' || normalized === 'email_click') return 'email_click'
  if (normalized === 'email reply' || normalized === 'email_reply' || normalized === 'email replied' || normalized === 'email_replied') {
    return 'email_reply'
  }
  if (normalized === 'unsubscribe' || normalized === 'unsubscribes' || normalized === 'opt_out') return 'unsubscribe'
  if (normalized === 'call') return 'call'
  if (normalized === 'note') return 'note'

  if (normalized === 'email') {
    if (metadata?.direction === 'inbound') return 'email_reply'
    return 'email_sent'
  }

  return normalized === 'call' ? 'call' : 'note'
}

export function normalizeLeadRecord(contact: ContactRow): SpecLead {
  return {
    id: contact.id,
    email: contact.email || null,
    phone: contact.phone || null,
    name: contact.name || 'Lead',
    category: contact.category || null,
    company: contact.company || null,
    country: contact.country || null,
    language: contact.language || null,
    status: normalizeLeadStatus(contact.status),
    score: clamp(Number(contact.score || 0), 0, 100),
    source: contact.source || null,
    assigned_agent: contact.assigned_agent || null,
    last_contact_at: contact.last_contact_at || null,
    next_action_at: contact.next_action_at || contact.next_followup_at || null,
    created_at: contact.created_at || nowIso(),
    updated_at: contact.updated_at || nowIso(),
  }
}

export function normalizeActivityRecord(row: any) {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id || row.contact_id),
    type: normalizeActivityType(row.type, row.metadata),
    content: row.content || '',
    metadata: row.metadata || {},
    created_at: row.created_at,
  }
}

export function normalizeTaskRecord(row: any) {
  return {
    id: String(row.id),
    lead_id: String(row.lead_id || row.contact_id),
    action: normalizeTaskAction(row.action, row.type),
    due_at: row.due_at || row.due_date || null,
    priority: normalizeTaskPriority(row.priority),
    status: normalizeTaskStatus(row.status),
    note: row.note || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
    type: row.type || taskTypeForAction(row.action, row.type),
    idempotency_key: row.idempotency_key || null,
  }
}

export async function readLeadRecord(supabase: any, userId: string, leadId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', leadId)
    .single()

  if (error) throw error
  return data as ContactRow
}

export async function readLeadActivities(supabase: any, userId: string, leadId: string, limit = 30) {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', leadId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data || []).map(normalizeActivityRecord)
}

export async function readLeadTasks(supabase: any, userId: string, leadId: string, limit = 30) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', leadId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw error
  return (data || []).map(normalizeTaskRecord)
}

export async function readLeadMemory(supabase: any, userId: string, leadId: string) {
  const { data, error } = await supabase
    .from('lead_memories')
    .select('*')
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .maybeSingle()

  if (error) throw error
  return (data || null) as LeadMemory | null
}

export async function upsertLeadMemory(
  supabase: any,
  userId: string,
  leadId: string,
  memory: Partial<LeadMemory>
) {
  const payload = {
    user_id: userId,
    lead_id: leadId,
    summary: normalizeFreeText(memory.summary) || null,
    last_intent: memory.last_intent || null,
    tone: memory.tone || null,
    language_detected: memory.language_detected || null,
    last_updated: nowIso(),
  }

  const { data, error } = await supabase
    .from('lead_memories')
    .upsert(payload, { onConflict: 'user_id,lead_id' })
    .select('*')
    .single()

  if (error) throw error
  return data as LeadMemory
}

export async function logAiDecision(
  supabase: any,
  userId: string,
  kind: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  leadId?: string | null
) {
  try {
    const { error } = await supabase
      .from('ai_decision_logs')
      .insert({
        user_id: userId,
        lead_id: leadId || null,
        kind,
        input,
        output,
      })

    if (error) throw error
  } catch {
    return
  }
}

export async function syncLeadActionDates(supabase: any, userId: string, leadId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, type, action, due_date, status')
    .eq('user_id', userId)
    .eq('contact_id', leadId)
    .eq('status', 'pending')
    .order('due_date', { ascending: true, nullsFirst: false })

  if (error) throw error

  const pendingTasks = (data || []).filter((task: any) => task.due_date)
  const nextActionAt = pendingTasks[0]?.due_date || null
  const nextFollowupAt =
    pendingTasks.find((task: any) => isCallTaskType(task.type) || normalizeTaskAction(task.action, task.type) === 'call')
      ?.due_date || null

  const { error: updateError } = await supabase
    .from('contacts')
    .update({
      next_action_at: nextActionAt,
      next_followup_at: nextFollowupAt,
      updated_at: nowIso(),
    })
    .eq('user_id', userId)
    .eq('id', leadId)

  if (updateError) throw updateError
  return { nextActionAt, nextFollowupAt }
}

export async function createLeadTask(
  supabase: any,
  userId: string,
  input: {
    leadId: string
    action?: string | null
    type?: string | null
    dueAt: string
    priority?: string | null
    note?: string | null
    idempotencyKey?: string | null
    status?: string | null
  }
) {
  const action = normalizeTaskAction(input.action, input.type)
  const type = taskTypeForAction(action, input.type)
  const priority = normalizeTaskPriority(input.priority)
  const status = toInternalTaskStatus(input.status)
  const dueAt = action === 'call' ? moveToCallableSlot(input.dueAt) : input.dueAt
  const payload = {
    user_id: userId,
    contact_id: input.leadId,
    type,
    action,
    due_date: dueAt,
    priority,
    status,
    note: normalizeFreeText(input.note) || null,
    idempotency_key: normalizeFreeText(input.idempotencyKey) || null,
    completed_at: status === 'done' ? nowIso() : null,
  }

  try {
    const { data, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select('*')
      .single()

    if (error) throw error

    await syncLeadActionDates(supabase, userId, input.leadId)
    return data
  } catch (error) {
    if (!payload.idempotency_key || !isUniqueViolation(error)) throw error

    const { data, error: existingError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', payload.idempotency_key)
      .single()

    if (existingError) throw existingError
    await syncLeadActionDates(supabase, userId, input.leadId)
    return data
  }
}

export async function completeLeadTask(supabase: any, userId: string, taskId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: nowIso(),
    })
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('*')
    .single()

  if (error) throw error

  await syncLeadActionDates(supabase, userId, String(data.contact_id))
  return data
}

export async function logLeadActivity(
  supabase: any,
  userId: string,
  input: {
    leadId: string
    type: string
    content: string
    metadata?: Record<string, unknown> | null
  }
) {
  const normalizedType = normalizeActivityType(input.type, input.metadata)
  const content = normalizeFreeText(input.content)

  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      contact_id: input.leadId,
      type: normalizedType,
      content,
      metadata: input.metadata || {},
    })
    .select('*')
    .single()

  if (error) throw error

  const updatePayload: Record<string, unknown> = {
    last_activity_summary: content.slice(0, 180),
    updated_at: nowIso(),
  }

  if (normalizedType === 'email_sent' || normalizedType === 'email_reply' || normalizedType === 'call') {
    updatePayload.last_contact_at = nowIso()
  }

  const { error: contactError } = await supabase
    .from('contacts')
    .update(updatePayload)
    .eq('user_id', userId)
    .eq('id', input.leadId)

  if (contactError) throw contactError

  return data
}

function detectLanguage(text: string) {
  const normalized = normalizeText(text)
  if (!normalized) return 'unknown'
  if (matchesAny(normalized, ['the ', 'please', 'thanks', 'schedule', 'pricing', 'meeting'])) return 'en'
  if (matchesAny(normalized, ['bonjour', 'merci', 'rendez', 'devis'])) return 'fr'
  return 'it'
}

function detectTone(text: string): 'formal' | 'friendly' | 'direct' {
  const normalized = normalizeText(text)
  if (matchesAny(normalized, ['gentile', 'cordiali saluti', 'buongiorno', 'salve'])) return 'formal'
  if (matchesAny(normalized, ['ciao', 'grazie mille', 'volentieri', 'sentiamoci'])) return 'friendly'
  return 'direct'
}

export function classifyReplyHeuristically(emailText: string) {
  const normalized = normalizeText(emailText)

  let intent: LeadIntent = 'info'
  if (
    matchesAny(normalized, [
      'non interess',
      'non mi interessa',
      'no grazie',
      'stop',
      'remove me',
      'unsubscribe',
      'non abbiamo interesse',
    ])
  ) {
    intent = 'not_interested'
  } else if (
    matchesAny(normalized, [
      'interessat',
      'sentiamoci',
      'chiamiamoci',
      'fissiamo',
      'call',
      'appuntamento',
      'procediamo',
      'va bene',
      'parliamone',
    ])
  ) {
    intent = 'interested'
  } else if (
    matchesAny(normalized, [
      'troppo caro',
      'budget',
      'non ora',
      'piu avanti',
      'difficile',
      'fornitore',
      'non e il momento',
      'obiez',
    ])
  ) {
    intent = 'objection'
  } else if (
    matchesAny(normalized, [
      'info',
      'informazioni',
      'dettagli',
      'catalogo',
      'brochure',
      'prezzo',
      'preventivo',
      'quanto costa',
      'mandami',
    ])
  ) {
    intent = 'info'
  }

  return {
    intent,
    tone: detectTone(emailText),
    language_detected: detectLanguage(emailText),
  }
}

function summarizeInteraction(text: string) {
  return normalizeFreeText(text).slice(0, 280)
}

export function updateMemoryHeuristically(currentSummary: string | null | undefined, newInteraction: string) {
  const classification = classifyReplyHeuristically(newInteraction)
  const excerpt = summarizeInteraction(newInteraction)
  const previous = normalizeFreeText(currentSummary).slice(0, 180)
  const summary = [previous, excerpt ? `Ultima interazione: ${excerpt}.` : '', `Intento: ${classification.intent}.`]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)

  return {
    summary,
    last_intent: classification.intent,
    tone: classification.tone,
    language_detected: classification.language_detected,
  }
}

export function scoreLeadHeuristically(input: {
  lead: SpecLead
  memory?: LeadMemory | null
  activities?: Array<{ type: string }>
}) {
  const { lead, memory, activities = [] } = input
  const status = normalizeLeadStatus(lead.status)
  let score = 15

  if (lead.email) score += 12
  if (lead.phone) score += 14
  if (lead.company) score += 8
  if (lead.country) score += 4
  if (lead.language) score += 4
  if (lead.source && lead.source !== 'manual') score += 5

  switch (status) {
    case 'contacted':
      score += 10
      break
    case 'replied':
      score += 20
      break
    case 'interested':
      score += 35
      break
    case 'call_scheduled':
      score += 40
      break
    case 'not_interested':
      score -= 35
      break
    case 'closed':
      score += 10
      break
    default:
      score += 4
      break
  }

  switch (memory?.last_intent) {
    case 'interested':
      score += 15
      break
    case 'info':
      score += 8
      break
    case 'objection':
      score -= 8
      break
    case 'not_interested':
      score -= 25
      break
    default:
      break
  }

  const positiveActivities = activities.filter((activity) => activity.type === 'email_reply' || activity.type === 'call').length
  score += Math.min(positiveActivities * 4, 16)

  const lastContactAt = asDate(lead.last_contact_at)
  if (lastContactAt && Date.now() - lastContactAt.getTime() <= 7 * 24 * 60 * 60 * 1000) {
    score += 6
  }

  return clamp(score, 0, 100)
}

export function suggestNextActionHeuristically(input: {
  lead: SpecLead
  memory?: LeadMemory | null
  lastActivity?: string | null
  history?: string | null
}): NextActionSuggestion {
  const { lead, memory } = input
  const lastActivity = normalizeText(input.lastActivity)
  const history = normalizeText(input.history)
  const status = normalizeLeadStatus(lead.status)

  if (status === 'closed' || status === 'not_interested') {
    return { action: 'wait', delay_hours: 168, priority: 'low', reason: 'Lead non attivo' }
  }

  if (status === 'call_scheduled') {
    return { action: 'wait', delay_hours: 24, priority: 'medium', reason: 'Call gia pianificata' }
  }

  if (memory?.last_intent === 'interested' || lastActivity.includes('reply')) {
    return {
      action: lead.phone ? 'call' : 'send_email',
      delay_hours: 4,
      priority: 'high',
      reason: lead.phone ? 'Lead caldo, meglio contatto rapido' : 'Lead caldo senza telefono, invia email rapida',
    }
  }

  if (memory?.last_intent === 'objection') {
    return { action: lead.phone ? 'call' : 'wait', delay_hours: 48, priority: 'medium', reason: 'Serve gestione obiezione' }
  }

  if (memory?.last_intent === 'info') {
    return { action: lead.email ? 'send_email' : 'call', delay_hours: 6, priority: 'high', reason: 'Ha chiesto informazioni' }
  }

  if (lastActivity.includes('email_open_no_reply') || history.includes('email_open_no_reply')) {
    return { action: lead.email ? 'send_email' : 'call', delay_hours: 24, priority: 'high', reason: 'Email aperta senza risposta' }
  }

  if (lastActivity.includes('email_sent')) {
    return { action: 'wait', delay_hours: 24, priority: 'medium', reason: 'Attendi la finestra di follow-up' }
  }

  if (status === 'new') {
    return {
      action: lead.email ? 'send_email' : lead.phone ? 'call' : 'wait',
      delay_hours: 1,
      priority: 'high',
      reason: 'Primo contatto ancora da fare',
    }
  }

  const lastContactAt = asDate(lead.last_contact_at)
  if (status === 'contacted' && lastContactAt && Date.now() - lastContactAt.getTime() >= 24 * 60 * 60 * 1000) {
    return {
      action: lead.phone ? 'call' : 'send_email',
      delay_hours: 0,
      priority: 'medium',
      reason: 'Contattato ma senza risposta nelle ultime 24h',
    }
  }

  if (!lastContactAt) {
    return {
      action: lead.email ? 'send_email' : lead.phone ? 'call' : 'wait',
      delay_hours: 2,
      priority: 'medium',
      reason: 'Manca una prima interazione tracciata',
    }
  }

  return { action: 'wait', delay_hours: 24, priority: 'low', reason: 'Mantieni osservazione' }
}

export function dueAtFromDelay(action: TaskAction, delayHours: number, baseDate?: string | Date | null) {
  const base = asDate(baseDate) || new Date()
  const due = sameDayTime(base, Math.max(0, delayHours))
  return action === 'call' ? moveToCallableSlot(due) : due.toISOString()
}

function extractTextOutput(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload?.output) ? payload.output : []
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim()
      }
    }
  }

  return ''
}

async function runStructuredModel<T>(input: {
  schemaName: string
  schema: Record<string, unknown>
  system: string
  user: string
}): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini'

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'minimal' },
        text: {
          format: {
            type: 'json_schema',
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: input.system }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: input.user }],
          },
        ],
      }),
    })

    if (!response.ok) return null

    const payload = await response.json()
    const text = extractTextOutput(payload)
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function classifyReplyWithAI(emailText: string) {
  const heuristic = classifyReplyHeuristically(emailText)
  const result = await runStructuredModel<{
    intent: LeadIntent
    tone: 'formal' | 'friendly' | 'direct'
    language_detected: string
  }>({
    schemaName: 'crm_classify_reply',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: {
          type: 'string',
          enum: ['interested', 'objection', 'info', 'not_interested', 'no_response'],
        },
        tone: {
          type: 'string',
          enum: ['formal', 'friendly', 'direct'],
        },
        language_detected: {
          type: 'string',
        },
      },
      required: ['intent', 'tone', 'language_detected'],
    },
    system:
      'Classifichi risposte email commerciali per un CRM. Restituisci solo il JSON richiesto. ' +
      'Usa no_response solo se il testo e vuoto o non contiene una risposta utile.',
    user: `Testo email:\n${emailText}`,
  })

  if (!result) return heuristic
  return {
    intent: result.intent,
    tone: result.tone,
    language_detected: result.language_detected || heuristic.language_detected,
  }
}

export async function updateMemoryWithAI(currentSummary: string | null | undefined, newInteraction: string) {
  const heuristic = updateMemoryHeuristically(currentSummary, newInteraction)
  const result = await runStructuredModel<{
    summary: string
    last_intent: LeadIntent
    tone: 'formal' | 'friendly' | 'direct'
    language_detected: string
  }>({
    schemaName: 'crm_update_memory',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        last_intent: {
          type: 'string',
          enum: ['interested', 'objection', 'info', 'not_interested', 'no_response'],
        },
        tone: { type: 'string', enum: ['formal', 'friendly', 'direct'] },
        language_detected: { type: 'string' },
      },
      required: ['summary', 'last_intent', 'tone', 'language_detected'],
    },
    system:
      'Aggiorni la memoria sintetica di un lead CRM. La summary deve essere breve, operativa e riutilizzabile dagli agenti. ' +
      'Restituisci solo il JSON richiesto.',
    user: `Summary corrente:\n${currentSummary || 'nessuna'}\n\nNuova interazione:\n${newInteraction}`,
  })

  if (!result) return heuristic
  return {
    summary: normalizeFreeText(result.summary).slice(0, 500),
    last_intent: result.last_intent,
    tone: result.tone,
    language_detected: result.language_detected || heuristic.language_detected,
  }
}

export async function scoreLeadWithAI(input: {
  lead: SpecLead
  memory?: LeadMemory | null
  activities?: Array<{ type: string }>
}) {
  const heuristic = scoreLeadHeuristically(input)
  const result = await runStructuredModel<{ score: number }>({
    schemaName: 'crm_score_lead',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
      required: ['score'],
    },
    system:
      'Assegni un lead score commerciale da 0 a 100. 0 significa lead freddo o non rilevante, 100 significa lead molto caldo. ' +
      'Restituisci solo il JSON richiesto.',
    user: JSON.stringify({
      lead: input.lead,
      memory: input.memory || null,
      activities: input.activities || [],
    }),
  })

  if (!result) return heuristic
  return clamp(Math.round(Number(result.score || heuristic)), 0, 100)
}

export async function suggestNextActionWithAI(input: {
  lead: SpecLead
  memory?: LeadMemory | null
  lastActivity?: string | null
  history?: string | null
}) {
  const heuristic = suggestNextActionHeuristically(input)
  const result = await runStructuredModel<NextActionSuggestion>({
    schemaName: 'crm_next_action',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['send_email', 'call', 'wait'],
        },
        delay_hours: {
          type: 'number',
          minimum: 0,
          maximum: 720,
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
        },
        reason: {
          type: ['string', 'null'],
        },
      },
      required: ['action', 'delay_hours', 'priority', 'reason'],
    },
    system:
      'Decidi la prossima azione commerciale per un lead CRM. Devi essere operativo e conservativo: ' +
      'se il lead e caldo privilegia call rapida, se hai appena inviato un email puoi anche aspettare. ' +
      'Restituisci solo il JSON richiesto.',
    user: JSON.stringify(input),
  })

  if (!result) return heuristic
  return {
    action: normalizeTaskAction(result.action),
    delay_hours: Math.max(0, Math.round(Number(result.delay_hours || heuristic.delay_hours))),
    priority: normalizeTaskPriority(result.priority),
    reason: result.reason || heuristic.reason || null,
  }
}

export async function buildLeadContext(supabase: any, userId: string, leadId: string) {
  const [leadRow, memory, activities, tasks] = await Promise.all([
    readLeadRecord(supabase, userId, leadId),
    readLeadMemory(supabase, userId, leadId),
    readLeadActivities(supabase, userId, leadId, 12),
    readLeadTasks(supabase, userId, leadId, 12),
  ])

  const lead = normalizeLeadRecord(leadRow)
  const history = [
    memory?.summary ? `Memory: ${memory.summary}` : null,
    ...activities.map((activity: ReturnType<typeof normalizeActivityRecord>) => `${activity.created_at}: ${activity.type} - ${activity.content}`),
    ...tasks.map((task: ReturnType<typeof normalizeTaskRecord>) => `${task.status} ${task.action} ${task.due_at || 'senza data'}${task.note ? ` - ${task.note}` : ''}`),
  ]
    .filter(Boolean)
    .join('\n')

  return {
    lead,
    memory,
    activities,
    tasks,
    history,
  }
}

export async function syncLeadScore(supabase: any, userId: string, leadId: string) {
  const context = await buildLeadContext(supabase, userId, leadId)
  const score = await scoreLeadWithAI({
    lead: context.lead,
    memory: context.memory,
    activities: context.activities,
  })

  const { error } = await supabase
    .from('contacts')
    .update({
      score,
      updated_at: nowIso(),
    })
    .eq('user_id', userId)
    .eq('id', leadId)

  if (error) throw error
  return score
}

export async function applyReplyOutcome(supabase: any, userId: string, leadId: string, emailText: string) {
  const currentMemory = await readLeadMemory(supabase, userId, leadId)
  const classification = await classifyReplyWithAI(emailText)
  const memoryUpdate = await updateMemoryWithAI(currentMemory?.summary, emailText)
  const leadRow = await readLeadRecord(supabase, userId, leadId)
  const lead = normalizeLeadRecord(leadRow)

  let nextStatus = leadRow.status || 'New'
  if (classification.intent === 'interested') nextStatus = 'Interested'
  if (classification.intent === 'not_interested') nextStatus = 'Lost'
  if (classification.intent === 'info' || classification.intent === 'objection') {
    nextStatus = isClosedStatus(leadRow.status || '') ? String(leadRow.status) : 'Contacted'
  }

  const { error: statusError } = await supabase
    .from('contacts')
    .update({
      status: nextStatus,
      last_contact_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq('user_id', userId)
    .eq('id', leadId)

  if (statusError) throw statusError

  const memory = await upsertLeadMemory(supabase, userId, leadId, memoryUpdate)
  const suggestion = await suggestNextActionWithAI({
    lead: {
      ...lead,
      status: normalizeLeadStatus(nextStatus),
      last_contact_at: nowIso(),
    },
    memory,
    lastActivity: 'email_reply',
    history: emailText,
  })

  const dueAt = dueAtFromDelay(suggestion.action, suggestion.delay_hours)
  const task =
    suggestion.action === 'wait'
      ? await createLeadTask(supabase, userId, {
          leadId,
          action: 'wait',
          dueAt,
          priority: suggestion.priority,
          note: suggestion.reason || 'Attendere e rivalutare il lead',
          idempotencyKey: `reply:${leadId}:${dueAt}:wait`,
        })
      : await createLeadTask(supabase, userId, {
          leadId,
          action: suggestion.action,
          dueAt,
          priority: suggestion.priority,
          note: suggestion.reason || 'Next action generata dal motore AI',
          idempotencyKey: `reply:${leadId}:${dueAt}:${suggestion.action}`,
        })

  const score = await syncLeadScore(supabase, userId, leadId)

  return {
    classification,
    memory,
    next_action: suggestion,
    task: normalizeTaskRecord(task),
    score,
  }
}
