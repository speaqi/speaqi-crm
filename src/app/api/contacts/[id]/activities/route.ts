import { NextRequest } from 'next/server'
import { updateContactAfterActivity, ensureNextAction } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const { data, error } = await auth.supabase
      .from('activities')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('contact_id', id)
      .order('created_at', { ascending: false })

    if (error) throw error

    return Response.json({ activities: data || [] })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load activities' },
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
    const type = String(body.type || 'note')
    const content = String(body.content || '').trim()
    const nextFollowupAt = body.next_followup_at ? String(body.next_followup_at) : null
    const taskType = String(body.task_type || 'follow-up')

    if (!content) {
      return Response.json({ error: 'Il contenuto attività è obbligatorio' }, { status: 400 })
    }

    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .single()

    if (contactError) throw contactError

    await ensureNextAction(auth.supabase, auth.user.id, id, contact.status, nextFollowupAt || contact.next_followup_at)

    const { data: activity, error } = await auth.supabase
      .from('activities')
      .insert({
        user_id: auth.user.id,
        contact_id: id,
        type,
        content,
      })
      .select('*')
      .single()

    if (error) throw error

    await updateContactAfterActivity(auth.supabase, id, content, nextFollowupAt)

    let task = null
    if (nextFollowupAt) {
      const { data: createdTask, error: taskError } = await auth.supabase
        .from('tasks')
        .insert({
          user_id: auth.user.id,
          contact_id: id,
          type: taskType,
          due_date: nextFollowupAt,
          status: 'pending',
          note: body.task_note ? String(body.task_note) : `Follow-up dopo attività ${type}`,
        })
        .select('*')
        .single()

      if (taskError) throw taskError
      task = createdTask
    }

    return Response.json({ activity, task }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create activity' },
      { status: 500 }
    )
  }
}
