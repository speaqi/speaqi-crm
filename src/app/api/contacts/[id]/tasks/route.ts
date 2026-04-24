import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import { normalizeTaskAction, normalizeTaskPriority, syncLeadActionDates } from '@/lib/server/ai-ready'
import { addTaskToCalendar } from '@/lib/server/gcal'
import { isCallTaskType } from '@/lib/schedule'
import { createActivities, formatActivityDate, updateContactSummary } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    let contactQuery = auth.supabase
      .from('contacts')
      .select('id')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (!auth.isAdmin) {
      contactQuery = auth.memberName
        ? contactQuery.ilike('responsible', auth.memberName)
        : contactQuery.eq('responsible', '__no_member__')
    }

    const { data: allowedContact } = await contactQuery.single()
    if (!allowedContact) return Response.json({ tasks: [] })

    const { data, error } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('contact_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (error) throw error

    return Response.json({ tasks: data || [] })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load tasks' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const dueDate = String(body.due_date || '')
    const type = String(body.type || 'follow-up')

    if (!dueDate) {
      return Response.json({ error: 'La data del task è obbligatoria' }, { status: 400 })
    }

    let contactQuery = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (!auth.isAdmin) {
      contactQuery = auth.memberName
        ? contactQuery.ilike('responsible', auth.memberName)
        : contactQuery.eq('responsible', '__no_member__')
    }

    const { data: contact, error: contactError } = await contactQuery.single()

    if (contactError) throw contactError

    if (isClosedStatus(contact.status)) {
      return Response.json({ error: 'Non puoi aggiungere task a un contatto chiuso' }, { status: 400 })
    }

    const { data: task, error } = await auth.supabase
      .from('tasks')
      .insert({
        user_id: auth.workspaceUserId,
        contact_id: id,
        type,
        action: normalizeTaskAction(body.action, type),
        due_date: dueDate,
        priority: normalizeTaskPriority(body.priority),
        status: 'pending',
        note: body.note ? String(body.note) : null,
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
      })
      .select('*')
      .single()

    if (error) throw error

    const syncedDates = await syncLeadActionDates(auth.supabase, auth.workspaceUserId, id)

    if (isCallTaskType(type) && task.due_date) {
      addTaskToCalendar(auth.supabase, auth.workspaceUserId, {
        summary: `Chiamata: ${contact.name}`,
        description: [
          contact.phone ? `Tel: ${contact.phone}` : null,
          task.note || null,
        ].filter(Boolean).join('\n'),
        startAt: task.due_date,
      }).catch(() => {})
    }

    const activityContent = [
      `Creato task ${task.type}.`,
      `Scadenza: ${formatActivityDate(task.due_date)}.`,
      task.note ? `Nota: ${task.note}.` : null,
    ]
      .filter(Boolean)
      .join(' ')

    await createActivities(auth.supabase, [
      {
        user_id: auth.workspaceUserId,
        contact_id: id,
        type: 'task',
        content: activityContent,
      },
    ])
    await updateContactSummary(auth.supabase, id, activityContent, {
      nextFollowupAt: isCallTaskType(type) ? syncedDates.nextFollowupAt : undefined,
    })

    return Response.json({ task }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    )
  }
}
