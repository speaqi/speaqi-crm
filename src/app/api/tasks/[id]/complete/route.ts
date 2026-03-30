import { NextRequest } from 'next/server'
import { completeLeadTask, logLeadActivity, normalizeTaskRecord } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const task = await completeLeadTask(auth.supabase, auth.user.id, id)

    await logLeadActivity(auth.supabase, auth.user.id, {
      leadId: String(task.contact_id),
      type: 'note',
      content: `Task completata via API: ${normalizeTaskRecord(task).action}.`,
      metadata: {
        event: 'task_completed',
        task_id: task.id,
      },
    })

    return Response.json({ task: normalizeTaskRecord(task) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to complete task') }, { status: 500 })
  }
}
