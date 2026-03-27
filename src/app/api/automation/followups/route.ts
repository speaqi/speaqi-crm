import { NextRequest } from 'next/server'
import { sendReminderEmail } from '@/lib/email'
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
    const supabase = createServiceRoleClient()

    const { data: dueContacts, error } = await supabase
      .from('contacts')
      .select('*')
      .neq('status', 'Closed')
      .neq('status', 'Lost')
      .not('next_followup_at', 'is', null)
      .lte('next_followup_at', new Date().toISOString())
      .order('next_followup_at', { ascending: true })

    if (error) throw error

    const contacts = dueContacts || []
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
      .filter((contact: any) => !existingTaskKeys.has(`${contact.id}:${contact.next_followup_at}`))
      .map((contact: any) => ({
        user_id: contact.user_id,
        contact_id: contact.id,
        type: 'follow-up',
        due_date: contact.next_followup_at,
        status: 'pending',
        note: `Follow-up automatico per ${contact.name}`,
      }))

    let createdTasks = 0
    if (taskPayload.length) {
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
          time: contact.next_followup_at
            ? new Date(contact.next_followup_at).toLocaleString('it-IT')
            : '',
        }))
      )
    }

    return Response.json({
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
