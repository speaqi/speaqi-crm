import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const supabase = createServiceRoleClient()

    const maintenance: Record<string, number | Array<{ id: string; name: string; email: string | null; status: string }>> = {}

    // ─── 1. Sync next_followup_at with pending tasks ───
    const { data: staleFollowups } = await supabase
      .from('contacts')
      .select('id, user_id, next_followup_at')
      .not('next_followup_at', 'is', null)
      .in('contact_scope', ['crm', 'holding', 'partner'])

    if (staleFollowups?.length) {
      const contactIds = staleFollowups.map((c: any) => c.id)

      const { data: pendingTasks } = await supabase
        .from('tasks')
        .select('contact_id, due_date')
        .eq('status', 'pending')
        .in('contact_id', contactIds)
        .order('due_date', { ascending: true })

      // Build map of contact → earliest task due date
      const taskMap = new Map<string, string>()
      for (const task of pendingTasks || []) {
        if (task.due_date && !taskMap.has(task.contact_id)) {
          taskMap.set(task.contact_id, task.due_date)
        }
      }

      // Find contacts where next_followup_at doesn't match the earliest pending task
      let fixedFollowups = 0
      for (const contact of staleFollowups) {
        const taskDue = taskMap.get(contact.id)
        if (taskDue) {
          const contactDue = contact.next_followup_at
          // If they differ by more than 1 hour, sync to earliest task
          const diff = Math.abs(new Date(taskDue).getTime() - new Date(contactDue).getTime())
          if (diff > 60 * 60 * 1000) {
            if (!dryRun) {
              await supabase
                .from('contacts')
                .update({ next_followup_at: taskDue, updated_at: new Date().toISOString() })
                .eq('id', contact.id)
            }
            fixedFollowups++
          }
        }
      }
      maintenance.next_followup_at_synced = fixedFollowups
    }

    // ─── 2. Clean up dangling next_action_at for contacts with no pending tasks ───
    const { data: contactsWithAction } = await supabase
      .from('contacts')
      .select('id')
      .not('next_action_at', 'is', null)
      .in('contact_scope', ['crm', 'holding', 'partner'])

    if (contactsWithAction?.length) {
      const ids = contactsWithAction.map((c: any) => c.id)
      const { data: tasksForAction } = await supabase
        .from('tasks')
        .select('contact_id')
        .eq('status', 'pending')
        .in('contact_id', ids)

      const hasTask = new Set((tasksForAction || []).map((t: any) => t.contact_id))
      const orphans = contactsWithAction.filter((c: any) => !hasTask.has(c.id))

      if (orphans.length) {
        if (!dryRun) {
          const orphanIds = orphans.map((c: any) => c.id)
          await supabase
            .from('contacts')
            .update({ next_action_at: null, updated_at: new Date().toISOString() })
            .in('id', orphanIds)
        }
        maintenance.cleared_next_action_at = orphans.length
      }
    }

    // ─── 3. Clean old dismissed email drafts (older than 30 days) ───
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: oldDrafts } = await supabase
      .from('email_drafts')
      .select('id')
      .eq('status', 'dismissed')
      .lt('created_at', thirtyDaysAgo)

    if (oldDrafts?.length) {
      if (!dryRun) {
        const draftIds = oldDrafts.map((d: any) => d.id)
        await supabase.from('email_drafts').delete().in('id', draftIds)
      }
      maintenance.cleaned_drafts = oldDrafts.length
    }

    // ─── 4. Detect orphan contacts (open, with email, no tasks, no follow-up, no recent activity) ───
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: allActive } = await supabase
      .from('contacts')
      .select('id, name, email, status, next_followup_at, next_action_at')
      .in('contact_scope', ['crm', 'holding', 'partner'])
      .not('status', 'in', '("Closed","Paid","Lost")')
      .not('email', 'is', null)
      .lt('updated_at', sevenDaysAgo)

    if (allActive?.length) {
      const activeIds = allActive.map((c: any) => c.id)
      const { data: activeTasks } = await supabase
        .from('tasks')
        .select('contact_id')
        .eq('status', 'pending')
        .in('contact_id', activeIds)

      const withTask = new Set((activeTasks || []).map((t: any) => t.contact_id))
      const orphansList = allActive
        .filter((c: any) => !c.next_followup_at && !c.next_action_at && !withTask.has(c.id))
        .slice(0, 20)

      maintenance.orphan_contacts = orphansList.length
      maintenance.orphan_preview = orphansList.map((c: any) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        status: c.status,
      }))
    }

    const dryRunLabel = dryRun ? ' [DRY RUN]' : ''

    return Response.json({
      dry_run: dryRun,
      message: `Manutenzione completata${dryRunLabel}`,
      maintenance,
    })
  } catch (error) {
    console.error('db-maintenance failed', error)
    return Response.json({ error: errorMessage(error, 'DB maintenance failed') }, { status: 500 })
  }
}
