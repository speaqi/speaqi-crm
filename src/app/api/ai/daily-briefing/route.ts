/**
 * GET /api/ai/daily-briefing
 *
 * Genera un riepilogo testuale delle priorità di oggi usando AI.
 * Mostrato nella dashboard hero sotto le stats.
 */

import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { applyPipelineScope } from '@/lib/server/scope-filters'
import { buildScheduledCalls, dueAtLocalDateKey, localDayDateKey } from '@/lib/schedule'
import { isClosedStatus } from '@/lib/data'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const today = new Date()
    const todayKey = localDayDateKey(today)

    // Fetch contacts + tasks in parallel
    const [contactsResult, tasksResult] = await Promise.all([
      applyPipelineScope(
        auth.supabase
          .from('contacts')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
      ).limit(2000),
      auth.supabase
        .from('tasks')
        .select('*, contact:contacts(*)')
        .eq('user_id', auth.workspaceUserId)
        .eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(2000),
    ])

    if (contactsResult.error) throw contactsResult.error
    if (tasksResult.error) throw tasksResult.error

    const contacts = contactsResult.data || []
    const tasks = tasksResult.data || []

    const scheduled = buildScheduledCalls(contacts, tasks)

    // Overdue
    const overdue = scheduled.filter((call) => {
      const key = dueAtLocalDateKey(call.due_at)
      return key && key < todayKey
    })

    // Today
    const todayCalls = scheduled.filter((call) => {
      const key = dueAtLocalDateKey(call.due_at)
      return key === todayKey
    })

    // Hot leads
    const hotLeads = contacts
      .filter((c: any) => (c.score || 0) >= 70 && !isClosedStatus(c.status))
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
      .slice(0, 3)

    // Stale
    const staleCount = contacts.filter((c: any) => {
      if (isClosedStatus(c.status)) return false
      const ref = c.last_contact_at || c.created_at
      if (!ref) return true
      return Date.now() - new Date(ref).getTime() > 14 * 24 * 60 * 60 * 1000
    }).length

    // Build briefing text
    const parts: string[] = []

    if (overdue.length > 0) {
      parts.push(`${overdue.length} chiamate in ritardo da recuperare`)
    }
    if (todayCalls.length > 0) {
      parts.push(`${todayCalls.length} chiamate pianificate per oggi`)
    }
    if (hotLeads.length > 0) {
      const names = hotLeads.map((l: any) => l.name).join(', ')
      parts.push(`lead caldi: ${names}`)
    }
    if (staleCount > 0) {
      parts.push(`${staleCount} contatti fermi da oltre 2 settimane`)
    }
    if (parts.length === 0) {
      parts.push('Nessuna azione urgente. Pipeline pulita.')
    }

    return Response.json({
      briefing: parts.join('. ') + '.',
      overdue: overdue.length,
      today: todayCalls.length,
      hot_leads: hotLeads.length,
      stale: staleCount,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to generate briefing' },
      { status: 500 }
    )
  }
}
