import { NextRequest } from 'next/server'
import { sendReminderEmail } from '@/lib/email'
import { normalizeTaskAction, priorityLevelFromNumber, taskTypeForAction } from '@/lib/server/ai-ready'
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
    const recipientEmail = body.email || process.env.REMINDER_EMAIL
    const requestedCategory = body.category ? String(body.category).trim() : ''
    const requestedSource = body.source ? String(body.source).trim() : ''
    const dryRun = body.dry_run === true
    const supabase = createServiceRoleClient()

    let contactsQuery = supabase
      .from('contacts')
      .select('*')
      .eq('contact_scope', 'crm')
      .neq('status', 'Closed')
      .neq('status', 'Paid')
      .neq('status', 'Lost')
      .order('next_action_at', { ascending: true, nullsFirst: false })
      .order('next_followup_at', { ascending: true, nullsFirst: false })

    if (requestedCategory) {
      contactsQuery = contactsQuery.eq('category', requestedCategory)
    }

    if (requestedSource) {
      contactsQuery = contactsQuery.eq('source', requestedSource)
    }

    const { data: dueContacts, error } = await contactsQuery

    if (error) throw error

    const now = Date.now()
    const contacts = (dueContacts || []).filter((contact: any) => {
      const dueAt = contact.next_action_at || contact.next_followup_at
      if (!dueAt) return false
      return new Date(dueAt).getTime() <= now
    })
    const contactIds = contacts.map((contact: any) => contact.id)
    let existingTaskKeys = new Set<string>()

    if (contactIds.length) {
      const { data: existingTasks, error: existingTasksError } = await supabase
        .from('tasks')
        .select('contact_id, due_date')
        .eq('status', 'pending')
        .in('contact_id', contactIds)

      if (existingTasksError) throw existingTasksError
      existingTaskKeys = new Set(
        (existingTasks || []).map((task: any) => `${task.contact_id}:${task.due_date}`)
      )
    }

    const taskPayload = contacts
      .map((contact: any) => {
        const dueAt = contact.next_action_at || contact.next_followup_at
        const action = normalizeTaskAction(
          contact.next_followup_at && dueAt === contact.next_followup_at
            ? 'call'
            : (contact.phone ? 'call' : contact.email ? 'send_email' : 'wait')
        )

        return {
          user_id: contact.user_id,
          contact_id: contact.id,
          type: taskTypeForAction(action),
          action,
          due_date: dueAt,
          priority: priorityLevelFromNumber(contact.priority),
          status: 'pending',
          note: `Follow-up automatico${contact.category ? ` [${contact.category}]` : ''} per ${contact.name}`,
          idempotency_key: `auto-followup:${contact.id}:${dueAt}:${action}`,
        }
      })
      .filter((task) => task.due_date && !existingTaskKeys.has(`${task.contact_id}:${task.due_date}`))

    let createdTasks = 0
    if (taskPayload.length && !dryRun) {
      const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .insert(taskPayload)
        .select('id')

      if (taskError) throw taskError
      createdTasks = tasks?.length || 0
    }

    if (recipientEmail && contacts.length) {
      await sendReminderEmail(
        recipientEmail,
        contacts.map((contact: any) => ({
          name: contact.name,
          time: contact.next_action_at || contact.next_followup_at
            ? new Date(contact.next_action_at || contact.next_followup_at).toLocaleString('it-IT')
            : '',
        }))
      )
    }

    return Response.json({
      category: requestedCategory || null,
      source: requestedSource || null,
      dry_run: dryRun,
      contacts_due: contacts.length,
      created_tasks: createdTasks,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to run follow-up automation' },
      { status: 500 }
    )
  }
}
