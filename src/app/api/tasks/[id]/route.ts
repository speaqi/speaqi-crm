import { NextRequest } from 'next/server'
import { syncLeadActionDates } from '@/lib/server/ai-ready'
import { isCallTaskType } from '@/lib/schedule'
import {
  createActivities,
  formatActivityDate,
  syncContactNextFollowupFromPendingTasks,
  updateContactSummary,
} from '@/lib/server/crm'
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

    const { data: currentTask, error: currentTaskError } = await auth.supabase
      .from('tasks')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .single()

    if (currentTaskError) throw currentTaskError

    const updatePayload: Record<string, unknown> = {}

    if (body.note !== undefined) updatePayload.note = String(body.note || '')
    if (body.due_date !== undefined) updatePayload.due_date = body.due_date || null
    if (body.priority !== undefined) updatePayload.priority = body.priority || 'medium'
    if (body.action !== undefined) updatePayload.action = body.action || null
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

    let syncedNextFollowupAt: string | null | undefined
    if (
      (currentTask.due_date || null) !== (data.due_date || null) ||
      currentTask.status !== data.status ||
      (currentTask.action || null) !== (data.action || null)
    ) {
      const syncedDates = await syncLeadActionDates(auth.supabase, auth.user.id, data.contact_id)
      syncedNextFollowupAt = syncedDates.nextFollowupAt
    }

    const changes: string[] = []
    if (currentTask.status !== data.status) {
      if (data.status === 'done') changes.push('completato')
      else changes.push(`stato ${currentTask.status} -> ${data.status}`)
    }
    if ((currentTask.due_date || null) !== (data.due_date || null)) {
      changes.push(`scadenza ${formatActivityDate(currentTask.due_date)} -> ${formatActivityDate(data.due_date)}`)
    }
    if ((currentTask.note || null) !== (data.note || null)) {
      changes.push(data.note ? 'nota aggiornata' : 'nota rimossa')
    }
    if ((currentTask.priority || null) !== (data.priority || null)) {
      changes.push(`priorità ${currentTask.priority || 'vuota'} -> ${data.priority || 'vuota'}`)
    }
    if ((currentTask.action || null) !== (data.action || null)) {
      changes.push(`azione ${(currentTask.action || 'vuota')} -> ${(data.action || 'vuota')}`)
    }

    if (changes.length) {
      const activityContent =
        changes.length === 1 && changes[0] === 'completato'
          ? `Task ${data.type} completato.`
          : `Task ${data.type} aggiornato: ${changes.join('; ')}.`

      await createActivities(auth.supabase, [
        {
          user_id: auth.user.id,
          contact_id: data.contact_id,
          type: 'task',
          content: activityContent,
        },
      ])
      await updateContactSummary(auth.supabase, data.contact_id, activityContent, {
        nextFollowupAt: isCallTaskType(data.type) ? syncedNextFollowupAt : undefined,
      })
    }

    return Response.json({ task: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update task' },
      { status: 500 }
    )
  }
}
