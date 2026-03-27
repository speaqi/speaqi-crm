'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { ContactModal } from '@/components/crm/ContactModal'
import { ACTIVITY_TYPES, TASK_TYPES, activityTypeLabel, formatDateTime, fromDatetimeLocalValue, isClosedStatus, priorityLabel, sourceLabel, statusLabel, toDatetimeLocalValue } from '@/lib/data'
import { useCRMContext } from '../../layout'
import type { ContactDetail } from '@/types'

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const contactId = params.id
  const { loadContactDetail, stages, updateContact, deleteContact, addActivity, addTask, completeTask, refresh, showToast } = useCRMContext()
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityType, setActivityType] = useState('call')
  const [activityContent, setActivityContent] = useState('')
  const [activityFollowup, setActivityFollowup] = useState('')
  const [taskType, setTaskType] = useState('follow-up')
  const [taskDate, setTaskDate] = useState('')
  const [taskNote, setTaskNote] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [outcomeTaskId, setOutcomeTaskId] = useState<string | null>(null)

  async function loadDetail(showSpinner = true) {
    if (showSpinner || !detail) setLoading(true)
    try {
      const response = await loadContactDetail(contactId)
      setDetail(response)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Impossibile caricare la scheda contatto')
    } finally {
      if (showSpinner || !detail) setLoading(false)
    }
  }

  useEffect(() => {
    void loadDetail()
  }, [contactId])

  if (loading || !detail) {
    return (
      <div className="dash-content">
        <div className="dash-card">Caricamento scheda contatto...</div>
      </div>
    )
  }

  const { contact, activities, tasks } = detail

  return (
    <>
      <div className="dash-content">
        <div className="detail-header">
          <div>
            <Link href="/contacts" className="back-link">← Torna ai contatti</Link>
            <h1 className="detail-title">{contact.name}</h1>
            <div className="detail-subtitle">
              {statusLabel(contact.status)} · {priorityLabel(contact.priority)} · {sourceLabel(contact.source)}
            </div>
          </div>
          <div className="detail-actions">
            <button className="btn btn-ghost" onClick={() => setEditOpen(true)}>Modifica</button>
          </div>
        </div>

        <div className="detail-grid">
          <div className="dash-card">
            <div className="dash-card-title">Scheda lead</div>
            <div className="detail-stack">
              <div><strong>Email:</strong> {contact.email || 'Non impostata'}</div>
              <div><strong>Telefono:</strong> {contact.phone || 'Non impostato'}</div>
              <div><strong>Responsabile:</strong> {contact.responsible || 'Non assegnato'}</div>
              <div><strong>Valore:</strong> €{Number(contact.value || 0).toLocaleString('it-IT')}</div>
              <div><strong>Ultimo contatto:</strong> {formatDateTime(contact.last_contact_at)}</div>
              <div><strong>Prossimo follow-up:</strong> {formatDateTime(contact.next_followup_at)}</div>
              <div><strong>Note:</strong> {contact.note || 'Nessuna nota'}</div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-title">Registra attività</div>
            <div className="fg">
              <label className="fl">Tipo</label>
              <select className="fi" value={activityType} onChange={(event) => setActivityType(event.target.value)}>
                {ACTIVITY_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Contenuto</label>
              <textarea
                className="fi"
                rows={4}
                value={activityContent}
                onChange={(event) => setActivityContent(event.target.value)}
                style={{ resize: 'vertical' }}
                placeholder="Riassumi cosa è successo e cosa hai concordato"
              />
            </div>
            <div className="fg">
              <label className="fl">Prossimo follow-up</label>
              <input
                className="fi"
                type="datetime-local"
                value={activityFollowup}
                onChange={(event) => setActivityFollowup(event.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await addActivity(contact.id, {
                    type: activityType,
                    content: activityContent,
                    next_followup_at: fromDatetimeLocalValue(activityFollowup),
                    task_type: 'follow-up',
                  })
                  setActivityContent('')
                  setActivityFollowup('')
                  showToast('Attività registrata')
                  await loadDetail(false)
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : 'Attività non salvata')
                }
              }}
            >
              Salva attività
            </button>
          </div>
        </div>

        <div className="detail-grid" style={{ marginTop: 20 }}>
          <div className="dash-card">
            <div className="dash-card-title">Timeline attività</div>
            <div className="timeline-list">
              {activities.length === 0 ? (
                <p style={{ color: 'var(--text3)' }}>Nessuna attività registrata.</p>
              ) : (
                activities.map((activity) => (
                  <div key={activity.id} className="timeline-item">
                      <div className="timeline-marker" />
                    <div>
                      <div className="timeline-title">{activityTypeLabel(activity.type)}</div>
                      <div className="timeline-time">{formatDateTime(activity.created_at)}</div>
                      <div className="timeline-body">{activity.content || 'Nessun contenuto'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-title">Task & follow-up</div>
            <div className="fg">
              <label className="fl">Tipo task</label>
              <select className="fi" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                {TASK_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Data task</label>
              <input className="fi" type="datetime-local" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} />
            </div>
            <div className="fg">
              <label className="fl">Nota task</label>
              <textarea className="fi" rows={2} value={taskNote} onChange={(event) => setTaskNote(event.target.value)} />
            </div>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await addTask(contact.id, {
                    type: taskType,
                    due_date: fromDatetimeLocalValue(taskDate) || '',
                    note: taskNote,
                  })
                  setTaskDate('')
                  setTaskNote('')
                  showToast('Task creato')
                  await loadDetail(false)
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : 'Task non creato')
                }
              }}
            >
              Crea task
            </button>

            <div className="task-list" style={{ marginTop: 20 }}>
              {tasks.length === 0 ? (
                <p style={{ color: 'var(--text3)' }}>Nessun task collegato.</p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className={`task-card ${task.status === 'done' ? 'done' : ''}`}>
                    <div>
                      <strong>{task.type}</strong>
                      <div className="task-date">{formatDateTime(task.due_date)}</div>
                      <div className="task-note">{task.note || 'Nessuna nota'}</div>
                    </div>
                    {task.status === 'pending' ? (
                      task.type === 'call' || task.type === 'follow-up' ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setOutcomeTaskId(task.id)}
                        >
                          Esito chiamata
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            await completeTask(task.id)
                            showToast('Task completato')
                            await loadDetail(false)
                          }}
                        >
                          Completa
                        </button>
                      )
                    ) : (
                      <span className="task-done-label">Fatto</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <ContactModal
        open={editOpen}
        title="Modifica contatto"
        stages={stages}
        initialContact={contact}
        onClose={() => setEditOpen(false)}
        onSave={async (payload) => {
          await updateContact(contact.id, payload)
          showToast('Contatto aggiornato')
          await loadDetail(false)
        }}
        onDelete={async () => {
          await deleteContact(contact.id)
          window.location.href = '/contacts'
        }}
      />

      <CallOutcomeModal
        open={!!outcomeTaskId}
        contact={contact}
        task={tasks.find((task) => task.id === outcomeTaskId) || null}
        stages={stages}
        onClose={() => setOutcomeTaskId(null)}
        onSave={async (payload) => {
          const task = tasks.find((item) => item.id === outcomeTaskId)
          if (!task) return

          await completeTask(task.id, { refresh: false })

          if (payload.status !== contact.status || isClosedStatus(payload.status)) {
            await updateContact(
              contact.id,
              {
                status: payload.status,
                next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at,
              },
              { refresh: false }
            )
          }

          await addActivity(
            contact.id,
            {
              type: 'call',
              content: payload.content,
              next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at,
              task_type: payload.task_type,
            },
            { refresh: false }
          )

          await refresh()
          await loadDetail(false)
          showToast('Chiamata registrata e follow-up aggiornato')
          setOutcomeTaskId(null)
        }}
      />
    </>
  )
}
