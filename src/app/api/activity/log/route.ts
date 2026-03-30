import { NextRequest } from 'next/server'
import {
  applyReplyOutcome,
  createLeadTask,
  dueAtFromDelay,
  logLeadActivity,
  normalizeActivityType,
  normalizeLeadRecord,
  normalizeTaskRecord,
  readLeadRecord,
} from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const leadId = String(body.lead_id || '').trim()
    const content = String(body.content || '').trim()
    const rawType = String(body.type || '').trim()

    if (!leadId || !rawType || !content) {
      return Response.json(
        { error: 'lead_id, type e content sono obbligatori' },
        { status: 400 }
      )
    }

    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    const type = normalizeActivityType(rawType, metadata)
    const activity = await logLeadActivity(auth.supabase, auth.user.id, {
      leadId,
      type,
      content,
      metadata,
    })

    let task: any = null
    let classification: unknown = null
    let memory: unknown = null
    let nextAction: unknown = null
    let score: number | null = null

    if (type === 'email_sent') {
      task = await createLeadTask(auth.supabase, auth.user.id, {
        leadId,
        action: 'wait',
        dueAt: dueAtFromDelay('wait', 24),
        priority: 'medium',
        note: 'Verificare risposta dopo email inviata',
        idempotencyKey: `activity:email_sent:${leadId}:${String((metadata as { email_id?: unknown }).email_id || activity.id)}`,
      })
    }

    if (type === 'email_reply') {
      const outcome = await applyReplyOutcome(auth.supabase, auth.user.id, leadId, content)
      classification = outcome.classification
      memory = outcome.memory
      nextAction = outcome.next_action
      score = outcome.score
      task = outcome.task
    }

    const lead = normalizeLeadRecord(await readLeadRecord(auth.supabase, auth.user.id, leadId))

    return Response.json({
      activity,
      lead,
      task: task ? normalizeTaskRecord(task) : null,
      classification,
      memory,
      next_action: nextAction,
      score,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to log activity') }, { status: 500 })
  }
}
