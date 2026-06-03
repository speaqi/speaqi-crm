import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .is('contact_id', null)
      .eq('status', 'pending')
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
        due_date: body.due_date || new Date().toISOString(),
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
