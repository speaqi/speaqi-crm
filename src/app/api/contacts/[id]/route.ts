import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import {
  completePendingCallTasks,
  createActivities,
  ensureNextAction,
  formatActivityDate,
  syncPendingCallTask,
  updateContactSummary,
} from '@/lib/server/crm'
import { getGmailAccount, gmailStatus, isMissingRelation } from '@/lib/server/gmail'
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
  if ((current.company || null) !== (next.company || null)) {
    changes.push('azienda aggiornata')
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
  if ((current.next_followup_at || null) !== (next.next_followup_at || null)) {
    changes.push(`follow-up ${formatActivityDate(current.next_followup_at)} -> ${formatActivityDate(next.next_followup_at)}`)
  }

  if (!changes.length) return null
  return `Scheda aggiornata: ${changes.join('; ')}.`
}

async function getContactRecord(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContactRecord(auth.supabase, auth.user.id, id)

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
          .eq('user_id', auth.user.id)
          .eq('contact_id', id)
          .order('created_at', { ascending: false }),
        auth.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', auth.user.id)
          .eq('contact_id', id)
          .order('due_date', { ascending: true, nullsFirst: false }),
        auth.supabase
          .from('gmail_messages')
          .select('*')
          .eq('user_id', auth.user.id)
          .eq('contact_id', id)
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(30),
        getGmailAccount(auth.supabase, auth.user.id, { tolerateMissingRelation: true }),
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
    const current = await getContactRecord(auth.supabase, auth.user.id, id)
    const nextStatus = String(body.status || current.status)
    const requestedFollowupAt =
      body.next_followup_at === ''
        ? null
        : body.next_followup_at
          ? String(body.next_followup_at)
          : current.next_followup_at
    const nextFollowupAt = isClosedStatus(nextStatus) ? null : requestedFollowupAt

    await ensureNextAction(auth.supabase, auth.user.id, id, nextStatus, nextFollowupAt)

    const { data, error } = await auth.supabase
      .from('contacts')
      .update({
        name: body.name ? String(body.name).trim() : current.name,
        email: body.email !== undefined ? normalizeText(body.email) : current.email,
        phone: body.phone !== undefined ? normalizeText(body.phone) : current.phone,
        company: body.company !== undefined ? normalizeText(body.company) : current.company,
        country: body.country !== undefined ? normalizeText(body.country) : current.country,
        language: body.language !== undefined ? normalizeText(body.language) : current.language,
        status: nextStatus,
        source: body.source !== undefined ? normalizeText(body.source) : current.source,
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
          body.responsible !== undefined ? normalizeText(body.responsible) : current.responsible,
        value: body.value !== undefined ? normalizeNumber(body.value) : current.value,
        note: body.note !== undefined ? normalizeText(body.note) : current.note,
        next_action_at: nextFollowupAt,
        next_followup_at: nextFollowupAt,
      })
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    if (isClosedStatus(nextStatus)) {
      await completePendingCallTasks(auth.supabase, auth.user.id, id)
    } else if (nextFollowupAt) {
      await syncPendingCallTask(auth.supabase, auth.user.id, id, nextFollowupAt)
    }

    const activityContent = buildContactUpdateSummary(current, data)
    if (activityContent) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.user.id,
          contact_id: id,
          type: 'system',
          content: activityContent,
        },
      ])
      await updateContactSummary(auth.supabase, id, activityContent, {
        nextFollowupAt: nextFollowupAt,
      })
    }

    return Response.json({ contact: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update contact' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const { error } = await auth.supabase
      .from('contacts')
      .delete()
      .eq('user_id', auth.user.id)
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
