import { NextRequest } from 'next/server'
import { applyPipelineScope } from '@/lib/server/scope-filters'
import { createServiceRoleClient } from '@/lib/server/supabase'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const staleDays = Math.max(1, Number(body.stale_days || 5))
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString()
    const requestedCategory = body.category ? String(body.category).trim() : ''
    const requestedSource = body.source ? String(body.source).trim() : ''
    const supabase = createServiceRoleClient()

    let query = applyPipelineScope(
      supabase.from('contacts').select('*')
    )
      .neq('status', 'Closed')
      .neq('status', 'Paid')
      .neq('status', 'Lost')
      .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
      .order('updated_at', { ascending: true })

    if (requestedCategory) {
      query = query.eq('category', requestedCategory)
    }

    if (requestedSource) {
      query = query.eq('source', requestedSource)
    }

    const { data, error } = await query

    if (error) throw error

    const summaryByCategory = Object.entries(
      (data || []).reduce<Record<string, number>>((accumulator, contact: any) => {
        const key = contact.category || 'uncategorized'
        accumulator[key] = (accumulator[key] || 0) + 1
        return accumulator
      }, {})
    ).map(([category, count]) => ({ category, count }))

    // Create tasks for stale leads that don't already have a pending task
    const staleContacts = data || []
    let tasksCreated = 0

    if (staleContacts.length && !body.dry_run) {
      const contactIds = staleContacts.map((c: any) => c.id)

      // Get existing pending tasks to avoid duplicates
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('contact_id')
        .eq('status', 'pending')
        .in('contact_id', contactIds)

      const contactsWithTasks = new Set((existingTasks || []).map((t: any) => t.contact_id))

      const taskPayload = staleContacts
        .filter((c: any) => !contactsWithTasks.has(c.id))
        .map((c: any) => {
          const daysStale = Math.max(
            1,
            Math.floor((Date.now() - new Date(c.last_contact_at || c.created_at).getTime()) / (24 * 60 * 60 * 1000))
          )
          return {
            user_id: c.user_id,
            contact_id: c.id,
            type: 'call',
            action: 'call',
            due_date: new Date().toISOString(),
            priority: (c.score || 0) >= 70 ? 'high' : 'medium',
            status: 'pending',
            note: `Riattiva ${c.name} — fermo da ${daysStale} giorni [automazione stale-leads]`,
            idempotency_key: `stale-lead:${c.id}:${new Date().toISOString().slice(0, 10)}`,
          }
        })

      if (taskPayload.length) {
        const { error: insertError } = await supabase
          .from('tasks')
          .insert(taskPayload)

        if (!insertError) {
          tasksCreated = taskPayload.length
        }
      }
    }

    return Response.json({
      stale_days: staleDays,
      category: requestedCategory || null,
      source: requestedSource || null,
      summary_by_category: summaryByCategory,
      stale_count: staleContacts.length,
      tasks_created: tasksCreated,
      stale_leads: data || [],
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to detect stale leads' },
      { status: 500 }
    )
  }
}
