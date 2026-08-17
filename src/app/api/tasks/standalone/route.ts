import { NextRequest } from 'next/server'
import { addTaskToCalendar, removeTaskCalendarEvent, updateTaskCalendarEvent } from '@/lib/server/gcal'
import { requireRouteUser } from '@/lib/server/supabase'

function calendarEventForTask(task: { title?: string | null; note?: string | null; due_date?: string | null }) {
  return {
    summary: `CRM · ${task.title || 'Attività'}`,
    description: ['Attività pianificata in Speaqi CRM', task.note || null].filter(Boolean).join('\n\n'),
    startAt: String(task.due_date),
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const status = request.nextUrl.searchParams.get('status') || 'pending'

    const { data, error } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .is('contact_id', null)
      .eq('status', status)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (error) throw error

    return Response.json({ tasks: data || [] })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load standalone tasks' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const title = String(body.title || '').trim()

    if (!title) {
      return Response.json({ error: 'Inserisci un titolo' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('tasks')
      .insert({
        user_id: auth.workspaceUserId,
        contact_id: null,
        type: 'todo',
        title,
        note: body.note ? String(body.note).trim() : null,
        due_date: body.due_date || null,
        priority: body.priority || 'medium',
        status: 'pending',
      })
      .select('*')
      .single()

    if (error) throw error

    return Response.json({ task: data }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create standalone task' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    const calendarAction = body.calendar_action === 'sync' || body.calendar_action === 'unsync'
      ? body.calendar_action
      : null

    if (!id) {
      return Response.json({ error: 'ID task mancante' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = {}
    if (body.title !== undefined) updatePayload.title = String(body.title || '').trim() || null
    if (body.note !== undefined) updatePayload.note = body.note ? String(body.note).trim() : null
    if (body.priority !== undefined) updatePayload.priority = String(body.priority)
    if (body.status !== undefined) updatePayload.status = String(body.status)
    if (body.due_date !== undefined) updatePayload.due_date = body.due_date || null
    if (body.started_at !== undefined) updatePayload.started_at = body.started_at || null
    if (body.status === 'done') updatePayload.completed_at = new Date().toISOString()
    if (body.status === 'pending') updatePayload.completed_at = null

    if (Object.keys(updatePayload).length === 0) {
      return Response.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
    }

    const { data: currentTask, error: currentError } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)
      .single()

    if (currentError) throw currentError
    if (body.due_date !== undefined && (currentTask.due_date || null) !== (body.due_date || null)) {
      updatePayload.rescheduled_at = new Date().toISOString()
      updatePayload.reschedule_count = Number(currentTask.reschedule_count || 0) + 1
    }

    const { data: updatedTask, error } = await auth.supabase
      .from('tasks')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)
      .select('*')
      .single()

    if (error) throw error

    let task = updatedTask
    const clearCalendarLink = async () => {
      const { data, error: clearError } = await auth.supabase
        .from('tasks')
        .update({ calendar_event_id: null, calendar_event_link: null, calendar_synced_at: null })
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .is('contact_id', null)
        .select('*')
        .single()
      if (clearError) throw clearError
      task = data
    }

    const saveCalendarLink = async (event: { id: string; htmlLink: string }) => {
      const { data, error: saveError } = await auth.supabase
        .from('tasks')
        .update({
          calendar_event_id: event.id,
          calendar_event_link: event.htmlLink,
          calendar_synced_at: new Date().toISOString(),
        })
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .is('contact_id', null)
        .select('*')
        .single()
      if (saveError) throw saveError
      task = data
    }

    const removesCalendarEvent = calendarAction === 'unsync' || task.status === 'done' || !task.due_date
    if (removesCalendarEvent && task.calendar_event_id) {
      try {
        await removeTaskCalendarEvent(auth.supabase, auth.workspaceUserId, task.calendar_event_id)
      } catch {
        // A manually deleted or inaccessible Calendar event must not block task completion.
      }
      await clearCalendarLink()
    }

    if (calendarAction === 'sync') {
      if (task.status !== 'pending' || !task.due_date) {
        return Response.json({ error: 'Scegli prima una data per aggiungere l’attività al calendario.' }, { status: 400 })
      }

      const event = task.calendar_event_id
        ? await updateTaskCalendarEvent(auth.supabase, auth.workspaceUserId, task.calendar_event_id, calendarEventForTask(task))
        : await addTaskToCalendar(auth.supabase, auth.workspaceUserId, calendarEventForTask(task))

      if (!event) {
        return Response.json({ error: 'Google Calendar non è collegato. Vai in Gmail e ricollega l’account.' }, { status: 400 })
      }
      await saveCalendarLink(event)
    } else if (
      task.calendar_event_id &&
      (body.title !== undefined || body.note !== undefined || body.due_date !== undefined || body.status !== undefined)
    ) {
      try {
        const event = await updateTaskCalendarEvent(
          auth.supabase,
          auth.workspaceUserId,
          task.calendar_event_id,
          calendarEventForTask(task)
        )
        if (event) await saveCalendarLink(event)
      } catch {
        // The CRM remains the source of truth; a later manual sync can repair the external event.
      }
    }

    return Response.json({ task })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update standalone task' },
      { status: 500 }
    )
  }
}
