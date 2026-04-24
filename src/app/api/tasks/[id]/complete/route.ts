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
    if (!auth.isAdmin) {
      const { data: currentTask } = await auth.supabase
        .from('tasks')
        .select('contact_id')
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .single()

      if (!currentTask) {
        return Response.json({ error: 'Task non trovato' }, { status: 404 })
      }

      let allowedQuery = auth.supabase
        .from('contacts')
        .select('id')
        .eq('user_id', auth.workspaceUserId)
        .eq('id', currentTask.contact_id)
      allowedQuery = auth.memberName
        ? allowedQuery.ilike('responsible', auth.memberName)
        : allowedQuery.eq('responsible', '__no_member__')
      const { data: allowedContact } = await allowedQuery.single()

      if (!allowedContact) {
        return Response.json({ error: 'Task non accessibile' }, { status: 403 })
      }
    }

    const task = await completeLeadTask(auth.supabase, auth.workspaceUserId, id)

    await logLeadActivity(auth.supabase, auth.workspaceUserId, {
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
