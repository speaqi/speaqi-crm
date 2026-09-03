import { NextRequest } from 'next/server'
import { addTaskToCalendar, removeTaskCalendarEvent, updateTaskCalendarEvent } from '@/lib/server/gcal'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { resolveProgress, type ProgressLevers } from '@/lib/todo'
import type { TodoArea, TodoProgressState } from '@/types'

const AREAS: TodoArea[] = ['speaqi', 'personale', 'altro']
const PROGRESS_STATES: TodoProgressState[] = ['todo', 'in_progress', 'blocked', 'done']

function normalizeArea(value: unknown): TodoArea | null {
  const normalized = String(value || '').trim().toLowerCase()
  return (AREAS as string[]).includes(normalized) ? (normalized as TodoArea) : null
}

function normalizeProgressState(value: unknown): TodoProgressState | null {
  const normalized = String(value || '').trim().toLowerCase()
  return (PROGRESS_STATES as string[]).includes(normalized) ? (normalized as TodoProgressState) : null
}

function normalizePercent(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

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
      { error: errorMessage(error, 'Impossibile caricare le attività') },
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

    const area = normalizeArea(body.area)
    if (body.area !== undefined && !area) {
      return Response.json({ error: 'Area non valida' }, { status: 400 })
    }

    // Stesse leve del PATCH, stessa riconciliazione: creare un'attività già
    // "fatta" allo 0% (o al 100% ma "da fare") deve essere impossibile anche
    // da qui, non solo dagli aggiornamenti.
    const levers: ProgressLevers = {}

    if (body.progress_percent !== undefined) {
      const value = normalizePercent(body.progress_percent)
      if (value === null) return Response.json({ error: 'Percentuale non valida' }, { status: 400 })
      levers.progress_percent = value
    }

    if (body.progress_state !== undefined) {
      const value = normalizeProgressState(body.progress_state)
      if (!value) return Response.json({ error: 'Stato di avanzamento non valido' }, { status: 400 })
      levers.progress_state = value
    }

    const progress = resolveProgress(
      { status: 'pending', progress_state: 'todo', progress_percent: 0 },
      levers
    )
    const now = new Date().toISOString()

    const { data, error } = await auth.supabase
      .from('tasks')
      .insert({
        user_id: auth.workspaceUserId,
        contact_id: null,
        type: 'todo',
        title,
        note: body.note ? String(body.note).trim() : null,
        due_date: body.due_date || null,
        start_date: body.start_date || null,
        priority: body.priority || 'medium',
        area: area || 'speaqi',
        progress_state: progress.progress_state,
        progress_percent: progress.progress_percent,
        status: progress.status,
        started_at: progress.progress_state === 'in_progress' ? now : null,
        completed_at: progress.status === 'done' ? now : null,
      })
      .select('*')
      .single()

    if (error) throw error

    return Response.json({ task: data }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Impossibile creare l’attività') },
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
    if (body.due_date !== undefined) updatePayload.due_date = body.due_date || null
    if (body.start_date !== undefined) updatePayload.start_date = body.start_date || null
    if (body.started_at !== undefined) updatePayload.started_at = body.started_at || null

    if (body.area !== undefined) {
      const area = normalizeArea(body.area)
      if (!area) return Response.json({ error: 'Area non valida' }, { status: 400 })
      updatePayload.area = area
    }

    const touchesProgress =
      body.status !== undefined || body.progress_state !== undefined || body.progress_percent !== undefined

    if (Object.keys(updatePayload).length === 0 && !touchesProgress && !calendarAction) {
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

    if (touchesProgress) {
      const levers: ProgressLevers = {}

      if (body.progress_percent !== undefined) {
        const value = normalizePercent(body.progress_percent)
        if (value === null) return Response.json({ error: 'Percentuale non valida' }, { status: 400 })
        levers.progress_percent = value
      }

      if (body.progress_state !== undefined) {
        const value = normalizeProgressState(body.progress_state)
        if (!value) return Response.json({ error: 'Stato di avanzamento non valido' }, { status: 400 })
        levers.progress_state = value
      }

      if (body.status !== undefined) {
        levers.status = String(body.status) === 'done' ? 'done' : 'pending'
      }

      const wasDone = currentTask.status === 'done'
      const resolved = resolveProgress(
        {
          status: wasDone ? 'done' : 'pending',
          progress_state: normalizeProgressState(currentTask.progress_state) || (wasDone ? 'done' : 'todo'),
          progress_percent: normalizePercent(currentTask.progress_percent) ?? (wasDone ? 100 : 0),
        },
        levers
      )

      updatePayload.progress_state = resolved.progress_state
      updatePayload.progress_percent = resolved.progress_percent
      updatePayload.status = resolved.status
      updatePayload.completed_at =
        resolved.status === 'done' ? currentTask.completed_at || new Date().toISOString() : null

      if (body.started_at === undefined) {
        if (resolved.progress_state === 'in_progress' && !currentTask.started_at) {
          updatePayload.started_at = new Date().toISOString()
        }
        if (resolved.progress_state === 'todo') updatePayload.started_at = null
      }
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
      (body.title !== undefined || body.note !== undefined || body.due_date !== undefined || touchesProgress)
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
      { error: errorMessage(error, 'Impossibile aggiornare l’attività') },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) {
      return Response.json({ error: 'ID task mancante' }, { status: 400 })
    }

    // `is('contact_id', null)` è la garanzia che da qui non si possano
    // cancellare i task legati a un contatto (follow-up, chiamate).
    const { data: currentTask, error: currentError } = await auth.supabase
      .from('tasks')
      .select('id, calendar_event_id')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)
      .maybeSingle()

    if (currentError) throw currentError
    if (!currentTask) {
      return Response.json({ error: 'Attività non trovata' }, { status: 404 })
    }

    if (currentTask.calendar_event_id) {
      try {
        await removeTaskCalendarEvent(auth.supabase, auth.workspaceUserId, currentTask.calendar_event_id)
      } catch {
        // Un evento già cancellato a mano su Calendar non deve bloccare l'eliminazione.
      }
    }

    const { error } = await auth.supabase
      .from('tasks')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)

    if (error) throw error

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Impossibile eliminare l’attività') },
      { status: 500 }
    )
  }
}
