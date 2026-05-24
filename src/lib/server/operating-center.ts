import { isClosedStatus } from '@/lib/data'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import type { Activity, CRMContact, OperatingQueueItem, OperatingQueueMode, Quote, Task } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

type QueueOptions = {
  mode?: string | null
  limit?: number
  agent?: string | null
  source?: string | null
  category?: string | null
  isAdmin: boolean
  memberName?: string | null
}

function normalizeMode(value?: string | null): OperatingQueueMode {
  if (value === 'calls' || value === 'overdue' || value === 'quotes') return value
  return 'all'
}

function asDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function ageDays(value?: string | null, now = Date.now()) {
  const date = asDate(value)
  if (!date) return null
  return Math.max(0, Math.floor((now - date.getTime()) / DAY_MS))
}

function isDueToday(value?: string | null, now = new Date()) {
  const date = asDate(value)
  if (!date) return false
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return date >= start && date < end
}

function isOverdue(value?: string | null) {
  const date = asDate(value)
  return !!date && date.getTime() < Date.now()
}

function taskPriorityScore(task?: Task | null) {
  if (!task) return 0
  if (task.priority === 'high') return 22
  if (task.priority === 'medium') return 12
  if (task.priority === 'low') return 5
  return 0
}

function quoteRecoveryAge(quote?: Quote | null) {
  return ageDays(quote?.sent_at || quote?.created_at || null)
}

function quoteValueScore(quote?: Quote | null) {
  const total = Number(quote?.total_amount || 0)
  if (total >= 10000) return 18
  if (total >= 5000) return 12
  if (total >= 1500) return 7
  return quote ? 4 : 0
}

function rankItem(input: {
  contact: CRMContact
  task?: Task | null
  quote?: Quote | null
  lastActivity?: Activity | null
}): OperatingQueueItem {
  const { contact, task = null, quote = null, lastActivity = null } = input
  const reasons: string[] = []
  let score = Math.max(0, Math.min(100, Number(contact.score || 0)))
  const dueAt = task?.due_date || contact.next_action_at || contact.next_followup_at || null
  const lastContactAge = ageDays(contact.last_contact_at || contact.updated_at || contact.created_at)
  const recoveryAge = quoteRecoveryAge(quote)

  if (task?.due_date && isOverdue(task.due_date)) {
    score += 55
    reasons.push('Task scaduto')
  } else if (task?.due_date && isDueToday(task.due_date)) {
    score += 38
    reasons.push('Da lavorare oggi')
  } else if (contact.next_followup_at && isOverdue(contact.next_followup_at)) {
    score += 42
    reasons.push('Follow-up scaduto')
  } else if (contact.next_followup_at && isDueToday(contact.next_followup_at)) {
    score += 28
    reasons.push('Follow-up oggi')
  }

  score += taskPriorityScore(task)

  if (quote && recoveryAge !== null) {
    score += 30 + quoteValueScore(quote)
    reasons.push(recoveryAge >= 3 ? 'Preventivo fermo da 72h+' : 'Preventivo da recuperare')
  }

  if (Number(contact.score || 0) >= 75) {
    score += 18
    reasons.push('Score alto')
  } else if (Number(contact.score || 0) >= 50) {
    score += 8
    reasons.push('Score medio')
  }

  if (contact.phone) {
    score += 8
    reasons.push('Telefono disponibile')
  } else if (contact.email) {
    score += 4
  }

  if (lastContactAge === null) {
    score += 16
    reasons.push('Mai contattato')
  } else if (lastContactAge >= 7) {
    score += 14
    reasons.push(`${lastContactAge} giorni senza contatto`)
  } else if (lastContactAge >= 3) {
    score += 7
  }

  const status = String(contact.status || '').toLowerCase()
  if (status.includes('interested') || status.includes('quote') || status.includes('supertop')) {
    score += 16
    reasons.push('Stage caldo')
  }
  if (status.includes('call')) {
    score += 10
    reasons.push('Call fissata')
  }

  const recommendedAction: OperatingQueueItem['recommended_action'] = quote
    ? 'recover_quote'
    : contact.phone
      ? 'call'
      : contact.email
        ? 'send_email'
        : dueAt
          ? 'schedule_followup'
          : 'review'

  return {
    contact,
    rank_score: Math.round(score),
    rank_reasons: reasons.length ? Array.from(new Set(reasons)).slice(0, 5) : ['Richiede revisione'],
    recommended_action: recommendedAction,
    due_at: dueAt,
    task,
    quote,
    last_activity: lastActivity,
  }
}

function newestQuoteByContact(quotes: Quote[]) {
  const byContact = new Map<string, Quote>()
  for (const quote of quotes) {
    if (!quote.contact_id) continue
    const current = byContact.get(quote.contact_id)
    const currentDate = current?.sent_at || current?.updated_at || current?.created_at || ''
    const quoteDate = quote.sent_at || quote.updated_at || quote.created_at || ''
    if (!current || quoteDate > currentDate) byContact.set(quote.contact_id, quote)
  }
  return byContact
}

function firstPendingTaskByContact(tasks: Task[]) {
  const byContact = new Map<string, Task>()
  const sorted = [...tasks].sort((left, right) => {
    const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER
    const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER
    if (leftDue !== rightDue) return leftDue - rightDue
    return taskPriorityScore(right) - taskPriorityScore(left)
  })

  for (const task of sorted) {
    if (!byContact.has(task.contact_id)) byContact.set(task.contact_id, task)
  }
  return byContact
}

function newestActivityByContact(activities: Activity[]) {
  const byContact = new Map<string, Activity>()
  for (const activity of activities) {
    if (!byContact.has(activity.contact_id)) byContact.set(activity.contact_id, activity)
  }
  return byContact
}

export async function buildOperatingQueue(
  supabase: any,
  userId: string,
  options: QueueOptions
) {
  const mode = normalizeMode(options.mode)
  const limit = Math.max(1, Math.min(200, Number(options.limit || 80)))

  let contactsQuery = supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_scope', 'crm')
    .order('updated_at', { ascending: false })
    .limit(750)

  if (options.source) contactsQuery = contactsQuery.eq('source', options.source)
  if (options.category) contactsQuery = contactsQuery.eq('category', options.category)

  if (!options.isAdmin) {
    const assigneeOr = contactAssigneeMatchOrFilter(options.memberName)
    contactsQuery = assigneeOr ? contactsQuery.or(assigneeOr) : contactsQuery.eq('responsible', '__no_member__')
  } else if (options.agent) {
    const assigneeOr = contactAssigneeMatchOrFilter(options.agent)
    if (assigneeOr) contactsQuery = contactsQuery.or(assigneeOr)
  }

  const { data: contactRows, error: contactsError } = await contactsQuery
  if (contactsError) throw contactsError

  const contacts = ((contactRows || []) as CRMContact[]).filter((contact) => !isClosedStatus(contact.status))
  const contactIds = contacts.map((contact) => contact.id)

  if (!contactIds.length) {
    return { mode, items: [], total: 0 }
  }

  const [tasksResult, quotesResult, activitiesResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('quotes')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1200),
  ])

  if (tasksResult.error) throw tasksResult.error
  if (quotesResult.error) throw quotesResult.error
  if (activitiesResult.error) throw activitiesResult.error

  const allowedContactIds = new Set(contactIds)
  const taskByContact = firstPendingTaskByContact(
    ((tasksResult.data || []) as Task[]).filter((task) => allowedContactIds.has(task.contact_id))
  )
  const quoteByContact = newestQuoteByContact(
    ((quotesResult.data || []) as Quote[]).filter((quote) => quote.contact_id && allowedContactIds.has(quote.contact_id))
  )
  const activityByContact = newestActivityByContact(
    ((activitiesResult.data || []) as Activity[]).filter((activity) => allowedContactIds.has(activity.contact_id))
  )

  const ranked = contacts
    .map((contact) =>
      rankItem({
        contact,
        task: taskByContact.get(contact.id) || null,
        quote: quoteByContact.get(contact.id) || null,
        lastActivity: activityByContact.get(contact.id) || null,
      })
    )
    .filter((item) => {
      if (mode === 'calls') {
        return item.recommended_action === 'call' || item.task?.action === 'call' || item.task?.type === 'call' || item.task?.type === 'follow-up'
      }
      if (mode === 'overdue') {
        return isOverdue(item.task?.due_date || item.contact.next_followup_at || item.contact.next_action_at || null)
      }
      if (mode === 'quotes') return !!item.quote
      return true
    })
    .sort((left, right) => {
      if (right.rank_score !== left.rank_score) return right.rank_score - left.rank_score
      const leftDue = left.due_at ? new Date(left.due_at).getTime() : Number.MAX_SAFE_INTEGER
      const rightDue = right.due_at ? new Date(right.due_at).getTime() : Number.MAX_SAFE_INTEGER
      return leftDue - rightDue
    })

  return {
    mode,
    items: ranked.slice(0, limit),
    total: ranked.length,
  }
}
