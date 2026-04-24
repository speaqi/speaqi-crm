import { isClosedStatus } from '@/lib/data'
import type { CRMContact, TaskWithContact } from '@/types'

export type ScheduledCall = {
  contact: CRMContact
  task: TaskWithContact | null
  due_at: string
  source: 'contact' | 'task'
  task_type: string
}

function asTimestamp(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY
}

export function isCallTaskType(type?: string | null) {
  return type === 'follow-up' || type === 'call'
}

export function compareScheduledCalls(left: ScheduledCall, right: ScheduledCall) {
  return (
    (asTimestamp(left.due_at) - asTimestamp(right.due_at)) ||
    (right.contact.priority - left.contact.priority) ||
    left.contact.name.localeCompare(right.contact.name)
  )
}

export function buildScheduledCalls(contacts: CRMContact[], tasks: TaskWithContact[]) {
  const pendingCallTasks = new Map<string, TaskWithContact[]>()

  for (const task of tasks) {
    if (task.status !== 'pending' || !task.due_date || !isCallTaskType(task.type)) continue
    const current = pendingCallTasks.get(task.contact_id) || []
    current.push(task)
    pendingCallTasks.set(task.contact_id, current)
  }

  for (const taskList of pendingCallTasks.values()) {
    taskList.sort((left, right) => asTimestamp(left.due_date) - asTimestamp(right.due_date))
  }

  const scheduledCalls: ScheduledCall[] = []

  for (const contact of contacts) {
    if (isClosedStatus(contact.status)) continue

    const contactDueAt = contact.next_followup_at || null
    const earliestTask = (pendingCallTasks.get(contact.id) || [])[0] || null
    const contactTimestamp = asTimestamp(contactDueAt)
    const taskTimestamp = asTimestamp(earliestTask?.due_date)

    if (!Number.isFinite(contactTimestamp) && !Number.isFinite(taskTimestamp)) continue

    if (taskTimestamp <= contactTimestamp) {
      scheduledCalls.push({
        contact,
        task: earliestTask,
        due_at: earliestTask?.due_date || contactDueAt || '',
        source: 'task',
        task_type: earliestTask?.type || 'follow-up',
      })
      continue
    }

    const alignedTask =
      pendingCallTasks
        .get(contact.id)
        ?.find((task) => task.due_date === contactDueAt) || null

    scheduledCalls.push({
      contact,
      task: alignedTask,
      due_at: contactDueAt || earliestTask?.due_date || '',
      source: 'contact',
      task_type: alignedTask?.type || 'follow-up',
    })
  }

  return scheduledCalls.sort(compareScheduledCalls)
}

/** Chiave YYYY-MM-DD nel fuso locale (stesso “giorno di calendario” dell’utente). */
export function localDayDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Chiave giorno locale da ISO salvato su DB (evita che “oggi” finisca nel bucket sbagliato con UTC). */
export function dueAtLocalDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return localDayDateKey(d)
}
