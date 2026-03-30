import { NextRequest } from 'next/server'
import { normalizeLeadRecord, normalizeTaskAction, normalizeTaskPriority, normalizeTaskRecord, priorityLevelFromNumber } from '@/lib/server/ai-ready'
import { errorMessage, parseLimit } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

function asTimestamp(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 50, 200)
    const { data: contacts, error: contactsError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('next_action_at', { ascending: true, nullsFirst: false })
      .limit(limit * 3)

    if (contactsError) throw contactsError

    const leadIds = (contacts || []).map((contact: any) => contact.id)
    const taskRows =
      leadIds.length > 0
        ? await auth.supabase
            .from('tasks')
            .select('*')
            .eq('user_id', auth.user.id)
            .eq('status', 'pending')
            .in('contact_id', leadIds)
            .order('due_date', { ascending: true, nullsFirst: false })
        : { data: [], error: null }

    if (taskRows.error) throw taskRows.error

    const tasksByLead = new Map<string, any[]>()
    for (const task of taskRows.data || []) {
      const current = tasksByLead.get(String(task.contact_id)) || []
      current.push(task)
      tasksByLead.set(String(task.contact_id), current)
    }

    const leads = (contacts || [])
      .map((row: any) => {
        const lead = normalizeLeadRecord(row)
        const tasks = (tasksByLead.get(row.id) || []).map(normalizeTaskRecord)
        const firstTask = tasks[0] || null
        const dueAt = firstTask?.due_at || lead.next_action_at || null

        return {
          lead,
          task: firstTask,
          due_at: dueAt,
          action: firstTask?.action || normalizeTaskAction(null, row.phone ? 'call' : row.email ? 'email' : 'follow-up'),
          priority: firstTask?.priority || priorityLevelFromNumber(row.priority),
        }
      })
      .filter((item) => item.lead.status !== 'closed' && item.lead.status !== 'not_interested')
      .sort((left, right) => {
        return (
          asTimestamp(left.due_at) - asTimestamp(right.due_at) ||
          (left.priority === 'high' ? -1 : left.priority === 'medium' ? 0 : 1) -
            (right.priority === 'high' ? -1 : right.priority === 'medium' ? 0 : 1) ||
          left.lead.name.localeCompare(right.lead.name)
        )
      })
      .slice(0, limit)

    return Response.json({ leads })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load next actions') }, { status: 500 })
  }
}
