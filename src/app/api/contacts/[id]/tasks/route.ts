import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
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
    const { data, error } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.user.id)
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

    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .single()

    if (contactError) throw contactError

    if (isClosedStatus(contact.status)) {
      return Response.json({ error: 'Non puoi aggiungere task a un contatto chiuso' }, { status: 400 })
    }

    const { data: task, error } = await auth.supabase
      .from('tasks')
      .insert({
        user_id: auth.user.id,
        contact_id: id,
        type,
        due_date: dueDate,
        status: 'pending',
        note: body.note ? String(body.note) : null,
      })
      .select('*')
      .single()

    if (error) throw error

    const { error: updateError } = await auth.supabase
      .from('contacts')
      .update({
        next_followup_at: dueDate,
      })
      .eq('user_id', auth.user.id)
      .eq('id', id)

    if (updateError) throw updateError

    const activityContent = [
      `Creato task ${task.type}.`,
      `Scadenza: ${formatActivityDate(task.due_date)}.`,
      task.note ? `Nota: ${task.note}.` : null,
    ]
      .filter(Boolean)
      .join(' ')

    await createActivities(auth.supabase, [
      {
        user_id: auth.user.id,
        contact_id: id,
        type: 'task',
        content: activityContent,
      },
    ])
    await updateContactSummary(auth.supabase, id, activityContent, {
      nextFollowupAt: dueDate,
    })

    return Response.json({ task }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    )
  }
}
