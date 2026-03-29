'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import {
  formatDateTime,
  isCallableDate,
  isClosedStatus,
  isOverdue,
  nextCallableDateTime,
  priorityBadgeClass,
  priorityLabel,
  statusLabel,
  toLocalDateKey,
} from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'
import { useCRMContext } from '../layout'
import type { CRMContact, TaskWithContact } from '@/types'

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  const day = next.getDay()
  const offset = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + offset)
  return next
}

function formatDayHeading(date: Date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function getInitialCalendarDateKey(scheduledCalls: ScheduledCall[]) {
  const today = new Date()
  if (isCallableDate(today)) {
    return toLocalDateKey(today)
  }

  const startOfToday = new Date(today)
  startOfToday.setHours(0, 0, 0, 0)

  const nextScheduledCall = scheduledCalls.find(
    (item) => new Date(item.due_at).getTime() >= startOfToday.getTime()
  )

  return toLocalDateKey(nextScheduledCall?.due_at || nextCallableDateTime(today))
}

export default function CalendarioPage() {
  const { scheduledCalls, stages, completeTask, addActivity, updateContact, refresh, showToast } = useCRMContext()
  const [selectedDateKey, setSelectedDateKey] = useState(() => getInitialCalendarDateKey(scheduledCalls))
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<TaskWithContact | null>(null)

  const contactsByDay = useMemo(
    () =>
      scheduledCalls.reduce<Record<string, ScheduledCall[]>>((groups, item) => {
        const key = toLocalDateKey(item.due_at)
        if (!key) return groups
        if (!groups[key]) groups[key] = []
        groups[key].push(item)
        return groups
      }, {}),
    [scheduledCalls]
  )

  const selectedDate = useMemo(() => new Date(`${selectedDateKey}T09:00:00`), [selectedDateKey])
  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])

  const selectedCalls = contactsByDay[selectedDateKey] || []
  const selectedCallable = isCallableDate(selectedDate)
  const selectedMissingPhone = selectedCalls.filter((item) => !item.contact.phone).length
  const selectedHighPriority = selectedCalls.filter((item) => item.contact.priority >= 2).length
  const selectedOverdue = selectedCalls.filter((item) => isOverdue(item.due_at)).length
  const nextCallableLabel = formatDayHeading(nextCallableDateTime(selectedDate))

  return (
    <>
      <div className="cal-content">
        <div className="cal-top">
          <div className="cal-today">
            <div className="cal-today-header">
              <div className="cal-today-title">Giorno selezionato</div>
              <span className={`callability-chip ${selectedCallable ? 'ok' : 'blocked'}`}>
                {selectedCallable ? 'Chiamabile' : 'Non chiamabile'}
              </span>
            </div>

            <div className="cal-day-title">{formatDayHeading(selectedDate)}</div>
            <div className="cal-day-copy">
              {selectedCallable
                ? 'Finestra consigliata: 09:00 - 18:00. Usa la coda qui sotto per chiudere le chiamate e aprire subito il follow-up.'
                : `Questo giorno non e valido per le chiamate. Prossimo giorno utile: ${nextCallableLabel}.`}
            </div>

            <div className="dash-meta-grid" style={{ marginTop: 16 }}>
              <div className="meta-card meta-card-strong">
                <strong>{selectedCalls.length}</strong>
                <span>chiamate pianificate</span>
              </div>
              <div className="meta-card">
                <strong>{selectedHighPriority}</strong>
                <span>priorita alta o media</span>
              </div>
              <div className="meta-card">
                <strong>{selectedMissingPhone}</strong>
                <span>contatti senza numero</span>
              </div>
              <div className="meta-card">
                <strong>{selectedOverdue}</strong>
                <span>scaduti da riallineare</span>
              </div>
            </div>
          </div>

          <div className="week-cal">
            <div className="week-header">
              <div className="week-title">Settimana di chiamata</div>
              <div className="week-nav">
                <button
                  className="week-nav-btn"
                  onClick={() => setSelectedDateKey(toLocalDateKey(addDays(selectedDate, -7)))}
                >
                  ←
                </button>
                <button
                  className="week-nav-btn"
                  onClick={() => setSelectedDateKey(toLocalDateKey(new Date()))}
                >
                  Oggi
                </button>
                <button
                  className="week-nav-btn"
                  onClick={() => setSelectedDateKey(toLocalDateKey(addDays(selectedDate, 7)))}
                >
                  →
                </button>
              </div>
            </div>

            <div className="week-grid">
              {weekDays.map((day) => {
                const dayKey = toLocalDateKey(day)
                const dayCalls = contactsByDay[dayKey] || []
                const isToday = dayKey === toLocalDateKey(new Date())
                const isSelected = dayKey === selectedDateKey
                const callable = isCallableDate(day)

                return (
                  <div key={dayKey} className={`day-col ${callable ? '' : 'day-col-blocked'}`}>
                    <div className="day-header">
                      {day.toLocaleDateString('it-IT', { weekday: 'short' })}
                    </div>
                    <button
                      className={`day-num ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${callable ? '' : 'blocked'}`}
                      onClick={() => setSelectedDateKey(dayKey)}
                    >
                      {day.getDate()}
                    </button>
                    <div className="day-events">
                      {dayCalls.slice(0, 3).map((item) => (
                        <div
                          key={`${item.contact.id}:${item.due_at}`}
                          className={`day-event ${
                            item.contact.priority >= 3 ? 'alta' : item.contact.priority === 2 ? 'media' : 'normal'
                          }`}
                          onClick={() => setSelectedDateKey(dayKey)}
                          title={`${item.contact.name} · ${formatDateTime(item.due_at)}`}
                        >
                          {item.contact.name}
                        </div>
                      ))}
                      {dayCalls.length > 3 && (
                        <div className="day-event normal">+{dayCalls.length - 3} altri</div>
                      )}
                      {!callable && dayCalls.length === 0 && (
                        <div className="day-event day-event-blocked">No call</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="cal-queue">
          <div className="cal-queue-header">
            <div className="week-title">Coda chiamate del giorno</div>
            <div className="call-sub">
              {selectedCalls.length} pianificate · {selectedCallable ? 'giorno attivo' : 'giorno bloccato'}
            </div>
          </div>

          {selectedCalls.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessuna chiamata assegnata a questa data.</p>
          ) : (
            <div className="task-list">
              {selectedCalls.map((item) => {
                const { contact, task } = item
                return (
                  <div
                    key={`${contact.id}:${item.due_at}`}
                    className={`task-card ${isOverdue(item.due_at) ? 'overdue' : ''}`}
                  >
                    <div>
                      <strong>{contact.name}</strong>
                      <div className="task-date">
                        {statusLabel(contact.status)} · {formatDateTime(item.due_at)}
                      </div>
                      <div className="task-note">
                        {contact.phone || 'Telefono mancante'} · {contact.last_activity_summary || 'Nessuna attività registrata'}
                      </div>
                      <div className="contact-tags" style={{ marginTop: 8 }}>
                        <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                        <span className="ctag" style={{ background: 'var(--surface)', color: 'var(--text2)' }}>
                          {task?.type || item.task_type}
                        </span>
                      </div>
                    </div>
                    <div className="task-actions">
                      <Link href={`/contacts/${contact.id}`} className="btn btn-ghost btn-sm">
                        Apri
                      </Link>
                      {contact.phone ? (
                        <a href={`tel:${contact.phone}`} className="btn btn-ghost btn-sm">
                          Chiama
                        </a>
                      ) : null}
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setOutcomeContact(contact)
                          setOutcomeTask(task)
                        }}
                      >
                        Esito chiamata
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
          showToast('Chiamata registrata e follow-up aggiornato')
        }}
      />
    </>
  )
}
