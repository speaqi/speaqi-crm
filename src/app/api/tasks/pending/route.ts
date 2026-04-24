import { NextRequest } from 'next/server'
import { normalizeTaskRecord } from '@/lib/server/ai-ready'
import { errorMessage, parseLimit } from '@/lib/server/http'
import {
  TASKS_CONTACT_FOREIGN_TABLE,
  contactAssigneeMatchOrFilter,
  workspaceContactsAllFromRequest,
} from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const leadId = request.nextUrl.searchParams.get('lead_id')
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 100, 500)

    let query = auth.supabase
      .from('tasks')
      .select('*, contact:contacts!inner(responsible,assigned_agent)')
      .eq('user_id', auth.workspaceUserId)
      .eq('status', 'pending')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit)

    const workspaceAll = workspaceContactsAllFromRequest(request, auth.isAdmin)
    if (auth.memberName && !workspaceAll) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      if (assigneeOr) {
        query = query.or(assigneeOr, { foreignTable: TASKS_CONTACT_FOREIGN_TABLE })
      }
    }

    if (leadId) {
      query = query.eq('contact_id', leadId)
    }

    const { data, error } = await query
    if (error) throw error

    return Response.json({ tasks: (data || []).map(normalizeTaskRecord) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load pending tasks') }, { status: 500 })
  }
}
