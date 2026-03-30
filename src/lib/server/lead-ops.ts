import { isClosedStatus } from '@/lib/data'
import {
  completePendingCallTasks,
  createActivities,
  formatActivityDate,
  syncPendingCallTask,
  updateContactSummary,
} from '@/lib/server/crm'
import {
  createLeadTask,
  normalizeLeadRecord,
  normalizeTaskAction,
  normalizeTaskPriority,
  priorityLevelFromNumber,
  priorityNumberFromLevel,
  readLeadRecord,
  toInternalLeadStatus,
} from '@/lib/server/ai-ready'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function defaultNextActionAt() {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
}

function normalizePriorityValue(value: unknown, fallback = 0) {
  if (typeof value === 'string' && ['low', 'medium', 'high'].includes(value.trim().toLowerCase())) {
    return priorityNumberFromLevel(value)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(3, parsed))
}

function normalizeScoreValue(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function displayValue(value: unknown) {
  const normalized = value === null || value === undefined ? '' : String(value).trim()
  return normalized || 'vuoto'
}

function buildLeadSummary(current: any, next: any) {
  const changes: string[] = []

  if (current.name !== next.name) changes.push(`nome ${displayValue(current.name)} -> ${displayValue(next.name)}`)
  if ((current.company || null) !== (next.company || null)) changes.push('azienda aggiornata')
  if ((current.email || null) !== (next.email || null)) changes.push(`email ${displayValue(current.email)} -> ${displayValue(next.email)}`)
  if ((current.phone || null) !== (next.phone || null)) changes.push(`telefono ${displayValue(current.phone)} -> ${displayValue(next.phone)}`)
  if ((current.status || null) !== (next.status || null)) changes.push(`stato ${displayValue(current.status)} -> ${displayValue(next.status)}`)
  if ((current.country || null) !== (next.country || null)) changes.push('paese aggiornato')
  if ((current.language || null) !== (next.language || null)) changes.push('lingua aggiornata')
  if ((current.assigned_agent || null) !== (next.assigned_agent || null)) changes.push('assegnazione agente aggiornata')
  if (Number(current.score || 0) !== Number(next.score || 0)) changes.push(`score ${current.score || 0} -> ${next.score || 0}`)
  if ((current.next_action_at || null) !== (next.next_action_at || null)) {
    changes.push(`next action ${formatActivityDate(current.next_action_at)} -> ${formatActivityDate(next.next_action_at)}`)
  }
  if ((current.next_followup_at || null) !== (next.next_followup_at || null)) {
    changes.push(`follow-up ${formatActivityDate(current.next_followup_at)} -> ${formatActivityDate(next.next_followup_at)}`)
  }

  if (!changes.length) return null
  return `Lead aggiornato: ${changes.join('; ')}.`
}

function initialTaskAction(body: any, contact: any) {
  return normalizeTaskAction(body.action || body.initial_action, body.type) ||
    (contact.phone ? 'call' : contact.email ? 'send_email' : 'wait')
}

export async function createLeadFromInput(supabase: any, userId: string, body: any) {
  const name = String(body.name || '').trim()
  if (!name) {
    throw new Error('Il nome del lead è obbligatorio')
  }

  const status = toInternalLeadStatus(body.status, 'New')
  const priority = normalizePriorityValue(body.priority, 0)
  const nextActionAt = isClosedStatus(status)
    ? null
    : normalizeDate(body.next_action_at) || normalizeDate(body.next_followup_at) || defaultNextActionAt()
  const requestedAction = normalizeTaskAction(body.action || body.initial_action, body.type)
  const nextFollowupAt = isClosedStatus(status)
    ? null
    : requestedAction === 'call'
      ? normalizeDate(body.next_followup_at) || nextActionAt
      : null

  const insertPayload = {
    user_id: userId,
    name,
    email: normalizeText(body.email),
    phone: normalizeText(body.phone),
    company: normalizeText(body.company),
    country: normalizeText(body.country),
    language: normalizeText(body.language),
    status,
    score: normalizeScoreValue(body.score),
    source: normalizeText(body.source) || 'manual',
    assigned_agent: normalizeText(body.assigned_agent),
    responsible: normalizeText(body.responsible),
    priority,
    value: normalizeNumber(body.value),
    note: normalizeText(body.note),
    last_contact_at: normalizeDate(body.last_contact_at),
    next_action_at: nextActionAt,
    next_followup_at: nextFollowupAt,
    last_activity_summary: normalizeText(body.note),
  }

  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error) throw error

  let task = null
  if (nextActionAt) {
    task = await createLeadTask(supabase, userId, {
      leadId: inserted.id,
      action: requestedAction,
      dueAt: nextActionAt,
      priority: normalizeTaskPriority(body.task_priority || priorityLevelFromNumber(priority)),
      note: normalizeText(body.task_note) || `Next action iniziale per ${inserted.name}`,
      idempotencyKey: `lead:create:${inserted.id}:${nextActionAt}:${requestedAction}`,
    })
  }

  const activityContent = [
    'Lead creato via API AI-ready.',
    `Stato iniziale: ${inserted.status}.`,
    nextActionAt ? `Next action: ${formatActivityDate(nextActionAt)}.` : null,
    task ? 'Task iniziale creato automaticamente.' : null,
  ]
    .filter(Boolean)
    .join(' ')

  await createActivities(supabase, [
    {
      user_id: userId,
      contact_id: inserted.id,
      type: 'system',
      content: activityContent,
      metadata: {
        event: 'lead_created',
        source: 'api_leads',
      },
    },
  ])
  await updateContactSummary(supabase, inserted.id, activityContent, {
    nextFollowupAt: nextFollowupAt,
  })

  const lead = await readLeadRecord(supabase, userId, inserted.id)
  return {
    lead: normalizeLeadRecord(lead),
    task,
  }
}

export async function updateLeadFromInput(
  supabase: any,
  userId: string,
  leadId: string,
  body: any
) {
  const current = await readLeadRecord(supabase, userId, leadId)
  const nextStatus = body.status !== undefined ? toInternalLeadStatus(body.status, current.status || 'New') : current.status || 'New'
  const priority = body.priority !== undefined ? normalizePriorityValue(body.priority, Number(current.priority || 0)) : Number(current.priority || 0)
  const nextActionAt =
    body.next_action_at !== undefined
      ? normalizeDate(body.next_action_at)
      : (current.next_action_at || current.next_followup_at || null)
  const explicitAction = normalizeTaskAction(body.action, body.type)
  const nextFollowupAt =
    isClosedStatus(nextStatus)
      ? null
      : body.next_followup_at !== undefined
        ? normalizeDate(body.next_followup_at)
        : explicitAction === 'call'
          ? nextActionAt
          : current.next_followup_at || null

  const { data: updated, error } = await supabase
    .from('contacts')
    .update({
      name: body.name !== undefined ? String(body.name || '').trim() || current.name : current.name,
      email: body.email !== undefined ? normalizeText(body.email) : current.email,
      phone: body.phone !== undefined ? normalizeText(body.phone) : current.phone,
      company: body.company !== undefined ? normalizeText(body.company) : current.company,
      country: body.country !== undefined ? normalizeText(body.country) : current.country,
      language: body.language !== undefined ? normalizeText(body.language) : current.language,
      status: nextStatus,
      score: body.score !== undefined ? normalizeScoreValue(body.score) : Number(current.score || 0),
      source: body.source !== undefined ? normalizeText(body.source) : current.source,
      assigned_agent: body.assigned_agent !== undefined ? normalizeText(body.assigned_agent) : current.assigned_agent,
      responsible: body.responsible !== undefined ? normalizeText(body.responsible) : current.responsible,
      priority,
      value: body.value !== undefined ? normalizeNumber(body.value) : current.value,
      note: body.note !== undefined ? normalizeText(body.note) : current.note,
      last_contact_at: body.last_contact_at !== undefined ? normalizeDate(body.last_contact_at) : current.last_contact_at,
      next_action_at: isClosedStatus(nextStatus) ? null : nextActionAt,
      next_followup_at: nextFollowupAt,
    })
    .eq('user_id', userId)
    .eq('id', leadId)
    .select('*')
    .single()

  if (error) throw error

  if (isClosedStatus(nextStatus)) {
    await completePendingCallTasks(supabase, userId, leadId)
  } else if (nextFollowupAt) {
    await syncPendingCallTask(supabase, userId, leadId, nextFollowupAt, {
      type: 'follow-up',
      note: normalizeText(body.task_note) || null,
      overwriteNote: !!body.task_note,
    })
  }

  if (!isClosedStatus(nextStatus) && nextActionAt && body.action) {
    await createLeadTask(supabase, userId, {
      leadId,
      action: body.action,
      dueAt: nextActionAt,
      priority: normalizeTaskPriority(body.task_priority || priorityLevelFromNumber(priority)),
      note: normalizeText(body.task_note) || 'Task aggiornata dalla API lead',
      idempotencyKey: normalizeText(body.idempotency_key) || `lead:update:${leadId}:${nextActionAt}:${explicitAction}`,
    })
  }

  const summary = buildLeadSummary(current, updated)
  if (summary) {
    await createActivities(supabase, [
      {
        user_id: userId,
        contact_id: leadId,
        type: 'system',
        content: summary,
        metadata: {
          event: 'lead_updated',
          source: 'api_leads',
        },
      },
    ])
    await updateContactSummary(supabase, leadId, summary, {
      nextFollowupAt: nextFollowupAt,
    })
  }

  const lead = await readLeadRecord(supabase, userId, leadId)
  return normalizeLeadRecord(lead)
}
