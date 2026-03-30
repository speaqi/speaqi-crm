import { NextRequest } from 'next/server'
import { createLeadTask, logLeadActivity, normalizeTaskRecord } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const leadId = String(body.lead_id || '').trim()
    const dueAt = String(body.due_at || '').trim()

    if (!leadId || !dueAt) {
      return Response.json({ error: 'lead_id e due_at sono obbligatori' }, { status: 400 })
    }

    const task = await createLeadTask(auth.supabase, auth.user.id, {
      leadId,
      action: body.action,
      type: body.type,
      dueAt,
      priority: body.priority,
      note: body.note,
      idempotencyKey: body.idempotency_key,
      status: body.status,
    })

    await logLeadActivity(auth.supabase, auth.user.id, {
      leadId,
      type: 'note',
      content: `Task creata via API: ${normalizeTaskRecord(task).action} entro ${normalizeTaskRecord(task).due_at}.`,
      metadata: {
        event: 'task_created',
        task_id: task.id,
      },
    })

    return Response.json({ task: normalizeTaskRecord(task) }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to create task') }, { status: 500 })
  }
}
