import { NextRequest } from 'next/server'
import { isClosedStatus, normalizeContactScope } from '@/lib/data'
import {
  completePendingCallTasks,
  createActivities,
  ensureNextAction,
  formatActivityDate,
  syncPendingCallTask,
  updateContactSummary,
} from '@/lib/server/crm'
import { getGmailAccount, gmailStatus, isMissingRelation } from '@/lib/server/gmail'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function isMissingOptionalContactColumn(error: unknown, column: 'email_draft_note' | 'personal_section') {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function buildContactUpdateFallbackPayload(payload: Record<string, unknown>, error: unknown) {
  const fallback = { ...payload }
  let changed = false

  if (isMissingOptionalContactColumn(error, 'email_draft_note')) {
    delete fallback.email_draft_note
    changed = true
  }
  if (isMissingOptionalContactColumn(error, 'personal_section')) {
    delete fallback.personal_section
    changed = true
  }

  return changed ? fallback : null
}

function isNoRowsError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code?: unknown }).code) === 'PGRST116'
  )
}

function displayValue(value: unknown) {
  const normalized = value === null || value === undefined ? '' : String(value).trim()
  return normalized || 'vuoto'
}

function buildContactUpdateSummary(current: any, next: any) {
  const changes: string[] = []

  if (current.name !== next.name) {
    changes.push(`nome ${displayValue(current.name)} -> ${displayValue(next.name)}`)
  }
  if (current.status !== next.status) {
    changes.push(`stato ${displayValue(current.status)} -> ${displayValue(next.status)}`)
  }
  if ((current.email || null) !== (next.email || null)) {
    changes.push(`email ${displayValue(current.email)} -> ${displayValue(next.email)}`)
  }
  if ((current.phone || null) !== (next.phone || null)) {
    changes.push(`telefono ${displayValue(current.phone)} -> ${displayValue(next.phone)}`)
  }
  if ((current.category || null) !== (next.category || null)) {
    changes.push(`categoria ${displayValue(current.category)} -> ${displayValue(next.category)}`)
  }
  if ((current.company || null) !== (next.company || null)) {
    changes.push('azienda aggiornata')
  }
  if ((current.event_tag || null) !== (next.event_tag || null)) {
    changes.push(`evento ${displayValue(current.event_tag)} -> ${displayValue(next.event_tag)}`)
  }
  if ((current.list_name || null) !== (next.list_name || null)) {
    changes.push(`lista ${displayValue(current.list_name)} -> ${displayValue(next.list_name)}`)
  }
  if ((current.country || null) !== (next.country || null)) {
    changes.push('paese aggiornato')
  }
  if ((current.language || null) !== (next.language || null)) {
    changes.push('lingua aggiornata')
  }
  if ((current.responsible || null) !== (next.responsible || null)) {
    changes.push(`responsabile ${displayValue(current.responsible)} -> ${displayValue(next.responsible)}`)
  }
  if ((current.assigned_agent || null) !== (next.assigned_agent || null)) {
    changes.push('assegnazione agente aggiornata')
  }
  if ((current.source || null) !== (next.source || null)) {
    changes.push(`origine ${displayValue(current.source)} -> ${displayValue(next.source)}`)
  }
  if ((current.contact_scope || 'crm') !== (next.contact_scope || 'crm')) {
    changes.push(
      (next.contact_scope || 'crm') === 'holding'
        ? 'spostato in lista separata'
        : (next.contact_scope || 'crm') === 'personal'
          ? 'spostato in area personale'
        : 'promosso nel CRM operativo'
    )
  }
  if ((current.personal_section || null) !== (next.personal_section || null)) {
    changes.push(`sezione personale ${displayValue(current.personal_section)} -> ${displayValue(next.personal_section)}`)
  }
  if (Number(current.priority || 0) !== Number(next.priority || 0)) {
    changes.push(`priorità ${current.priority} -> ${next.priority}`)
  }
  if (Number(current.score || 0) !== Number(next.score || 0)) {
    changes.push(`score ${current.score || 0} -> ${next.score || 0}`)
  }
  if ((current.value ?? null) !== (next.value ?? null)) {
    changes.push(`valore ${displayValue(current.value)} -> ${displayValue(next.value)}`)
  }
  if ((current.note || null) !== (next.note || null)) {
    changes.push('note aggiornate')
  }
  if ((current.email_draft_note || null) !== (next.email_draft_note || null)) {
    changes.push('nota bozza email aggiornata')
  }
  if ((current.next_followup_at || null) !== (next.next_followup_at || null)) {
    changes.push(`follow-up ${formatActivityDate(current.next_followup_at)} -> ${formatActivityDate(next.next_followup_at)}`)
  }

  if (!changes.length) return null
  return `Scheda aggiornata: ${changes.join('; ')}.`
}

async function getContactRecord(supabase: any, userId: string, id: string, responsible?: string | null) {
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)

  if (responsible) {
    const assigneeOr = contactAssigneeMatchOrFilter(responsible)
    if (assigneeOr) query = query.or(assigneeOr)
  }

  const { data, error } = await query.single()

  if (error) {
    if (isNoRowsError(error)) return null
    throw error
  }
  return data
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    const [
      { data: activities, error: activitiesError },
      { data: tasks, error: tasksError },
      emailsResult,
      gmailAccount,
    ] =
      await Promise.all([
        auth.supabase
          .from('activities')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('created_at', { ascending: false }),
        auth.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('due_date', { ascending: true, nullsFirst: false }),
        auth.supabase
          .from('gmail_messages')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(30),
        getGmailAccount(auth.supabase, auth.workspaceUserId, { tolerateMissingRelation: true }),
      ])

    if (activitiesError) throw activitiesError
    if (tasksError) throw tasksError

    if (emailsResult.error && !isMissingRelation(emailsResult.error)) {
      throw emailsResult.error
    }

    const emails = emailsResult.data || []

    return Response.json({
      contact,
      activities: activities || [],
      tasks: tasks || [],
      emails,
      gmail: gmailStatus(gmailAccount),
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load contact' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const current = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!current) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }
    const nextStatus = String(body.status || current.status)
    const nextContactScope = normalizeContactScope(body.contact_scope, current.contact_scope || 'crm')
    const requestedFollowupAt =
      body.next_followup_at === ''
        ? null
        : body.next_followup_at
          ? String(body.next_followup_at)
          : current.next_followup_at
    const nextFollowupAt =
      nextContactScope === 'holding' || isClosedStatus(nextStatus)
        ? null
        : requestedFollowupAt

    if (nextContactScope === 'crm') {
      await ensureNextAction(auth.supabase, auth.workspaceUserId, id, nextStatus, nextFollowupAt)
    }

    const normalizedCompany = body.company !== undefined ? normalizeText(body.company) : current.company
    const updatePayload: Record<string, unknown> = {
      name: body.name ? String(body.name).trim() : current.name,
      email: body.email !== undefined ? normalizeText(body.email) : current.email,
      phone: body.phone !== undefined ? normalizeText(body.phone) : current.phone,
      category: body.category !== undefined ? normalizeText(body.category) : current.category,
      company: normalizedCompany,
      event_tag: body.event_tag !== undefined ? normalizeText(body.event_tag) : current.event_tag,
      list_name: body.list_name !== undefined ? normalizeText(body.list_name) : current.list_name,
      personal_section:
        body.personal_section !== undefined
          ? nextContactScope === 'personal'
            ? normalizeText(body.personal_section)
            : null
          : nextContactScope === 'personal'
            ? current.personal_section
            : null,
      country: body.country !== undefined ? normalizeText(body.country) : current.country,
      language: body.language !== undefined ? normalizeText(body.language) : current.language,
      status: nextStatus,
      source: body.source !== undefined ? normalizeText(body.source) : current.source,
      contact_scope: nextContactScope,
      promoted_at:
        (current.contact_scope || 'crm') !== 'crm' && nextContactScope === 'crm'
          ? new Date().toISOString()
          : current.promoted_at,
      priority:
        body.priority !== undefined
          ? Math.max(0, Math.min(3, Number(body.priority || 0)))
          : current.priority,
      score:
        body.score !== undefined
          ? Math.max(0, Math.min(100, Number(body.score || 0)))
          : current.score,
      assigned_agent:
        body.assigned_agent !== undefined ? normalizeText(body.assigned_agent) : current.assigned_agent,
      responsible:
        auth.isAdmin
          ? body.responsible !== undefined
            ? normalizeText(body.responsible)
            : current.responsible
          : current.responsible,
      value: body.value !== undefined ? normalizeNumber(body.value) : current.value,
      note: body.note !== undefined ? normalizeText(body.note) : current.note,
      email_draft_note:
        body.email_draft_note !== undefined ? normalizeText(body.email_draft_note) : current.email_draft_note,
      next_action_at: nextFollowupAt,
      next_followup_at: nextFollowupAt,
    }

    let data: any = null
    let updateError: unknown = null

    const firstUpdate = await auth.supabase
      .from('contacts')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .single()

    if (!firstUpdate.error) {
      data = firstUpdate.data
    } else {
      const fallbackPayload = buildContactUpdateFallbackPayload(updatePayload, firstUpdate.error)
      if (fallbackPayload) {
      const retryUpdate = await auth.supabase
        .from('contacts')
        .update(fallbackPayload)
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .select('*')
        .single()

      data = retryUpdate.data
      updateError = retryUpdate.error
      } else {
        updateError = firstUpdate.error
      }
    }

    if (updateError) throw updateError

    if (isClosedStatus(nextStatus)) {
      await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
    } else if (nextContactScope === 'holding') {
      await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
    } else if (nextFollowupAt) {
      await syncPendingCallTask(auth.supabase, auth.workspaceUserId, id, nextFollowupAt)
    }

    const activityContent = buildContactUpdateSummary(current, data)
    if (activityContent) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: id,
          type: 'system',
          content: activityContent,
        },
      ])
      await updateContactSummary(auth.supabase, id, activityContent, {
        nextFollowupAt: nextContactScope === 'holding' ? null : nextFollowupAt,
      })
    }

    return Response.json({ contact: data })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to update contact') },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    const { error } = await auth.supabase
      .from('contacts')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (error) throw error

    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to delete contact' },
      { status: 500 }
    )
  }
}
