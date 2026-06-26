'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { ContactModal } from '@/components/crm/ContactModal'
import { APIError, apiFetch } from '@/lib/api'
import { ACTIVITY_TYPES, TASK_TYPES, activityTypeLabel, contactScopeLabel, formatDateTime, fromDatetimeLocalValue, holdingListLabel, isClosedStatus, isHoldingContact, isPartnerContact, isPersonalContact, personalSectionLabel, priorityLabel, sourceLabel, stageColor, statusLabel, toDatetimeLocalValue } from '@/lib/data'
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
    case 'meeting': return 'Meeting'
    case 'internal': return 'Interna'
    case 'field': default: return 'Campo'
  }
}

function isPinnedNote(activity: Activity) {
  return activity.type === 'note' && Boolean(readActivityMetadata(activity).pinned)
}

function isActionRequiredNote(activity: Activity) {
  return activity.type === 'note' && Boolean(readActivityMetadata(activity).action_required)
}

function scoreBadge(score: number) {
  if (score >= 80) return '🔥'
  if (score >= 60) return '⭐'
  if (score >= 40) return '👍'
  return ''
}

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>()
  const contactId = params.id
  const { loadContactDetail, stages, teamMembers, updateContact, deleteContact, addActivity, addTask, completeTask, refresh, showToast } = useCRMContext()
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
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
  const [gmailDraftGenerating, setGmailDraftGenerating] = useState(false)
  const [gmailDraftNoteSaving, setGmailDraftNoteSaving] = useState(false)
  const [gmailDraftNote, setGmailDraftNote] = useState('')
  const [gmailSubject, setGmailSubject] = useState('')
  const [gmailBody, setGmailBody] = useState('')
  const [gmailFollowup, setGmailFollowup] = useState('')
  const autoSyncedContactIdRef = useRef<string | null>(null)
  const [changingStage, setChangingStage] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false)

  async function loadDetail(showSpinner = true) {
    if (showSpinner || !detail) setLoading(true)
    setLoadError('')
    try {
      const response = await loadContactDetail(contactId)
      setDetail(response)
    } catch (error) {
      setDetail(null)
      if (error instanceof APIError && error.status === 404) {
        setLoadError('Contatto non trovato o rimosso')
        return
      }
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare la scheda contatto')
    } finally {
      if (showSpinner || !detail) setLoading(false)
    }
  }

  useEffect(() => { void loadDetail() }, [contactId])

  // ─── Pipeline stage change ───
  async function handleStageChange(newStatus: string) {
    if (!detail || newStatus === detail.contact.status) return
    setChangingStage(true)
    try {
      await updateContact(contactId, { status: newStatus })
      showToast(`Stato aggiornato: ${statusLabel(newStatus)}`)
      await loadDetail(false)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'cambio stato'}`)
    } finally {
      setChangingStage(false)
    }
  }

  // ─── Promote to partner ───
  const [promotingToPartner, setPromotingToPartner] = useState(false)
  async function handlePromoteToPartner() {
    if (!detail) return
    setPromotingToPartner(true)
    try {
      await updateContact(contactId, { contact_scope: 'partner' })
      showToast('Spostato nei Partner')
      await loadDetail(false)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'spostamento partner'}`)
    } finally {
      setPromotingToPartner(false)
    }
  }

  // ─── AI next action suggestion ───
  async function fetchAiSuggestion() {
    setAiSuggestionLoading(true)
    try {
      const result = await apiFetch<{ suggestion: { action: string; delay_hours: number; priority: string; reason?: string } }>(
        '/api/ai/next-action',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: contactId }) }
      )
      const s = result.suggestion
      const actionLabel = s.action === 'call' ? '📞 Chiama' : s.action === 'send_email' ? '✉️ Invia email' : '⏳ Attendi'
      const timing = s.delay_hours <= 0 ? 'subito' : s.delay_hours <= 24 ? `entro ${s.delay_hours}h` : `tra ${Math.round(s.delay_hours / 24)}gg`
      setAiSuggestion(`${actionLabel} ${timing}${s.reason ? ` — ${s.reason}` : ''}`)
    } catch {
      setAiSuggestion(null)
    } finally {
      setAiSuggestionLoading(false)
    }
  }

  // ─── Quick action: open call/email/whatsapp ───
  function quickCall() {
    if (contact.phone) window.open(`tel:${contact.phone}`)
    else showToast('Nessun numero di telefono')
  }
  function quickEmail() {
    if (contact.email) window.open(`mailto:${contact.email}`)
    else showToast('Nessuna email')
  }
  function quickWhatsApp() {
    const phone = contact.phone?.replace(/[^+\d]/g, '')
    if (phone) window.open(`https://wa.me/${phone}`)
    else showToast('Nessun numero di telefono')
  }

  // ─── Gmail sync ───
  async function syncGmail(options: { silent?: boolean } = {}) {
    try {
      setGmailSyncing(true)
      const response = await apiFetch<{ synced: number; emails: GmailMessage[]; gmail: GmailAccountStatus }>(
        `/api/contacts/${contactId}/emails/sync`, { method: 'POST' }
      )
      setDetail((previous) => previous ? { ...previous, emails: response.emails, gmail: response.gmail } : previous)
      if (!options.silent) showToast(response.synced > 0 ? `${response.synced} email sincronizzate` : 'Nessuna nuova email trovata')
    } catch (error) {
      if (!options.silent) window.alert(error instanceof Error ? error.message : 'Sync Gmail non riuscita')
    } finally { setGmailSyncing(false) }
  }

  useEffect(() => {
    if (!detail?.gmail.connected || !detail.contact.email) return
    if (autoSyncedContactIdRef.current === detail.contact.id) return
    autoSyncedContactIdRef.current = detail.contact.id
    void syncGmail({ silent: true })
  }, [detail?.contact.email, detail?.contact.id, detail?.gmail.connected])

  useEffect(() => {
    setGmailDraftNote(detail?.contact.email_draft_note || '')
  }, [detail?.contact.email_draft_note])

  if (loading) return <div className="dash-content"><div className="dash-card">Caricamento scheda contatto...</div></div>

  if (!detail) {
    return (
      <div className="dash-content">
        <div className="dash-card">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{loadError || 'Scheda non disponibile'}</div>
          <Link href="/contacts" className="btn btn-ghost btn-sm">Torna ai contatti</Link>
        </div>
      </div>
    )
  }

  const { contact, activities, tasks } = detail
  const holdingContact = isHoldingContact(contact)
  const personalContact = isPersonalContact(contact)
  const partnerContact = isPartnerContact(contact)
  const pinnedNotes = activities.filter((activity) => isPinnedNote(activity) || isActionRequiredNote(activity))
  const activeStages = stages.filter((s) => {
    const key = (s.system_key || s.name).toLowerCase()
    return !['lost', 'closed', 'paid'].includes(key)
  })
  const closedStages = stages.filter((s) => {
    const key = (s.system_key || s.name).toLowerCase()
    return ['lost', 'closed', 'paid'].includes(key)
  })

  const backLabel = holdingContact ? 'alle liste separate' : personalContact ? 'ai personali' : partnerContact ? 'ai partner' : 'ai contatti'
  const backHref = holdingContact ? '/contacts?scope=holding' : personalContact ? '/personali' : partnerContact ? '/partner' : '/contacts'

  return (
    <>
      <div className="dash-content">
        {/* ─── HEADER ─── */}
        <div className="detail-header-new">
          <div className="detail-header-top">
            <div className="detail-header-info">
              <Link href={backHref} className="back-link">← Torna {backLabel}</Link>
              <h1 className="detail-title-new">{contact.name}</h1>
              <div className="detail-subtitle-new">
                {contact.company && <span className="detail-company-badge">{contact.company}</span>}
                <span className="detail-status-badge" style={{ background: stageColor(contact.status, stages), color: '#fff' }}>
                  {statusLabel(contact.status)}
                </span>
                {(contact.score || 0) > 0 && (
                  <span className="detail-score-badge" title={`Score: ${contact.score}`}>
                    {scoreBadge(contact.score || 0)} {contact.score}
                  </span>
                )}
                {contact.priority > 0 && (
                  <span className="detail-priority-badge">⚡ {priorityLabel(contact.priority)}</span>
                )}
                {contact.value ? (
                  <span className="detail-value-badge">
                    €{Number(contact.value).toLocaleString('it-IT')}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="detail-header-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
                ✏️ Modifica
              </button>
            </div>
          </div>

          {/* ─── QUICK ACTIONS + LOST REASON ─── */}
          {!holdingContact && !personalContact && !partnerContact && (
            <div className="detail-quick-actions">
              <button className="detail-quick-btn" onClick={quickCall} title="Chiama">
                📞 Chiama
              </button>
              <button className="detail-quick-btn" onClick={quickEmail} title="Invia email">
                ✉️ Email
              </button>
              <button className="detail-quick-btn" onClick={quickWhatsApp} title="WhatsApp">
                💬 WhatsApp
              </button>
              {contact.phone && <span className="detail-quick-phone">{contact.phone}</span>}
              {contact.email && <span className="detail-quick-email">{contact.email}</span>}

              {contact.status.toLowerCase() === 'lost' && contact.lost_reason && (
                <span className="detail-lost-reason" title="Motivo perdita">
                  🚫 {contact.lost_reason}
                </span>
              )}
            </div>
          )}

          {/* ─── AI SUGGESTION ─── */}
          {!holdingContact && !personalContact && !partnerContact && (
            <div className="detail-ai-box">
              {aiSuggestion ? (
                <span className="detail-ai-text">💡 {aiSuggestion}</span>
              ) : (
                <button
                  className="detail-ai-btn"
                  disabled={aiSuggestionLoading}
                  onClick={fetchAiSuggestion}
                >
                  {aiSuggestionLoading ? '🧠 Analisi in corso...' : '🧠 Suggerisci prossima azione'}
                </button>
              )}
            </div>
          )}

          {/* ─── PIPELINE STAGE BAR ─── */}
          {!holdingContact && !personalContact && !partnerContact && (
            <div className="detail-stage-bar">
              <div className="detail-stage-bar-label">Pipeline</div>
              <div className="detail-stage-bar-stages">
                {activeStages.map((stage) => {
                  const isCurrent = stage.name === contact.status
                  const isDisabled = changingStage
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      className={`detail-stage-chip ${isCurrent ? 'active' : ''}`}
                      style={{
                        '--stage-color': stage.color || '#4f6ef7',
                        borderColor: isCurrent ? stage.color : undefined,
                        background: isCurrent ? stage.color : undefined,
                        color: isCurrent ? '#fff' : undefined,
                      } as React.CSSProperties}
                      disabled={isDisabled || isCurrent}
                      onClick={() => handleStageChange(stage.name)}
                      title={`Sposta in ${statusLabel(stage.name)}`}
                    >
                      {statusLabel(stage.name)}
                    </button>
                  )
                })}
                <span className="detail-stage-sep">·</span>
                <button
                  type="button"
                  className={`detail-stage-chip detail-stage-partner ${partnerContact ? 'active' : ''}`}
                  style={{
                    '--stage-color': '#f59e0b',
                    borderColor: partnerContact ? '#f59e0b' : undefined,
                    background: partnerContact ? '#f59e0b' : undefined,
                    color: partnerContact ? '#fff' : undefined,
                  } as React.CSSProperties}
                  disabled={promotingToPartner || partnerContact}
                  onClick={handlePromoteToPartner}
                  title={partnerContact ? 'Già nei Partner' : 'Sposta nei Partner'}
                >
                  🤝 Partner
                </button>
                <span className="detail-stage-sep">·</span>
                {closedStages.map((stage) => {
                  const isCurrent = stage.name === contact.status
                  const isDisabled = changingStage
                  return (
                    <button
                      key={stage.id}
                      type="button"
                      className={`detail-stage-chip detail-stage-closed ${isCurrent ? 'active' : ''}`}
                      style={{
                        '--stage-color': stage.color || '#ef4444',
                        borderColor: isCurrent ? stage.color : undefined,
                        background: isCurrent ? stage.color : undefined,
                        color: isCurrent ? '#fff' : undefined,
                      } as React.CSSProperties}
                      disabled={isDisabled || isCurrent}
                      onClick={() => handleStageChange(stage.name)}
                      title={`Chiudi come ${statusLabel(stage.name)}`}
                    >
                      {statusLabel(stage.name)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ─── SCOPE BANNERS ─── */}
        {holdingContact && (
          <div className="meta-card" style={{ marginBottom: 20 }}>
            <strong>Lista separata: {holdingListLabel(contact)}</strong>
            <span>Questo contatto resta fuori da pipeline, calendario e task del CRM. Quando sincronizzi una reply Gmail, viene promosso automaticamente nel CRM operativo.</span>
          </div>
        )}
        {personalContact && (
          <div className="meta-card" style={{ marginBottom: 20 }}>
            <strong>Sezione personale: {personalSectionLabel(contact)}</strong>
            <span>Questo contatto resta fuori dalla pipeline commerciale ma vive nello stesso CRM.</span>
          </div>
        )}
        {partnerContact && (
          <div className="meta-card" style={{ marginBottom: 20 }}>
            <strong>🤝 Partner</strong>
            <span>Partner tracciato fuori dalla pipeline CRM. Puoi gestire note, promemoria e follow-up dedicati.</span>
          </div>
        )}

        {/* ─── INFO + ACTIVITY GRID ─── */}
        <div className="detail-grid">
          {/* LEFT: Contact info card */}
          <div className="dash-card">
            <div className="dash-card-title">📋 Scheda contatto</div>

            <div className="detail-info-grid">
              <div className="detail-info-col">
                <div className="detail-info-item">
                  <span className="detail-info-label">Email</span>
                  <span className="detail-info-value">{contact.email || '—'}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Telefono</span>
                  <span className="detail-info-value">{contact.phone || '—'}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Azienda</span>
                  <span className="detail-info-value">{contact.company || '—'}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Categoria</span>
                  <span className="detail-info-value">{contact.category || '—'}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Origine</span>
                  <span className="detail-info-value">{sourceLabel(contact.source)}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Area</span>
                  <span className="detail-info-value">{contactScopeLabel(contact.contact_scope)}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Responsabile</span>
                  <span className="detail-info-value">{contact.responsible || '—'}</span>
                </div>
              </div>

              <div className="detail-info-col">
                <div className="detail-info-item">
                  <span className="detail-info-label">Valore deal</span>
                  <span className="detail-info-value" style={{ fontWeight: 700 }}>
                    {contact.value ? `€${Number(contact.value).toLocaleString('it-IT')}` : '—'}
                  </span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Ultimo contatto</span>
                  <span className="detail-info-value">{formatDateTime(contact.last_contact_at)}</span>
                </div>
                <div className="detail-info-item">
                  <span className="detail-info-label">Prossimo follow-up</span>
                  <span className="detail-info-value">{formatDateTime(contact.next_followup_at)}</span>
                </div>
                {contact.list_name && (
                  <div className="detail-info-item">
                    <span className="detail-info-label">Lista import</span>
                    <span className="detail-info-value">{contact.list_name}</span>
                  </div>
                )}
                {contact.country && (
                  <div className="detail-info-item">
                    <span className="detail-info-label">Paese</span>
                    <span className="detail-info-value">{contact.country}</span>
                  </div>
                )}
                {contact.language && (
                  <div className="detail-info-item">
                    <span className="detail-info-label">Lingua</span>
                    <span className="detail-info-value">{contact.language}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Billing info (collapsed by default) */}
            {(contact.billing_address || contact.billing_tax_id || contact.billing_pec) && (
              <details className="detail-collapse" style={{ marginTop: 16 }}>
                <summary className="detail-collapse-summary">🧾 Dati fatturazione</summary>
                <div className="detail-info-grid" style={{ marginTop: 10 }}>
                  <div className="detail-info-col">
                    {contact.billing_address && (
                      <div className="detail-info-item">
                        <span className="detail-info-label">Indirizzo</span>
                        <span className="detail-info-value">{contact.billing_address}</span>
                      </div>
                    )}
                    {contact.billing_city && (
                      <div className="detail-info-item">
                        <span className="detail-info-label">Città</span>
                        <span className="detail-info-value">{contact.billing_city} {contact.billing_zip || ''}</span>
                      </div>
                    )}
                  </div>
                  <div className="detail-info-col">
                    {contact.billing_tax_id && (
                      <div className="detail-info-item">
                        <span className="detail-info-label">P.IVA / CF</span>
                        <span className="detail-info-value">{contact.billing_tax_id}</span>
                      </div>
                    )}
                    {contact.billing_pec && (
                      <div className="detail-info-item">
                        <span className="detail-info-label">PEC</span>
                        <span className="detail-info-value">{contact.billing_pec}</span>
                      </div>
                    )}
                    {contact.billing_sdi && (
                      <div className="detail-info-item">
                        <span className="detail-info-label">SDI</span>
                        <span className="detail-info-value">{contact.billing_sdi}</span>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            )}

            {/* Note */}
            {contact.note && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div className="dash-card-title" style={{ marginBottom: 6 }}>📝 Note</div>
                <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{contact.note}</p>
              </div>
            )}

            {/* Pinned notes */}
            {pinnedNotes.length > 0 && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div className="dash-card-title" style={{ marginBottom: 12 }}>📌 Note in evidenza</div>
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
                            <span className="activity-badge">{String(readActivityMetadata(activity).linked_followup_label)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email engagement */}
            {(contact.email_open_count || contact.email_click_count || contact.email_unsubscribed_at) && (
              <details className="detail-collapse" style={{ marginTop: 16 }}>
                <summary className="detail-collapse-summary">📊 Email engagement</summary>
                <div className="detail-info-grid" style={{ marginTop: 10 }}>
                  <div className="detail-info-col">
                    <div className="detail-info-item">
                      <span className="detail-info-label">Aperture</span>
                      <span className="detail-info-value">{contact.email_open_count || 0}{contact.last_email_open_at ? ` · ultima ${formatDateTime(contact.last_email_open_at)}` : ''}</span>
                    </div>
                  </div>
                  <div className="detail-info-col">
                    <div className="detail-info-item">
                      <span className="detail-info-label">Click</span>
                      <span className="detail-info-value">{contact.email_click_count || 0}{contact.last_email_click_at ? ` · ultimo ${formatDateTime(contact.last_email_click_at)}` : ''}</span>
                    </div>
                  </div>
                </div>
                {contact.email_unsubscribed_at && (
                  <div className="detail-info-item" style={{ color: '#ef4444' }}>
                    <span className="detail-info-label">Disiscritto</span>
                    <span className="detail-info-value">{formatDateTime(contact.email_unsubscribed_at)}{contact.email_unsubscribe_source ? ` (${contact.email_unsubscribe_source})` : ''}</span>
                  </div>
                )}
              </details>
            )}
          </div>

          {/* RIGHT: Register activity */}
          <div className="dash-card">
            <div className="dash-card-title">✍️ Registra attività</div>
            <div className="fg">
              <label className="fl">Tipo</label>
              <select className="fi" value={activityType} onChange={(event) => setActivityType(event.target.value)}>
                {ACTIVITY_TYPES.map((type) => (
                  <option key={type} value={type}>{activityTypeLabel(type)}</option>
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
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  {!holdingContact && (
                    <div className="fg">
                      <label className="fl">Priorità follow-up</label>
                      <select className="fi" value={activityTaskPriority} onChange={(event) => setActivityTaskPriority(event.target.value as 'low' | 'medium' | 'high')}>
                        {TASK_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="toggle-row" style={{ marginBottom: 15 }}>
                  <label className="toggle-chip">
                    <input type="checkbox" checked={activityPinned} onChange={(event) => setActivityPinned(event.target.checked)} />
                    <span>Fissa in alto</span>
                  </label>
                  {!holdingContact && (
                    <label className="toggle-chip">
                      <input type="checkbox" checked={activityActionRequired} onChange={(event) => setActivityActionRequired(event.target.checked)} />
                      <span>Richiede azione</span>
                    </label>
                  )}
                </div>
              </>
            )}
            <div className="fg">
              <label className="fl">Contenuto</label>
              <textarea className="fi" rows={4} value={activityContent} onChange={(event) => setActivityContent(event.target.value)} style={{ resize: 'vertical' }} placeholder="Riassumi cosa è successo e cosa hai concordato" />
            </div>
            {!holdingContact && (
              <>
                <div className="fg">
                  <label className="fl">Prossimo follow-up</label>
                  <input className="fi" type="datetime-local" value={activityFollowup} onChange={(event) => setActivityFollowup(event.target.value)} />
                </div>
                {activityType === 'note' && (
                  <div className="fg">
                    <label className="fl">Label follow-up</label>
                    <input className="fi" value={activityTaskNote} onChange={(event) => setActivityTaskNote(event.target.value)} placeholder="Es. Invia listino aggiornato" />
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
                    type: activityType, content: activityContent,
                    metadata: activityType === 'note' ? { note_kind: activityNoteKind, pinned: activityPinned, action_required: activityActionRequired } : undefined,
                    next_followup_at: holdingContact ? undefined : fromDatetimeLocalValue(activityFollowup),
                    task_type: 'follow-up', task_note: activityTaskNote, task_priority: activityTaskPriority,
                  })
                  setActivityContent(''); setActivityFollowup(''); setActivityPinned(false); setActivityActionRequired(false)
                  setActivityTaskNote(''); setActivityTaskPriority('medium'); setActivityNoteKind('field')
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

        {/* ─── TIMELINE + TASKS ─── */}
        <div className="detail-grid" style={{ marginTop: 20 }}>
          <div className="dash-card">
            <div className="dash-card-title">📜 Timeline attività</div>
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
                          <span className="activity-badge">{noteKindLabel(readActivityMetadata(activity).note_kind)}</span>
                          {isPinnedNote(activity) && <span className="activity-badge">Pinned</span>}
                          {isActionRequiredNote(activity) && <span className="activity-badge activity-badge-warn">Action Required</span>}
                          {Boolean(readActivityMetadata(activity).linked_followup_label) && (
                            <span className="activity-badge">{String(readActivityMetadata(activity).linked_followup_label)}</span>
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
            <div className="dash-card-title">✅ Task & follow-up</div>
            {holdingContact ? (
              <p style={{ color: 'var(--text2)', lineHeight: 1.6, margin: 0 }}>
                Nessun task operativo finché il contatto resta nella lista separata.
              </p>
            ) : (
              <>
                <div className="fg">
                  <label className="fl">Tipo task</label>
                  <select className="fi" value={taskType} onChange={(event) => setTaskType(event.target.value)}>
                    {TASK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
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
                      await addTask(contact.id, { type: taskType, due_date: fromDatetimeLocalValue(taskDate) || '', note: taskNote })
                      setTaskDate(''); setTaskNote('')
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
                            <button className="btn btn-ghost btn-sm" onClick={() => setOutcomeTaskId(task.id)}>Esito chiamata</button>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={async () => { await completeTask(task.id); showToast('Task completato'); await loadDetail(false) }}>Completa</button>
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

        {/* ─── GMAIL ─── */}
        <div className="dash-card" style={{ marginTop: 20 }}>
          <div className="detail-row" style={{ marginBottom: 16 }}>
            <div>
              <div className="dash-card-title" style={{ marginBottom: 4 }}>✉️ Email & Gmail</div>
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
                <Link href="/gmail" className="btn btn-primary btn-sm">Collega Gmail</Link>
              )}
            </div>
          </div>

          {!contact.email ? (
            <p style={{ color: 'var(--text2)' }}>Imposta un'email sul contatto per usare Gmail.</p>
          ) : !detail.gmail.connected ? (
            <p style={{ color: 'var(--text2)' }}>Nessun account Gmail collegato. Vai su <Link href="/gmail">Gmail</Link> per attivare la sincronizzazione.</p>
          ) : (
            <div className="detail-grid" style={{ marginTop: 0 }}>
              <div>
                <div className="fg">
                  <label className="fl">Contesto AI per questa email</label>
                  <textarea className="fi" rows={8} value={gmailDraftNote} onChange={(event) => setGmailDraftNote(event.target.value)}
                    placeholder="Inserisci dettagli utili: cosa è emerso, proposta da fare, tono da usare, materiali da citare, obiezioni o prossima azione concordata"
                    style={{ resize: 'vertical', minHeight: 180 }} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" disabled={gmailDraftNoteSaving}
                      onClick={async () => {
                        try { setGmailDraftNoteSaving(true); await updateContact(contact.id, { email_draft_note: gmailDraftNote }); await loadDetail(false); showToast('Nota bozza salvata') }
                        catch (error) { window.alert(error instanceof Error ? error.message : 'Nota bozza non salvata') }
                        finally { setGmailDraftNoteSaving(false) }
                      }}>{gmailDraftNoteSaving ? 'Salvataggio...' : 'Salva nota'}</button>
                    <button className="btn btn-ghost btn-sm" disabled={gmailDraftGenerating}
                      onClick={async () => {
                        try { setGmailDraftGenerating(true); const result = await apiFetch<{ results: Array<{ error?: string }> }>('/api/ai/generate-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drafts: [{ contact_id: contact.id, note: gmailDraftNote || undefined }] }) }); const err = result.results?.[0]?.error; if (err) throw new Error(err); showToast('Bozza creata in Gmail') }
                        catch (error) { window.alert(error instanceof Error ? error.message : 'Bozza non generata') }
                        finally { setGmailDraftGenerating(false) }
                      }}>{gmailDraftGenerating ? 'Generazione...' : 'Genera bozza AI'}</button>
                  </div>
                </div>
                <div className="fg"><label className="fl">Oggetto</label><input className="fi" value={gmailSubject} onChange={(event) => setGmailSubject(event.target.value)} placeholder="Oggetto email" /></div>
                <div className="fg"><label className="fl">Messaggio</label><textarea className="fi" rows={9} value={gmailBody} onChange={(event) => setGmailBody(event.target.value)} placeholder="Scrivi qui il testo dell'email" style={{ resize: 'vertical', minHeight: 220 }} /></div>
                <div className="fg"><label className="fl">Follow-up dopo email</label><input className="fi" type="datetime-local" value={gmailFollowup} onChange={(event) => setGmailFollowup(event.target.value)} /></div>
                <button className="btn btn-primary" disabled={gmailSending}
                  onClick={async () => {
                    try { setGmailSending(true); const response = await apiFetch<{ auto_followup_draft_created?: boolean }>(`/api/contacts/${contact.id}/emails`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: gmailSubject, body: gmailBody, followup_at: fromDatetimeLocalValue(gmailFollowup) }) }); setGmailSubject(''); setGmailBody(''); setGmailFollowup(''); showToast(response.auto_followup_draft_created ? 'Email inviata con Gmail · bozza follow-up creata' : 'Email inviata con Gmail'); await loadDetail(false) }
                    catch (error) { window.alert(error instanceof Error ? error.message : 'Email non inviata') }
                    finally { setGmailSending(false) }
                  }}>{gmailSending ? 'Invio...' : 'Invia email'}</button>
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
                            <div className="email-meta">{email.direction === 'outbound' ? 'Inviata' : 'Ricevuta'} · {formatDateTime(email.sent_at)}</div>
                          </div>
                          <div className={`email-direction ${email.direction}`}>{email.direction === 'outbound' ? 'Uscita' : 'Ingresso'}</div>
                        </div>
                        <div className="email-recipient-row"><strong>Da:</strong> {email.from_email || 'Non disponibile'}</div>
                        <div className="email-recipient-row"><strong>A:</strong> {email.to_emails.join(', ') || 'Non disponibile'}</div>
                        {email.cc_emails.length > 0 && <div className="email-recipient-row"><strong>Cc:</strong> {email.cc_emails.join(', ')}</div>}
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

      <ContactModal open={editOpen} title="Modifica contatto" stages={stages} teamMembers={teamMembers} initialContact={contact}
        onClose={() => setEditOpen(false)}
        onSave={async (payload) => { await updateContact(contact.id, payload); showToast('Contatto aggiornato'); await loadDetail(false) }}
        onDelete={async () => { await deleteContact(contact.id); window.location.href = '/contacts' }} />

      <CallOutcomeModal open={!!outcomeTaskId} contact={contact} task={tasks.find((task) => task.id === outcomeTaskId) || null} stages={stages}
        onClose={() => setOutcomeTaskId(null)}
        onSave={async (payload) => {
          const task = tasks.find((item) => item.id === outcomeTaskId)
          if (!task) return
          await completeTask(task.id, { refresh: false })
          if (payload.status !== contact.status || isClosedStatus(payload.status)) {
            await updateContact(contact.id, { status: payload.status, next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at }, { refresh: false })
          }
          await addActivity(contact.id, { type: 'call', content: payload.content, next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at, task_type: payload.task_type }, { refresh: false })
          await refresh(); await loadDetail(false)
          showToast('Chiamata registrata e follow-up aggiornato')
          setOutcomeTaskId(null)
        }} />
    </>
  )
}
