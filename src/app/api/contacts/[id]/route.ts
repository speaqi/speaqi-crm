import { NextRequest } from 'next/server'
import { ensureNextAction } from '@/lib/server/crm'
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

    const [{ data: activities, error: activitiesError }, { data: tasks, error: tasksError }] =
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
      ])

    if (activitiesError) throw activitiesError
    if (tasksError) throw tasksError

    return Response.json({
      contact,
      activities: activities || [],
      tasks: tasks || [],
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
    const nextFollowupAt =
      body.next_followup_at === ''
        ? null
        : body.next_followup_at
          ? String(body.next_followup_at)
          : current.next_followup_at

    await ensureNextAction(auth.supabase, auth.user.id, id, nextStatus, nextFollowupAt)

    const { data, error } = await auth.supabase
      .from('contacts')
      .update({
        name: body.name ? String(body.name).trim() : current.name,
        email: body.email !== undefined ? normalizeText(body.email) : current.email,
        phone: body.phone !== undefined ? normalizeText(body.phone) : current.phone,
        status: nextStatus,
        source: body.source !== undefined ? normalizeText(body.source) : current.source,
        priority:
          body.priority !== undefined
            ? Math.max(0, Math.min(3, Number(body.priority || 0)))
            : current.priority,
        responsible:
          body.responsible !== undefined ? normalizeText(body.responsible) : current.responsible,
        value: body.value !== undefined ? normalizeNumber(body.value) : current.value,
        note: body.note !== undefined ? normalizeText(body.note) : current.note,
        next_followup_at: nextFollowupAt,
      })
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('*')
      .single()

    if (error) throw error

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
