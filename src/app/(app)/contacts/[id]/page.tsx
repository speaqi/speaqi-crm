'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { ContactModal } from '@/components/crm/ContactModal'
import { apiFetch } from '@/lib/api'
import { ACTIVITY_TYPES, TASK_TYPES, activityTypeLabel, contactScopeLabel, formatDateTime, fromDatetimeLocalValue, holdingListLabel, isClosedStatus, isHoldingContact, priorityLabel, sourceLabel, statusLabel, toDatetimeLocalValue } from '@/lib/data'
import { useCRMContext } from '../../layout'
import type { Activity, ContactDetail, GmailAccountStatus, GmailMessage } from '@/types'

const NOTE_KIND_OPTIONS = [
  { value: 'field', label: 'Campo' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'internal', label: 'Interna' },
]

const TASK_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Bassa' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
]

function readActivityMetadata(activity: Activity): Record<string, unknown> {
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

function isPinnedNote(activity: Activity) {
  const metadata = readActivityMetadata(activity)
  return activity.type === 'note' && Boolean(metadata.pinned)
}

function isActionRequiredNote(activity: Activity) {
  const metadata = readActivityMetadata(activity)
  return activity.type === 'note' && Boolean(metadata.action_required)
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const contactId = params.id
  const { loadContactDetail, stages, teamMembers, updateContact, deleteContact, addActivity, addTask, completeTask, refresh, showToast } = useCRMContext()
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityType, setActivityType] = useState('note')
  const [activityContent, setActivityContent] = useState('')
  const [activityFollowup, setActivityFollowup] = useState('')
  const [activityNoteKind, setActivityNoteKind] = useState('field')
  const [activityPinned, setActivityPinned] = useState(false)
  const [activityActionRequired, setActivityActionRequired] = useState(false)
  const [activityTaskNote, setActivityTaskNote] = useState('')
  const [activityTaskPriority, setActivityTaskPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [taskType, setTaskType] = useState('follow-up')
  const [taskDate, setTaskDate] = useState('')
  const [taskNote, setTaskNote] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [outcomeTaskId, setOutcomeTaskId] = useState<string | null>(null)
  const [gmailSyncing, setGmailSyncing] = useState(false)
  const [gmailSending, setGmailSending] = useState(false)
  const [gmailSubject, setGmailSubject] = useState('')
  const [gmailBody, setGmailBody] = useState('')
  const [gmailFollowup, setGmailFollowup] = useState('')
  const autoSyncedContactIdRef = useRef<string | null>(null)

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

  async function syncGmail(options: { silent?: boolean } = {}) {
    try {
      setGmailSyncing(true)
      const response = await apiFetch<{ synced: number; emails: GmailMessage[]; gmail: GmailAccountStatus }>(
        `/api/contacts/${contactId}/emails/sync`,
        {
          method: 'POST',
        }
      )

      setDetail((previous) =>
        previous
          ? {
              ...previous,
              emails: response.emails,
              gmail: response.gmail,
            }
          : previous
      )

      if (!options.silent) {
        showToast(
          response.synced > 0
            ? `${response.synced} email sincronizzate`
            : 'Nessuna nuova email trovata'
        )
      }
    } catch (error) {
      if (!options.silent) {
        window.alert(error instanceof Error ? error.message : 'Sync Gmail non riuscita')
      }
    } finally {
      setGmailSyncing(false)
    }
  }

  useEffect(() => {
    if (!detail?.gmail.connected || !detail.contact.email) return
    if (autoSyncedContactIdRef.current === detail.contact.id) return

    autoSyncedContactIdRef.current = detail.contact.id
    void syncGmail({ silent: true })
  }, [detail?.contact.email, detail?.contact.id, detail?.gmail.connected])

  if (loading || !detail) {
    return (
      <div className="dash-content">
        <div className="dash-card">Caricamento scheda contatto...</div>
      </div>
    )
  }

  const { contact, activities, tasks } = detail
  const holdingContact = isHoldingContact(contact)
  const pinnedNotes = activities.filter((activity) => isPinnedNote(activity) || isActionRequiredNote(activity))

  return (
    <>
      <div className="dash-content">
        <div className="detail-header">
          <div>
            <Link href={holdingContact ? '/vinitaly' : '/contacts'} className="back-link">
              ← Torna a {holdingContact ? 'alle liste separate' : 'ai contatti'}
            </Link>
            <h1 className="detail-title">{contact.name}</h1>
            <div className="detail-subtitle">
              {statusLabel(contact.status)} · {priorityLabel(contact.priority)} · {sourceLabel(contact.source)} · {contactScopeLabel(contact.contact_scope)}
            </div>
          </div>
          <div className="detail-actions">
            <button className="btn btn-ghost" onClick={() => setEditOpen(true)}>Modifica</button>
          </div>
        </div>

        {holdingContact && (
          <div className="meta-card" style={{ marginBottom: 20 }}>
            <strong>Lista separata: {holdingListLabel(contact)}</strong>
            <span>
              Questo contatto resta fuori da pipeline, calendario e task del CRM. Quando sincronizzi una reply Gmail, viene promosso automaticamente nel CRM operativo.
            </span>
          </div>
        )}

        <div className="detail-grid">
          <div className="dash-card">
            <div className="dash-card-title">Scheda lead</div>
            <div className="detail-stack">
              <div><strong>Azienda:</strong> {contact.company || 'Non impostata'}</div>
              <div><strong>Email:</strong> {contact.email || 'Non impostata'}</div>
              <div><strong>Telefono:</strong> {contact.phone || 'Non impostato'}</div>
              <div><strong>Evento:</strong> {contact.event_tag || 'Non impostato'}</div>
              <div><strong>Lista import:</strong> {contact.list_name || 'Non impostata'}</div>
              <div><strong>Categoria:</strong> {contact.category || 'Non assegnata'}</div>
              <div><strong>Responsabile:</strong> {contact.responsible || 'Non assegnato'}</div>
              <div><strong>Lista:</strong> {contactScopeLabel(contact.contact_scope)}</div>
              <div><strong>Valore:</strong> €{Number(contact.value || 0).toLocaleString('it-IT')}</div>
              <div><strong>Ultimo contatto:</strong> {formatDateTime(contact.last_contact_at)}</div>
              <div><strong>Prossimo follow-up:</strong> {formatDateTime(contact.next_followup_at)}</div>
              <div><strong>Note:</strong> {contact.note || 'Nessuna nota'}</div>
            </div>

            {pinnedNotes.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div className="dash-card-title" style={{ marginBottom: 12 }}>Note in evidenza</div>
                <div className="timeline-list">
                  {pinnedNotes.slice(0, 4).map((activity) => (
                    <div key={activity.id} className="timeline-item">
                      <div className="timeline-marker" />
                      <div style={{ minWidth: 0 }}>
                        <div className="timeline-title">{noteKindLabel(readActivityMetadata(activity).note_kind)}</div>
                        <div className="timeline-time">{formatDateTime(activity.created_at)}</div>
                        <div className="timeline-body">{activity.content || 'Nessun contenuto'}</div>
                        <div className="activity-badge-row">
                          {isPinnedNote(activity) && <span className="activity-badge">Pinned</span>}
                          {isActionRequiredNote(activity) && <span className="activity-badge activity-badge-warn">Action Required</span>}
                          {Boolean(readActivityMetadata(activity).linked_followup_label) && (
                            <span className="activity-badge">
                              {String(readActivityMetadata(activity).linked_followup_label)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(contact.email_open_count || contact.email_click_count || contact.email_unsubscribed_at) ? (
              <div style={{ marginTop: 16, padding: '12px 0 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, color: 'var(--text2)' }}>Email engagement (Acumbamail)</div>
                <div className="detail-stack">
                  <div><strong>Aperture:</strong> {contact.email_open_count || 0}{contact.last_email_open_at ? ` · ultima ${formatDateTime(contact.last_email_open_at)}` : ''}</div>
                  <div><strong>Click:</strong> {contact.email_click_count || 0}{contact.last_email_click_at ? ` · ultimo ${formatDateTime(contact.last_email_click_at)}` : ''}</div>
                  {contact.email_unsubscribed_at && (
                    <div style={{ color: 'var(--danger)' }}><strong>Disiscritto:</strong> {formatDateTime(contact.email_unsubscribed_at)}{contact.email_unsubscribe_source ? ` (${contact.email_unsubscribe_source})` : ''}</div>
                  )}
                </div>
              </div>
            ) : null}
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
            {activityType === 'note' && (
              <>
                <div className="frow">
                  <div className="fg">
                    <label className="fl">Tipo nota</label>
                    <select className="fi" value={activityNoteKind} onChange={(event) => setActivityNoteKind(event.target.value)}>
                      {NOTE_KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!holdingContact && (
                    <div className="fg">
                      <label className="fl">Priorità follow-up</label>
                      <select
                        className="fi"
                        value={activityTaskPriority}
                        onChange={(event) =>
                          setActivityTaskPriority(event.target.value as 'low' | 'medium' | 'high')
                        }
                      >
                        {TASK_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="toggle-row" style={{ marginBottom: 15 }}>
                  <label className="toggle-chip">
                    <input
                      type="checkbox"
                      checked={activityPinned}
                      onChange={(event) => setActivityPinned(event.target.checked)}
                    />
                    <span>Fissa in alto</span>
                  </label>
                  {!holdingContact && (
                    <label className="toggle-chip">
                      <input
                        type="checkbox"
                        checked={activityActionRequired}
                        onChange={(event) => setActivityActionRequired(event.target.checked)}
                      />
                      <span>Richiede azione</span>
                    </label>
                  )}
                </div>
              </>
            )}
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
            {!holdingContact && (
              <>
                <div className="fg">
                  <label className="fl">Prossimo follow-up</label>
                  <input
                    className="fi"
                    type="datetime-local"
                    value={activityFollowup}
                    onChange={(event) => setActivityFollowup(event.target.value)}
                  />
                </div>
                {activityType === 'note' && (
                  <div className="fg">
                    <label className="fl">Label follow-up</label>
                    <input
                      className="fi"
                      value={activityTaskNote}
                      onChange={(event) => setActivityTaskNote(event.target.value)}
                      placeholder="Es. Invia listino aggiornato"
                    />
                  </div>
                )}
              </>
            )}
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  if (activityType === 'note' && activityActionRequired && !activityFollowup) {
                    window.alert('Le note che richiedono azione devono avere un follow-up')
                    return
                  }

                  await addActivity(contact.id, {
                    type: activityType,
                    content: activityContent,
                    metadata:
                      activityType === 'note'
                        ? {
                            note_kind: activityNoteKind,
                            pinned: activityPinned,
                            action_required: activityActionRequired,
                          }
                        : undefined,
                    next_followup_at: holdingContact ? undefined : fromDatetimeLocalValue(activityFollowup),
                    task_type: 'follow-up',
                    task_note: activityTaskNote,
                    task_priority: activityTaskPriority,
                  })
                  setActivityContent('')
                  setActivityFollowup('')
                  setActivityPinned(false)
                  setActivityActionRequired(false)
                  setActivityTaskNote('')
                  setActivityTaskPriority('medium')
                  setActivityNoteKind('field')
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
                      {activity.type === 'note' && (
                        <div className="activity-badge-row">
                          <span className="activity-badge">
                            {noteKindLabel(readActivityMetadata(activity).note_kind)}
                          </span>
                          {isPinnedNote(activity) && <span className="activity-badge">Pinned</span>}
                          {isActionRequiredNote(activity) && (
                            <span className="activity-badge activity-badge-warn">Action Required</span>
                          )}
                          {Boolean(readActivityMetadata(activity).linked_followup_label) && (
                            <span className="activity-badge">
                              {String(readActivityMetadata(activity).linked_followup_label)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-title">Task & follow-up</div>
            {holdingContact ? (
              <p style={{ color: 'var(--text2)', lineHeight: 1.6, margin: 0 }}>
                Nessun task operativo finché il contatto resta nella lista separata. Dopo una reply email, il motore Gmail lo promuove nel CRM e crea la prossima azione.
              </p>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>

        <div className="detail-grid" style={{ marginTop: 20 }}>
          <div className="dash-card" style={{ gridColumn: '1 / -1' }}>
            <div className="detail-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="dash-card-title" style={{ marginBottom: 4 }}>Email & Gmail</div>
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                  Invia email dal CRM e sincronizza i messaggi presenti nella casella Gmail collegata.
                  {holdingContact ? ' Alla prima reply il lead verrà promosso automaticamente nel CRM operativo.' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {contact.email && detail.gmail.connected && (
                  <button className="btn btn-ghost btn-sm" onClick={() => void syncGmail()} disabled={gmailSyncing}>
                    {gmailSyncing ? 'Sync...' : 'Sincronizza Gmail'}
                  </button>
                )}
                {!detail.gmail.connected && (
                  <Link href="/gmail" className="btn btn-primary btn-sm">
                    Collega Gmail
                  </Link>
                )}
              </div>
            </div>

            {!contact.email ? (
              <p style={{ color: 'var(--text2)' }}>Imposta un’email sul contatto per usare Gmail.</p>
            ) : !detail.gmail.connected ? (
              <p style={{ color: 'var(--text2)' }}>
                Nessun account Gmail collegato. Vai su <Link href="/gmail">Gmail</Link> per attivare la sincronizzazione.
              </p>
            ) : (
              <div className="detail-grid" style={{ marginTop: 0 }}>
                <div>
                  <div className="fg">
                    <label className="fl">Oggetto</label>
                    <input
                      className="fi"
                      value={gmailSubject}
                      onChange={(event) => setGmailSubject(event.target.value)}
                      placeholder="Oggetto email"
                    />
                  </div>
                  <div className="fg">
                    <label className="fl">Messaggio</label>
                    <textarea
                      className="fi"
                      rows={6}
                      value={gmailBody}
                      onChange={(event) => setGmailBody(event.target.value)}
                      placeholder="Scrivi qui il testo dell’email"
                      style={{ resize: 'vertical' }}
                    />
                  </div>
                  <div className="fg">
                    <label className="fl">Follow-up dopo email</label>
                    <input
                      className="fi"
                      type="datetime-local"
                      value={gmailFollowup}
                      onChange={(event) => setGmailFollowup(event.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={gmailSending}
                    onClick={async () => {
                      try {
                        setGmailSending(true)
                        await apiFetch(`/api/contacts/${contact.id}/emails`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            subject: gmailSubject,
                            body: gmailBody,
                            followup_at: fromDatetimeLocalValue(gmailFollowup),
                          }),
                        })
                        setGmailSubject('')
                        setGmailBody('')
                        setGmailFollowup('')
                        showToast('Email inviata con Gmail')
                        await loadDetail(false)
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : 'Email non inviata')
                      } finally {
                        setGmailSending(false)
                      }
                    }}
                  >
                    {gmailSending ? 'Invio...' : 'Invia email'}
                  </button>
                </div>

                <div>
                  <div className="detail-stack" style={{ marginBottom: 16, gap: 6 }}>
                    <div><strong>Casella collegata:</strong> {detail.gmail.email || 'Non disponibile'}</div>
                    <div><strong>Ultima sync:</strong> {formatDateTime(detail.gmail.last_sync_at)}</div>
                  </div>

                  <div className="email-thread">
                    {detail.emails.length === 0 ? (
                      <p style={{ color: 'var(--text2)' }}>Nessuna email sincronizzata per questo contatto.</p>
                    ) : (
                      detail.emails.map((email) => (
                        <div key={email.id} className={`email-card ${email.direction}`}>
                          <div className="email-card-header">
                            <div>
                              <div className="email-subject">{email.subject || 'Senza oggetto'}</div>
                              <div className="email-meta">
                                {email.direction === 'outbound' ? 'Inviata' : 'Ricevuta'} · {formatDateTime(email.sent_at)}
                              </div>
                            </div>
                            <div className={`email-direction ${email.direction}`}>
                              {email.direction === 'outbound' ? 'Uscita' : 'Ingresso'}
                            </div>
                          </div>
                          <div className="email-recipient-row">
                            <strong>Da:</strong> {email.from_email || 'Non disponibile'}
                          </div>
                          <div className="email-recipient-row">
                            <strong>A:</strong> {email.to_emails.join(', ') || 'Non disponibile'}
                          </div>
                          {email.cc_emails.length > 0 && (
                            <div className="email-recipient-row">
                              <strong>Cc:</strong> {email.cc_emails.join(', ')}
                            </div>
                          )}
                          <div className="email-preview">{email.body_text || email.snippet || 'Nessun contenuto'}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ContactModal
        open={editOpen}
        title="Modifica contatto"
        stages={stages}
        teamMembers={teamMembers}
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
