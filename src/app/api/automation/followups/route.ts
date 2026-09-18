import { NextRequest } from 'next/server'
import { sendReminderEmail } from '@/lib/email'
import { normalizeTaskAction, priorityLevelFromNumber, taskTypeForAction } from '@/lib/server/ai-ready'
import { applyPipelineScope } from '@/lib/server/scope-filters'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { statusSlaHours } from '@/lib/sla'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { backfillWineProjectFollowups, queueDueWineProjectFollowups } from '@/lib/server/wine-project-automation'
import { errorMessage, selectByIdChunks } from '@/lib/server/http'

function asDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString()
}

function dayKey(value = new Date()) {
  return value.toISOString().slice(0, 10)
}

function taskKey(task: { contact_id: string; due_date?: string | null; idempotency_key?: string | null }) {
  return `${task.contact_id}:${task.due_date || ''}:${task.idempotency_key || ''}`
}

/** Vedi `selectByIdChunks` in `@/lib/server/http` per il perché. */
const ID_CHUNK = 200

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const recipientEmail = body.email || process.env.REMINDER_EMAIL
    const requestedCategory = body.category ? String(body.category).trim() : ''
    const requestedSource = body.source ? String(body.source).trim() : ''
    const dryRun = body.dry_run === true
    const slaMode = body.sla_mode !== false
    const quoteRecovery = body.quote_recovery !== false
    const supabase = createServiceRoleClient()
    const wineProjectBackfill = await backfillWineProjectFollowups(supabase)
    const wineProject = await queueDueWineProjectFollowups(supabase)

    let contactsQuery = applyPipelineScope(
      supabase.from('contacts').select('*')
    )
      .neq('status', 'Closed')
      .neq('status', 'Paid')
      .neq('status', 'Lost')
      .neq('event_tag', 'wine-project')
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
    const allOpenContacts = dueContacts || []
    const contactIds = allOpenContacts.map((contact: any) => contact.id)
    let existingTaskKeys = new Set<string>()
    let existingIdempotencyKeys = new Set<string>()

    if (contactIds.length) {
      const pendingTasks = await selectByIdChunks<any>(contactIds, ID_CHUNK, (group) =>
        supabase
          .from('tasks')
          .select('contact_id, due_date')
          .eq('status', 'pending')
          .in('contact_id', group)
      )
      existingTaskKeys = new Set(
        pendingTasks.map((task: any) => `${task.contact_id}:${task.due_date}`)
      )

      // `tasks_user_idempotency_key_idx` e' unico per (user_id, idempotency_key)
      // a prescindere dallo stato: un task completato mesi fa blocca comunque
      // un inserimento con la stessa chiave. Filtrare solo sui `pending` (come
      // faceva `existingTaskKeys`) lasciava passare il duplicato fino
      // all'insert, che falliva con 23505 — mascherato per settimane dal
      // `.in()` troppo lungo che faceva fallire la rotta prima di arrivarci.
      const allTasksWithKey = await selectByIdChunks<any>(contactIds, ID_CHUNK, (group) =>
        supabase
          .from('tasks')
          .select('idempotency_key')
          .not('idempotency_key', 'is', null)
          .in('contact_id', group)
      )
      existingIdempotencyKeys = new Set(
        allTasksWithKey
          .map((task: any) => String(task.idempotency_key || '').trim())
          .filter(Boolean)
      )
    }

    const dueTaskPayload = contacts
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
      .filter((task) =>
        task.due_date &&
        !existingTaskKeys.has(`${task.contact_id}:${task.due_date}`) &&
        !existingIdempotencyKeys.has(task.idempotency_key)
      )

    const slaTaskPayload = slaMode
      ? allOpenContacts
          .map((contact: any) => {
            const reference = asDate(contact.last_contact_at || contact.updated_at || contact.created_at)
            if (!reference) return null

            const slaHours = statusSlaHours(contact.status)
            const staleAt = reference.getTime() + slaHours * 60 * 60 * 1000
            const hasExistingDue = contact.next_action_at || contact.next_followup_at
            if (staleAt > now || (hasExistingDue && new Date(hasExistingDue).getTime() <= staleAt)) return null

            const key = `sla-followup:${contact.id}:${String(contact.status || 'open').toLowerCase()}:${dayKey()}`
            if (existingIdempotencyKeys.has(key)) return null

            return {
              user_id: contact.user_id,
              contact_id: contact.id,
              type: 'call',
              action: 'call',
              due_date: new Date().toISOString(),
              priority: contact.score >= 70 || contact.priority >= 3 ? 'high' : 'medium',
              status: 'pending',
              note: `SLA follow-up: ${contact.name} fermo oltre ${slaHours}h nello stage ${contact.status || 'aperto'}`,
              idempotency_key: key,
            }
          })
          .filter(Boolean)
      : []

    let quoteTaskPayload: any[] = []

    if (quoteRecovery && contactIds.length) {
      const quotes = await selectByIdChunks<any>(contactIds, ID_CHUNK, (group) =>
        supabase
          .from('quotes')
          .select('id, user_id, contact_id, quote_number, status, total_amount, sent_at, created_at')
          .eq('status', 'sent')
          .in('contact_id', group)
      )

      quoteTaskPayload = quotes
        .flatMap((quote: any) => {
          const sentAt = quote.sent_at || quote.created_at
          if (!sentAt || !quote.contact_id) return []

          const firstDue = addHours(sentAt, 24)
          const escalationDue = addHours(sentAt, 72)
          const firstKey = `quote-recovery:${quote.id}:24h`
          const escalationKey = `quote-recovery:${quote.id}:72h`
          const payloads = []

          if (!existingIdempotencyKeys.has(firstKey)) {
            payloads.push({
              user_id: quote.user_id,
              contact_id: quote.contact_id,
              type: 'call',
              action: 'call',
              due_date: firstDue,
              priority: Number(quote.total_amount || 0) >= 5000 ? 'high' : 'medium',
              status: 'pending',
              note: `Recovery preventivo ${quote.quote_number || quote.id}: chiamata dopo 24h`,
              idempotency_key: firstKey,
            })
          }

          if (new Date(escalationDue).getTime() <= now && !existingIdempotencyKeys.has(escalationKey)) {
            payloads.push({
              user_id: quote.user_id,
              contact_id: quote.contact_id,
              type: 'call',
              action: 'call',
              due_date: new Date().toISOString(),
              priority: 'high',
              status: 'pending',
              note: `Recovery preventivo ${quote.quote_number || quote.id}: fermo oltre 72h`,
              idempotency_key: escalationKey,
            })
          }

          return payloads
        })
        .filter((task: any) => !existingTaskKeys.has(`${task.contact_id}:${task.due_date}`))
    }

    const taskPayload = [...dueTaskPayload, ...slaTaskPayload, ...quoteTaskPayload].filter((task: any) => {
      const idempotencyKey = String(task.idempotency_key || '').trim()
      if (idempotencyKey && existingIdempotencyKeys.has(idempotencyKey)) return false
      const key = taskKey(task)
      if (existingTaskKeys.has(`${task.contact_id}:${task.due_date}`) || existingTaskKeys.has(key)) return false
      existingIdempotencyKeys.add(idempotencyKey)
      existingTaskKeys.add(`${task.contact_id}:${task.due_date}`)
      existingTaskKeys.add(key)
      return true
    })

    let createdTasks = 0
    if (taskPayload.length && !dryRun) {
      const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .insert(taskPayload)
        .select('id')

      if (taskError) throw taskError
      createdTasks = tasks?.length || 0
    }

    if (!dryRun && recipientEmail && contacts.length) {
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
      sla_mode: slaMode,
      quote_recovery: quoteRecovery,
      contacts_due: contacts.length,
      due_tasks: dueTaskPayload.length,
      due_task_contact_ids: dueTaskPayload.map((task) => task.contact_id).slice(0, 5),
      debug_contact_ids_total: contactIds.length,
      debug_existing_task_keys_size: existingTaskKeys.size,
      debug_existing_idempotency_keys_size: existingIdempotencyKeys.size,
      debug_target_in_contact_ids: contactIds.includes('d42f3973-3228-445a-ae4b-01b533f8621b'),
      debug_target_task_key_match: existingTaskKeys.has('d42f3973-3228-445a-ae4b-01b533f8621b:2026-04-22T09:45:08.207+00:00'),
      debug_target_idempotency_match: existingIdempotencyKeys.has('auto-followup:d42f3973-3228-445a-ae4b-01b533f8621b:2026-04-22T09:45:08.207+00:00:call'),
      debug_target_raw: (() => {
        const target = contacts.find((c: any) => c.id === 'd42f3973-3228-445a-ae4b-01b533f8621b')
        if (!target) return { found_in_contacts: false }
        const dueAt = target.next_action_at || target.next_followup_at
        const action = normalizeTaskAction(
          target.next_followup_at && dueAt === target.next_followup_at
            ? 'call'
            : (target.phone ? 'call' : target.email ? 'send_email' : 'wait')
        )
        const computedKey = `auto-followup:${target.id}:${dueAt}:${action}`
        const computedTaskKey = `${target.id}:${dueAt}`
        return {
          found_in_contacts: true,
          due_at: dueAt,
          action,
          computed_idempotency_key: computedKey,
          computed_task_key: computedTaskKey,
          matches_idempotency_set: existingIdempotencyKeys.has(computedKey),
          matches_task_key_set: existingTaskKeys.has(computedTaskKey),
          due_date_truthy: Boolean(dueAt),
        }
      })(),
      sla_tasks: slaTaskPayload.length,
      quote_recovery_tasks: quoteTaskPayload.length,
      wine_project: { ...wineProject, backfill: wineProjectBackfill },
      created_tasks: createdTasks,
    })
  } catch (error) {
    // Senza questa riga il 500 usciva muto: nei log Railway si vedeva solo lo
    // status, e per capire perche' il cron dei follow-up fosse rosso da giorni
    // bisognava indovinare.
    console.error('followups failed', error)
    return Response.json(
      { error: errorMessage(error, 'Failed to run follow-up automation') },
      { status: 500 }
    )
  }
}
