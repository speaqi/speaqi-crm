'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { formatDateTime, isClosedStatus, isOverdue, priorityBadgeClass, priorityLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact, TaskWithContact } from '@/types'

export default function AttivitaPage() {
  const { tasks, scheduledCalls, openContactsWithoutQueue, contacts, stages, addActivity, completeTask, refresh, showToast, updateContact } = useCRMContext()
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<TaskWithContact | null>(null)

  const missingNextStep = openContactsWithoutQueue.filter((contact) => !isClosedStatus(contact.status))
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))
  const callsToday = scheduledCalls.filter((item) => new Date(item.due_at).getTime() < tomorrow.getTime())
  const callsTodayWithoutPhone = callsToday.filter((item) => !item.contact.phone).length
  const callsTodayHighPriority = callsToday.filter((item) => item.contact.priority >= 2).length

  return (
    <div className="dash-content">
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
          showToast('Chiamata registrata e follow-up aggiornato')
        }}
      />
    </div>
  )
}
