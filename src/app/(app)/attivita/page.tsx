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

function isWorkedEmailType(type: string) {
  return type === 'email' || type === 'email_sent' || type === 'email_reply'
}

export default function AttivitaPage() {
  const { tasks, scheduledCalls, openContactsWithoutQueue, contacts, stages, addActivity, completeTask, refresh, showToast, updateContact } = useCRMContext()
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<TaskWithContact | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()))
  const [dayActivities, setDayActivities] = useState<ActivityWithContact[]>([])
  const [dayActivitiesLoading, setDayActivitiesLoading] = useState(true)
  const [dayActivitiesError, setDayActivitiesError] = useState<string | null>(null)

  const missingNextStep = openContactsWithoutQueue.filter((contact) => !isClosedStatus(contact.status))
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))
  const callsToday = scheduledCalls.filter((item) => new Date(item.due_at).getTime() < tomorrow.getTime())
  const callsTodayWithoutPhone = callsToday.filter((item) => !item.contact.phone).length
  const callsTodayHighPriority = callsToday.filter((item) => item.contact.priority >= 2).length
  const todayDate = toDateInputValue(new Date())

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
                    <Link href={`/contacts/${activity.contact_id}`}>{activity.contact?.name || 'Contatto'}</Link>
                    {' · '}
                    {activityTypeLabel(activity.type)}
                  </div>
                  <div className="timeline-time">
                    {formatDateTime(activity.created_at)}
                    {activity.contact?.status ? ` · ${statusLabel(activity.contact.status)}` : ''}
                  </div>
                  <div className="timeline-body">{activity.content || 'Nessun contenuto'}</div>
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
          <div className="dash-card-title">Task pending</div>
          <div className="task-list">
            {tasks.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nessun task pending.</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className={`task-card ${task.due_date && isOverdue(task.due_date) ? 'overdue' : ''}`}>
                  <div>
                    <strong>{task.contact?.name || 'Contatto'}</strong>
                    <div className="task-date">{task.type} · {formatDateTime(task.due_date)}</div>
                    <div className="task-note">{task.note || 'Nessuna nota'}</div>
                  </div>
                  <div className="task-actions">
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
