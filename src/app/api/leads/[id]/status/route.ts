import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { updateLeadFromInput } from '@/lib/server/lead-ops'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const { id } = await context.params

    if (!body.status) {
      return Response.json({ error: 'status obbligatorio' }, { status: 400 })
    }

    const lead = await updateLeadFromInput(auth.supabase, auth.user.id, id, {
      status: body.status,
      next_action_at: body.next_action_at,
      next_followup_at: body.next_followup_at,
      action: body.action,
      task_priority: body.task_priority,
      task_note: body.task_note,
      idempotency_key: body.idempotency_key,
    })

    return Response.json({ lead })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to update lead status') }, { status: 500 })
  }
}
