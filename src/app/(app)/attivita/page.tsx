'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { apiFetch } from '@/lib/api'
import { activityTypeLabel, formatDateTime, isClosedStatus, isOverdue, priorityBadgeClass, priorityLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { ActivityWithContact, CRMContact, TaskWithContact } from '@/types'

function padDateNumber(value: number) {
  return String(value).padStart(2, '0')
}

function toDateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDateNumber(date.getMonth() + 1)}-${padDateNumber(date.getDate())}`
}

function buildDayRange(dateValue: string) {
  const start = new Date(`${dateValue}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function formatSelectedDay(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`)
  if (Number.isNaN(date.getTime())) return dateValue

  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function activityMarkerColor(type: string) {
  switch (type) {
    case 'call':
      return '#10b981'
    case 'email':
    case 'email_sent':
    case 'email_reply':
      return '#3b82f6'
    case 'msg':
      return '#f59e0b'
    case 'task':
      return '#7c3aed'
    case 'system':
      return '#64748b'
    default:
      return 'var(--accent)'
  }
}

function readActivityMetadata(activity: ActivityWithContact): Record<string, unknown> {
  return activity.metadata && typeof activity.metadata === 'object' ? activity.metadata : {}
}

function noteKindLabel(value: unknown) {
  switch (String(value || '').trim()) {
    case 'meeting':
      return 'Meeting'
    case 'internal':
      return 'Interna'
    case 'field':
    default:
      return 'Campo'
  }
}

function taskPriorityLabel(value?: string | null) {
  switch (value) {
    case 'high':
      return 'Alta'
    case 'low':
      return 'Bassa'
    default:
      return 'Media'
  }
}

function taskPriorityClass(value?: string | null) {
  if (value === 'high') return 'tag-alta'
  if (value === 'low') return 'tag-bassa'
  return 'tag-media'
}

function shiftTaskDueDate(value: string | null | undefined, days: number) {
  const base = value ? new Date(value) : new Date()
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date()
    fallback.setHours(10, 0, 0, 0)
    fallback.setDate(fallback.getDate() + days)
    return fallback.toISOString()
  }

  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next.toISOString()
}

const GENERIC_ACTIVITY_NAMES = new Set([
  'info',
  'hello',
  'contact',
  'contatto',
  'admin',
  'office',
  'sales',
  'support',
  'team',
  'marketing',
  'commerciale',
  'newsletter',
])

const GENERIC_EMAIL_DOMAIN_ROOTS = new Set([
  'gmail',
  'hotmail',
  'outlook',
  'icloud',
  'yahoo',
  'libero',
])

function domainLabelFromEmail(email?: string | null) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return ''
  const domain = normalizedEmail.split('@')[1] || ''
  const root = domain.split('.')[0] || ''
  if (GENERIC_EMAIL_DOMAIN_ROOTS.has(root)) return normalizedEmail
  if (!root) return normalizedEmail

  return root
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function displayActivityContactName(activity: ActivityWithContact) {
  const name = String(activity.contact?.name || '').trim()
  const email = String(activity.contact?.email || '').trim()

  if (!name) {
    return domainLabelFromEmail(email) || email || 'Contatto'
  }

  if (GENERIC_ACTIVITY_NAMES.has(name.toLowerCase())) {
    return domainLabelFromEmail(email) || email || name
  }

  return name
}

function displayActivityContent(activity: ActivityWithContact) {
  const email = String(activity.contact?.email || '').trim()

  switch (activity.type) {
    case 'email_open':
      return email ? `${email} ha aperto l'email.` : activity.content || "Ha aperto l'email."
    case 'email_click':
      return email ? `${email} ha cliccato l'email.` : activity.content || "Ha cliccato l'email."
    case 'unsubscribe':
      return email ? `${email} si è disiscritto dalla mailing list.` : activity.content || 'Disiscrizione rilevata.'
    default:
      return activity.content || 'Nessun contenuto'
  }
}

function isWorkedEmailType(type: string) {
  return (
    type === 'email' ||
    type === 'email_sent' ||
    type === 'email_reply' ||
    type === 'email_open' ||
    type === 'email_click' ||
    type === 'unsubscribe'
  )
}

export default function AttivitaPage() {
  const { tasks, scheduledCalls, openContactsWithoutQueue, contacts, stages, addActivity, completeTask, updateTask, refresh, showToast, updateContact } = useCRMContext()
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<TaskWithContact | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()))
  const [inboxFilter, setInboxFilter] = useState<'all' | 'overdue' | 'today' | 'high'>('all')
  const [dayActivities, setDayActivities] = useState<ActivityWithContact[]>([])
  const [dayActivitiesLoading, setDayActivitiesLoading] = useState(true)
  const [dayActivitiesError, setDayActivitiesError] = useState<string | null>(null)

  const missingNextStep = openContactsWithoutQueue.filter((contact) => !isClosedStatus(contact.status))
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))
  const callsToday = scheduledCalls.filter((item) => new Date(item.due_at).getTime() < tomorrow.getTime())
  const callsTodayWithoutPhone = callsToday.filter((item) => !item.contact.phone).length
  const callsTodayHighPriority = callsToday.filter((item) => item.contact.priority >= 2).length
  const todayDate = toDateInputValue(new Date())
  const followupInbox = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    return [...tasks]
      .filter((task) => task.status === 'pending')
      .sort((left, right) => {
        const leftOverdue = left.due_date && isOverdue(left.due_date) ? 1 : 0
        const rightOverdue = right.due_date && isOverdue(right.due_date) ? 1 : 0
        if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue

        const leftPriority =
          left.priority === 'high' ? 3 : left.priority === 'medium' ? 2 : left.priority === 'low' ? 1 : 0
        const rightPriority =
          right.priority === 'high' ? 3 : right.priority === 'medium' ? 2 : right.priority === 'low' ? 1 : 0
        if (leftPriority !== rightPriority) return rightPriority - leftPriority

        const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.POSITIVE_INFINITY
        const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.POSITIVE_INFINITY
        if (leftDue !== rightDue) return leftDue - rightDue

        const leftTouched = left.contact?.last_activity_summary ? 1 : 0
        const rightTouched = right.contact?.last_activity_summary ? 1 : 0
        if (leftTouched !== rightTouched) return leftTouched - rightTouched

        return (left.contact?.name || '').localeCompare(right.contact?.name || '')
      })
      .filter((task) => {
        if (inboxFilter === 'all') return true
        if (inboxFilter === 'overdue') return !!task.due_date && isOverdue(task.due_date)
        if (inboxFilter === 'today') {
          if (!task.due_date) return false
          const due = new Date(task.due_date)
          return due >= startOfToday && due < tomorrow
        }
        if (inboxFilter === 'high') {
          return task.priority === 'high' || Number(task.contact?.priority || 0) >= 3
        }
        return true
      })
  }, [inboxFilter, tasks, tomorrow])

  const loadDayActivities = useCallback(async () => {
    setDayActivitiesLoading(true)
    setDayActivitiesError(null)

    try {
      const { start, end } = buildDayRange(selectedDate)
      const response = await apiFetch<{ activities: ActivityWithContact[] }>(
        `/api/activities?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=200`
      )
      setDayActivities(response.activities || [])
    } catch (error) {
      setDayActivitiesError(error instanceof Error ? error.message : 'Impossibile caricare le attività del giorno')
    } finally {
      setDayActivitiesLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    void loadDayActivities()
  }, [loadDayActivities])

  const dayStats = useMemo(() => {
    const contactIds = new Set<string>()
    let calls = 0
    let emails = 0

    for (const activity of dayActivities) {
      contactIds.add(activity.contact_id)
      if (activity.type === 'call') calls += 1
      if (isWorkedEmailType(activity.type)) emails += 1
    }

    return {
      contactsWorked: contactIds.size,
      calls,
      emails,
      other: Math.max(0, dayActivities.length - calls - emails),
    }
  }, [dayActivities])

  return (
    <div className="dash-content">
      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="detail-row" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="dash-card-title" style={{ marginBottom: 4 }}>Lavorato nel giorno</div>
            <div style={{ color: 'var(--text2)', fontSize: 13 }}>
              {selectedDate === todayDate ? 'Oggi' : 'Storico giornaliero'} · {formatSelectedDay(selectedDate)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedDate(todayDate)}
              disabled={selectedDate === todayDate}
            >
              Oggi
            </button>
            <input
              className="fi"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              style={{ minWidth: 170, margin: 0 }}
            />
          </div>
        </div>

        <div className="dash-meta-grid">
          <div className="meta-card meta-card-strong">
            <strong>{dayStats.contactsWorked}</strong>
            <span>contatti toccati nella giornata</span>
          </div>
          <div className="meta-card">
            <strong>{dayStats.calls}</strong>
            <span>chiamate registrate</span>
          </div>
          <div className="meta-card">
            <strong>{dayStats.emails}</strong>
            <span>email lavorate</span>
          </div>
          <div className="meta-card">
            <strong>{dayStats.other}</strong>
            <span>altre attività salvate</span>
          </div>
        </div>

        <div className="timeline-list" style={{ marginTop: 20 }}>
          {dayActivitiesLoading ? (
            <p style={{ color: 'var(--text3)' }}>Caricamento attività del giorno...</p>
          ) : dayActivitiesError ? (
            <p style={{ color: 'var(--danger)' }}>{dayActivitiesError}</p>
          ) : dayActivities.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessuna attività registrata per questa giornata.</p>
          ) : (
            dayActivities.map((activity) => (
              <div key={activity.id} className="timeline-item">
                <div className="timeline-marker" style={{ background: activityMarkerColor(activity.type) }} />
                <div style={{ minWidth: 0 }}>
                  <div className="timeline-title">
                    <Link href={`/contacts/${activity.contact_id}`}>{displayActivityContactName(activity)}</Link>
                    {' · '}
                    {activityTypeLabel(activity.type)}
                  </div>
                  <div className="timeline-time">
                    {formatDateTime(activity.created_at)}
                    {activity.contact?.status ? ` · ${statusLabel(activity.contact.status)}` : ''}
                  </div>
                  <div className="timeline-body">{displayActivityContent(activity)}</div>
                  {activity.type === 'note' && (
                    <div className="activity-badge-row">
                      <span className="activity-badge">
                        {noteKindLabel(readActivityMetadata(activity).note_kind)}
                      </span>
                      {Boolean(readActivityMetadata(activity).pinned) && <span className="activity-badge">Pinned</span>}
                      {Boolean(readActivityMetadata(activity).action_required) && (
                        <span className="activity-badge activity-badge-warn">Action Required</span>
                      )}
                      {Boolean(readActivityMetadata(activity).linked_followup_label) && (
                        <span className="activity-badge">
                          {String(readActivityMetadata(activity).linked_followup_label)}
                        </span>
                      )}
                    </div>
                  )}
                  {activity.contact ? (
                    <div className="contact-tags" style={{ marginTop: 8 }}>
                      <span className={`ctag ${priorityBadgeClass(activity.contact.priority)}`}>
                        {priorityLabel(activity.contact.priority)}
                      </span>
                      {activity.contact.contact_scope === 'holding' && (
                        <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                          Lista separata
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="dash-card-title">Chiamate da fare oggi</div>
        <div className="dash-meta-grid">
          <div className="meta-card meta-card-strong">
            <strong>{callsToday.length}</strong>
            <span>contatti da chiamare oggi o scaduti</span>
          </div>
          <div className="meta-card">
            <strong>{callsTodayHighPriority}</strong>
            <span>contatti ad alta o media priorità</span>
          </div>
          <div className="meta-card">
            <strong>{callsTodayWithoutPhone}</strong>
            <span>contatti senza numero da completare</span>
          </div>
          <div className="meta-card">
            <strong>{overdueTasks.length}</strong>
            <span>task pending in ritardo</span>
          </div>
        </div>

        <div className="task-list" style={{ marginTop: 20 }}>
          {callsToday.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessuna chiamata prevista per oggi.</p>
          ) : (
            callsToday.map((item) => (
              <div
                key={`${item.contact.id}:${item.due_at}`}
                className={`task-card ${isOverdue(item.due_at) ? 'overdue' : ''}`}
              >
                <div>
                  <strong>{item.contact.name}</strong>
                  <div className="task-date">
                    {statusLabel(item.contact.status)} · {formatDateTime(item.due_at)}
                  </div>
                  <div className="task-note">
                    {item.contact.phone || 'Telefono mancante'} · {item.contact.last_activity_summary || 'Nessuna attività registrata'}
                  </div>
                  <div className="contact-tags" style={{ marginTop: 8 }}>
                    <span className={`ctag ${priorityBadgeClass(item.contact.priority)}`}>{priorityLabel(item.contact.priority)}</span>
                    {item.contact.responsible && (
                      <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                        {item.contact.responsible}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  {item.task && (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          await updateTask(item.task!.id, { due_date: shiftTaskDueDate(item.task!.due_date, 1) })
                          showToast('Follow-up spostato di 1 giorno')
                        }}
                      >
                        +1g
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          await updateTask(item.task!.id, { due_date: shiftTaskDueDate(item.task!.due_date, 7) })
                          showToast('Follow-up spostato di 7 giorni')
                        }}
                      >
                        +7g
                      </button>
                    </>
                  )}
                  <Link href={`/contacts/${item.contact.id}`} className="btn btn-ghost btn-sm">
                    Apri
                  </Link>
                  {item.contact.phone ? (
                    <a href={`tel:${item.contact.phone}`} className="btn btn-primary btn-sm">
                      Chiama
                    </a>
                  ) : (
                    <span className="btn btn-ghost btn-sm" style={{ opacity: 0.6, pointerEvents: 'none' }}>
                      N. assente
                    </span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setOutcomeContact(item.contact)
                      setOutcomeTask(item.task)
                    }}
                  >
                    Esito
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div className="dash-card">
          <div className="detail-row" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="dash-card-title" style={{ marginBottom: 4 }}>Follow-up inbox</div>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                Vista unica dei task pending con priorità, contesto e snooze rapido.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className={`filter-chip ${inboxFilter === 'all' ? 'active' : ''}`} onClick={() => setInboxFilter('all')}>
                Tutto
              </button>
              <button className={`filter-chip ${inboxFilter === 'overdue' ? 'active' : ''}`} onClick={() => setInboxFilter('overdue')}>
                Scaduti
              </button>
              <button className={`filter-chip ${inboxFilter === 'today' ? 'active' : ''}`} onClick={() => setInboxFilter('today')}>
                Oggi
              </button>
              <button className={`filter-chip ${inboxFilter === 'high' ? 'active' : ''}`} onClick={() => setInboxFilter('high')}>
                Priorità alta
              </button>
            </div>
          </div>
          <div className="task-list">
            {followupInbox.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nessun task pending.</p>
            ) : (
              followupInbox.map((task) => (
                <div key={task.id} className={`task-card ${task.due_date && isOverdue(task.due_date) ? 'overdue' : ''}`}>
                  <div>
                    <strong>{task.contact?.name || 'Contatto'}</strong>
                    <div className="task-date">{task.type} · {formatDateTime(task.due_date)}</div>
                    <div className="task-note">{task.note || task.contact?.last_activity_summary || 'Nessuna nota'}</div>
                    <div className="contact-tags" style={{ marginTop: 8 }}>
                      <span className={`ctag ${taskPriorityClass(task.priority)}`}>{taskPriorityLabel(task.priority)}</span>
                      {task.contact?.event_tag && <span className="ctag ctag-event">{task.contact.event_tag}</span>}
                      {task.contact?.responsible && (
                        <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                          {task.contact.responsible}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="task-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await updateTask(task.id, { due_date: shiftTaskDueDate(task.due_date, 1) })
                        showToast('Task spostato di 1 giorno')
                      }}
                    >
                      +1g
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await updateTask(task.id, { due_date: shiftTaskDueDate(task.due_date, 3) })
                        showToast('Task spostato di 3 giorni')
                      }}
                    >
                      +3g
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await updateTask(task.id, { due_date: shiftTaskDueDate(task.due_date, 7) })
                        showToast('Task spostato di 7 giorni')
                      }}
                    >
                      +7g
                    </button>
                    {task.contact && (
                      <Link href={`/contacts/${task.contact.id}`} className="btn btn-ghost btn-sm">
                        Apri
                      </Link>
                    )}
                    {task.type === 'call' || task.type === 'follow-up' ? (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const contact = contacts.find((item) => item.id === task.contact_id) || null
                          if (!contact) {
                            window.alert('Contatto non trovato')
                            return
                          }
                          setOutcomeContact(contact)
                          setOutcomeTask(task)
                        }}
                      >
                        Esito chiamata
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          await completeTask(task.id)
                          await loadDayActivities()
                          showToast('Task completato')
                        }}
                      >
                        Completa
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Lead che richiedono intervento</div>
          <div className="meta-card meta-card-strong">
            <strong>{missingNextStep.length}</strong>
            <span>lead aperti senza follow-up impostato</span>
          </div>
          <div className="meta-card meta-card-strong" style={{ marginTop: 12 }}>
            <strong>{overdueTasks.length}</strong>
            <span>task in ritardo</span>
          </div>
          <div className="timeline-list" style={{ marginTop: 20 }}>
            {missingNextStep.slice(0, 8).map((contact) => (
              <div key={contact.id} className="timeline-item">
                <div className="timeline-marker" />
                <div>
                  <div className="timeline-title">
                    <Link href={`/contacts/${contact.id}`}>{contact.name}</Link>
                  </div>
                  <div className="timeline-time">{statusLabel(contact.status)} · {priorityLabel(contact.priority)}</div>
                  <div className={`ctag ${priorityBadgeClass(contact.priority)}`}>Senza next step</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <CallOutcomeModal
        open={!!outcomeContact}
        contact={outcomeContact}
        task={outcomeTask}
        stages={stages}
        onClose={() => {
          setOutcomeContact(null)
          setOutcomeTask(null)
        }}
        onSave={async (payload) => {
          if (!outcomeContact) return

          if (outcomeTask) {
            await completeTask(outcomeTask.id, { refresh: false })
          }

          if (payload.status !== outcomeContact.status || isClosedStatus(payload.status)) {
            await updateContact(
              outcomeContact.id,
              {
                status: payload.status,
                next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at,
              },
              { refresh: false }
            )
          }

          await addActivity(
            outcomeContact.id,
            {
              type: 'call',
              content: payload.content,
              next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at,
              task_type: payload.task_type,
            },
            { refresh: false }
          )

          await refresh()
          await loadDayActivities()
          showToast('Chiamata registrata e follow-up aggiornato')
        }}
      />
    </div>
  )
}
