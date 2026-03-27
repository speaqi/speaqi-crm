'use client'

import { useMemo } from 'react'
import { useCRMContext } from '../layout'
import { formatDateTime, isClosedStatus, isOverdue, isPipelineVisible, priorityLabel, statusLabel } from '@/lib/data'

export default function DashboardPage() {
  const { contacts, tasks, stages, speaqiContacts } = useCRMContext()

  const pipelineContacts = contacts.filter(isPipelineVisible)
  const openContacts = pipelineContacts.filter((contact) => !isClosedStatus(contact.status))
  const overdueContacts = contacts.filter((contact) => isOverdue(contact.next_followup_at) && !isClosedStatus(contact.status))
  const overdueTasks = tasks.filter((task) => task.due_date && isOverdue(task.due_date))

  const pipeline = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        count: pipelineContacts.filter((contact) => contact.status === stage.name).length,
      })),
    [pipelineContacts, stages]
  )

  const maxCount = Math.max(...pipeline.map((stage) => stage.count), 1)
  const hotContacts = [...contacts]
    .filter((contact) => contact.priority >= 2 && !isClosedStatus(contact.status))
    .sort((left, right) => (right.priority - left.priority) || left.name.localeCompare(right.name))
    .slice(0, 8)

  const totalValue = contacts.reduce((sum, contact) => sum + Number(contact.value || 0), 0)

  return (
    <div className="dash-content">
      <div className="kpi-grid">
        <div className="kpi" style={{ borderLeftColor: '#4f6ef7' }}>
          <div className="kpi-icon">👥</div>
          <div className="kpi-val" style={{ color: '#4f6ef7' }}>{contacts.length}</div>
          <div className="kpi-label">Contatti Totali</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#10b981' }}>
          <div className="kpi-icon">🟢</div>
          <div className="kpi-val" style={{ color: '#10b981' }}>{openContacts.length}</div>
          <div className="kpi-label">Pipeline Aperta</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#ef4444' }}>
          <div className="kpi-icon">⏰</div>
          <div className="kpi-val" style={{ color: '#ef4444' }}>{overdueContacts.length}</div>
          <div className="kpi-label">Follow-up Scaduti</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#f59e0b' }}>
          <div className="kpi-icon">✅</div>
          <div className="kpi-val" style={{ color: '#f59e0b' }}>{tasks.length}</div>
          <div className="kpi-label">Task Pending</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#7c3aed' }}>
          <div className="kpi-icon">⚡</div>
          <div className="kpi-val" style={{ color: '#7c3aed' }}>{speaqiContacts.length}</div>
          <div className="kpi-label">Lead Inbound</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#059669' }}>
          <div className="kpi-icon">💰</div>
          <div className="kpi-val" style={{ color: '#059669' }}>€{totalValue.toLocaleString('it-IT')}</div>
          <div className="kpi-label">Valore Stimato</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-card">
          <div className="dash-card-title">Pipeline per Stadio</div>
          <div className="prog-list">
            {pipeline.map((stage) => (
              <div key={stage.id} className="prog-row">
                <span className="prog-label">{statusLabel(stage.name)}</span>
                <div className="prog-bar">
                  <div
                    className="prog-fill"
                    style={{
                      width: `${Math.round((stage.count / maxCount) * 100)}%`,
                      background: stage.color || '#4f6ef7',
                    }}
                  />
                </div>
                <span className="prog-num">{stage.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Lead da sbloccare subito</div>
          <div className="activity-list">
            {hotContacts.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>Nessun lead prioritario.</p>
            ) : (
              hotContacts.map((contact) => (
                <div key={contact.id} className="activity-item">
                  <div className="activity-dot" style={{ background: contact.priority >= 3 ? '#ef4444' : '#f59e0b' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="activity-name">{contact.name}</div>
                    <div className="activity-stato">
                      {priorityLabel(contact.priority)} · {statusLabel(contact.status)} · {formatDateTime(contact.next_followup_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="dash-grid" style={{ marginTop: 20 }}>
        <div className="dash-card">
          <div className="dash-card-title">Task in ritardo</div>
          <div className="activity-list">
            {overdueTasks.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>Nessun task in ritardo.</p>
            ) : (
              overdueTasks.slice(0, 8).map((task) => (
                <div key={task.id} className="activity-item">
                  <div className="activity-dot" style={{ background: '#ef4444' }} />
                  <span className="activity-name">{task.contact?.name || 'Contatto'}</span>
                  <span className="activity-stato">{formatDateTime(task.due_date)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Disciplina commerciale</div>
          <div className="dash-meta-grid">
            <div className="meta-card">
              <strong>{contacts.filter((contact) => !contact.next_followup_at && !isClosedStatus(contact.status)).length}</strong>
              <span>lead aperti senza follow-up</span>
            </div>
            <div className="meta-card">
              <strong>{contacts.filter((contact) => !!contact.last_contact_at).length}</strong>
              <span>contatti con ultimo contatto tracciato</span>
            </div>
            <div className="meta-card">
              <strong>{contacts.filter((contact) => contact.source === 'speaqi').length}</strong>
              <span>lead inbound</span>
            </div>
            <div className="meta-card">
              <strong>{contacts.filter((contact) => contact.status === 'Lost').length}</strong>
              <span>lead persi</span>
            </div>
            <div className="meta-card">
              <strong>{contacts.filter((contact) => contact.status === 'Closed').length}</strong>
              <span>lead chiusi</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
