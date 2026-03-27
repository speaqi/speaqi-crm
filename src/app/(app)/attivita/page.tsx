'use client'

import Link from 'next/link'
import { formatDateTime, isOverdue, priorityBadgeClass, priorityLabel } from '@/lib/data'
import { useCRMContext } from '../layout'

export default function AttivitaPage() {
  const { tasks, contacts, completeTask, showToast } = useCRMContext()
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)

  const missingNextStep = contacts.filter((contact) => contact.status !== 'Closed' && !contact.next_followup_at)
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))
  const callsToday = [...contacts]
    .filter((contact) => {
      if (contact.status === 'Closed' || !contact.next_followup_at) return false
      return new Date(contact.next_followup_at).getTime() < tomorrow.getTime()
    })
    .sort((left, right) => {
      const leftFollowup = left.next_followup_at ? new Date(left.next_followup_at).getTime() : Number.MAX_SAFE_INTEGER
      const rightFollowup = right.next_followup_at ? new Date(right.next_followup_at).getTime() : Number.MAX_SAFE_INTEGER
      return (leftFollowup - rightFollowup) || (right.priority - left.priority) || left.name.localeCompare(right.name)
    })
  const callsTodayWithoutPhone = callsToday.filter((contact) => !contact.phone).length
  const callsTodayHighPriority = callsToday.filter((contact) => contact.priority >= 2).length

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
            callsToday.map((contact) => (
              <div
                key={contact.id}
                className={`task-card ${contact.next_followup_at && isOverdue(contact.next_followup_at) ? 'overdue' : ''}`}
              >
                <div>
                  <strong>{contact.name}</strong>
                  <div className="task-date">
                    {contact.status} · {formatDateTime(contact.next_followup_at)}
                  </div>
                  <div className="task-note">
                    {contact.phone || 'Telefono mancante'} · {contact.last_activity_summary || 'Nessuna attività registrata'}
                  </div>
                  <div className="contact-tags" style={{ marginTop: 8 }}>
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                    {contact.responsible && (
                      <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                        {contact.responsible}
                      </span>
                    )}
                  </div>
                </div>
                <div className="task-actions">
                  <Link href={`/contacts/${contact.id}`} className="btn btn-ghost btn-sm">
                    Apri
                  </Link>
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="btn btn-primary btn-sm">
                      Chiama
                    </a>
                  ) : (
                    <span className="btn btn-ghost btn-sm" style={{ opacity: 0.6, pointerEvents: 'none' }}>
                      N. assente
                    </span>
                  )}
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
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        await completeTask(task.id)
                        showToast('Task completato')
                      }}
                    >
                      Completa
                    </button>
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
                  <div className="timeline-time">{contact.status} · {priorityLabel(contact.priority)}</div>
                  <div className={`ctag ${priorityBadgeClass(contact.priority)}`}>Senza next step</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
