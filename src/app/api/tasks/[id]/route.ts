import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const nextStatus = body.status ? String(body.status) : undefined

    const updatePayload: Record<string, unknown> = {}

    if (body.note !== undefined) updatePayload.note = String(body.note || '')
    if (body.due_date !== undefined) updatePayload.due_date = body.due_date || null
    if (nextStatus) {
      updatePayload.status = nextStatus
      updatePayload.completed_at = nextStatus === 'done' ? new Date().toISOString() : null
    }

    const { data, error } = await auth.supabase
      .from('tasks')
      .update(updatePayload)
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

    return Response.json({ task: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    )
  }
}
