import { NextRequest } from 'next/server'
import {
  buildLeadContext,
  normalizeTaskRecord,
  readLeadMemory,
  readLeadRecord,
  readLeadTasks,
  readLeadActivities,
  normalizeLeadRecord,
} from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const [leadRow, activities, tasks, memory] = await Promise.all([
      readLeadRecord(auth.supabase, auth.user.id, id),
      readLeadActivities(auth.supabase, auth.user.id, id),
      readLeadTasks(auth.supabase, auth.user.id, id),
      readLeadMemory(auth.supabase, auth.user.id, id),
    ])

    return Response.json({
      lead: normalizeLeadRecord(leadRow),
      activities,
      tasks: tasks.map(normalizeTaskRecord),
      memory,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load lead') }, { status: 500 })
  }
}
