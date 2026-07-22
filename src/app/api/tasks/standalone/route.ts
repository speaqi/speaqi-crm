import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

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
      .select('due_date, reschedule_count')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)
      .single()

    if (currentError) throw currentError
    if (body.due_date !== undefined && (currentTask.due_date || null) !== (body.due_date || null)) {
      updatePayload.rescheduled_at = new Date().toISOString()
      updatePayload.reschedule_count = Number(currentTask.reschedule_count || 0) + 1
    }

    const { data, error } = await auth.supabase
      .from('tasks')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .is('contact_id', null)
      .select('*')
      .single()

    if (error) throw error

    return Response.json({ task: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update standalone task' },
      { status: 500 }
    )
  }
}
