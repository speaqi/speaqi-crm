'use client'

import Link from 'next/link'
import { formatDateTime, isOverdue, priorityBadgeClass, priorityLabel } from '@/lib/data'
import { useCRMContext } from '../layout'

export default function AttivitaPage() {
  const { tasks, contacts, completeTask, showToast } = useCRMContext()

  const missingNextStep = contacts.filter((contact) => contact.status !== 'Closed' && !contact.next_followup_at)
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))

  return (
    <div className="dash-content">
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
