'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  activityTypeLabel,
  formatDateTime,
  holdingListLabel,
  isHoldingContact,
  isPersonalContact,
  personalSectionLabel,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
  statusLabel,
} from '@/lib/data'
import type { Activity, ContactDetail } from '@/types'
import { useCRMContext } from '@/app/(app)/layout'

interface ContactDrawerProps {
  contactId: string | null
  onClose: () => void
  onEdit?: (id: string) => void
}

function toInputDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(10, 0, 0, 0)
  return date.toISOString().slice(0, 16)
}

export function ContactDrawer({ contactId, onClose, onEdit }: ContactDrawerProps) {
  const { loadContactDetail, addActivity, addTask, updateContact, teamMembers, showToast } = useCRMContext()
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [followupDate, setFollowupDate] = useState('')
  const [followupSaving, setFollowupSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [draftNoteSaving, setDraftNoteSaving] = useState(false)
  const [draftGenerating, setDraftGenerating] = useState(false)

  useEffect(() => {
    if (!contactId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    loadContactDetail(contactId)
      .then((data) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contactId, loadContactDetail])

  useEffect(() => {
    if (!contactId) return
    function handleEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [contactId, onClose])

  useEffect(() => {
    setDraftNote(detail?.contact.email_draft_note || '')
  }, [detail?.contact.email_draft_note])

  if (!contactId) return null

  const contact = detail?.contact || null
  const activities = (detail?.activities || []).slice(0, 6)

  async function saveNote() {
    if (!contactId || !noteText.trim()) return
    setNoteSaving(true)
    try {
      await addActivity(contactId, {
        type: 'note',
        content: noteText.trim(),
        metadata: { kind: 'field' },
      })
      setNoteText('')
      showToast('Nota salvata')
      const refreshed = await loadContactDetail(contactId)
      setDetail(refreshed)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'salvataggio nota'}`)
    } finally {
      setNoteSaving(false)
    }
  }

  async function schedule(days: number) {
    if (!contactId) return
    const due = toInputDate(days)
    setFollowupDate(due)
    setFollowupSaving(true)
    try {
      await addTask(contactId, {
        type: 'follow-up',
        due_date: due,
        priority: 'medium',
      })
      showToast(`Follow-up pianificato fra ${days}gg`)
      const refreshed = await loadContactDetail(contactId)
      setDetail(refreshed)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'pianificazione'}`)
    } finally {
      setFollowupSaving(false)
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="drawer-title-block">
            {contact ? (
              <>
                <h2 className="drawer-name">{contact.name}</h2>
                <div className="drawer-sub">
                  {contact.company || 'Nessuna azienda'}
                </div>
              </>
            ) : (
              <h2 className="drawer-name">{loading ? 'Caricamento…' : 'Contatto'}</h2>
            )}
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </div>

        {contact && (
          <>
            <div className="drawer-badges">
              <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
              <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
              {isHoldingContact(contact) && (
                <span className="ctag ctag-event">📁 {holdingListLabel(contact)}</span>
              )}
              {isPersonalContact(contact) && (
                <span className="ctag ctag-event">🗂️ {personalSectionLabel(contact)}</span>
              )}
              {contact.source && <span className="ctag ctag-referenziato">{sourceLabel(contact.source)}</span>}
              {contact.event_tag && <span className="ctag ctag-event">#{contact.event_tag}</span>}
            </div>

            <div className="drawer-section">
              <div className="drawer-kv">
                <span>Email</span>
                <strong>{contact.email || '—'}</strong>
              </div>
              <div className="drawer-kv">
                <span>Telefono</span>
                <strong>
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  ) : (
                    '—'
                  )}
                </strong>
              </div>
              <div className="drawer-kv">
                <span>Ultimo contatto</span>
                <strong>{formatDateTime(contact.last_contact_at) || 'Mai'}</strong>
              </div>
              <div className="drawer-kv">
                <span>Prossimo follow-up</span>
                <strong>{formatDateTime(contact.next_followup_at) || 'Non pianificato'}</strong>
              </div>
            </div>

            <div className="drawer-section">
              <div className="drawer-section-label">Assegnato a</div>
              <div className="drawer-assignee-row">
                <select
                  className="drawer-assignee-select"
                  value={contact.responsible || ''}
                  disabled={assigning}
                  onChange={async (event) => {
                    const value = event.target.value
                    setAssigning(true)
                    try {
                      await updateContact(contact.id, { responsible: value || '' })
                      const refreshed = await loadContactDetail(contact.id)
                      setDetail(refreshed)
                      showToast(value ? `Assegnato a ${value}` : 'Assegnazione rimossa')
                    } catch (error) {
                      showToast(`Errore: ${error instanceof Error ? error.message : 'assegnazione'}`)
                    } finally {
                      setAssigning(false)
                    }
                  }}
                >
                  <option value="">— Non assegnato —</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.name}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <Link
                  href="/impostazioni/team"
                  className="btn btn-ghost btn-sm"
                  title="Gestisci team"
                >
                  ⚙️
                </Link>
              </div>
              {teamMembers.length === 0 && (
                <div className="drawer-hint">
                  <Link href="/impostazioni/team">Aggiungi un collaboratore →</Link>
                </div>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-section-label">Ricontatta fra</div>
              <div className="drawer-quick-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={followupSaving}
                  onClick={() => schedule(0)}
                >
                  Oggi
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={followupSaving}
                  onClick={() => schedule(1)}
                >
                  Domani
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={followupSaving}
                  onClick={() => schedule(3)}
                >
                  3 giorni
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={followupSaving}
                  onClick={() => schedule(7)}
                >
                  1 settimana
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={followupSaving}
                  onClick={() => schedule(14)}
                >
                  2 settimane
                </button>
              </div>
              {followupDate && (
                <div className="drawer-hint">Pianificato: {formatDateTime(followupDate)}</div>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-section-label">Aggiungi nota</div>
              <textarea
                className="drawer-textarea"
                rows={3}
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Cosa ti ha detto? Cosa ricordare…"
              />
              <div className="drawer-actions-row">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!noteText.trim() || noteSaving}
                  onClick={saveNote}
                >
                  {noteSaving ? 'Salvataggio…' : 'Salva nota'}
                </button>
              </div>
            </div>

            {contact.email && (
              <div className="drawer-section">
                <div className="drawer-section-label">Genera bozza email</div>
                <input
                  type="text"
                  className="form-input"
                  style={{ fontSize: 13, marginBottom: 8 }}
                  placeholder="Nota salvata per le bozze email"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                />
                <div className="drawer-actions-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={draftNoteSaving || !contact}
                    onClick={async () => {
                      if (!contact) return
                      setDraftNoteSaving(true)
                      try {
                        await updateContact(contact.id, { email_draft_note: draftNote })
                        const refreshed = await loadContactDetail(contact.id)
                        setDetail(refreshed)
                        showToast('Nota bozza salvata')
                      } catch (error) {
                        showToast(`Errore: ${error instanceof Error ? error.message : 'salvataggio nota bozza'}`)
                      } finally {
                        setDraftNoteSaving(false)
                      }
                    }}
                  >
                    {draftNoteSaving ? 'Salvataggio…' : 'Salva nota'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={draftGenerating}
                    onClick={async () => {
                      if (!contactId) return
                      setDraftGenerating(true)
                      try {
                        const result = await apiFetch<{ results: Array<{ error?: string }> }>('/api/ai/generate-drafts', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            drafts: [{ contact_id: contactId, note: draftNote || undefined }],
                          }),
                        })
                        const err = result.results?.[0]?.error
                        if (err) showToast(`Errore: ${err}`)
                        else {
                          setDraftNote('')
                          showToast('Bozza creata in Gmail')
                        }
                      } catch {
                        showToast('Errore nella generazione bozza')
                      } finally {
                        setDraftGenerating(false)
                      }
                    }}
                  >
                    {draftGenerating ? 'Generazione…' : 'Crea bozza in Gmail'}
                  </button>
                </div>
              </div>
            )}

            {activities.length > 0 && (
              <div className="drawer-section">
                <div className="drawer-section-label">Attività recenti</div>
                <ul className="drawer-activity">
                  {activities.map((activity: Activity) => (
                    <li key={activity.id}>
                      <span className="drawer-activity-type">{activityTypeLabel(activity.type)}</span>
                      <span className="drawer-activity-content">
                        {activity.content || '—'}
                      </span>
                      <span className="drawer-activity-date">
                        {formatDateTime(activity.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="drawer-footer">
              {onEdit && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onEdit(contact.id)}
                >
                  Modifica
                </button>
              )}
              <Link href={`/contacts/${contact.id}`} className="btn btn-primary btn-sm">
                Apri scheda completa →
              </Link>
            </div>
          </>
        )}

        {loading && !contact && <div className="drawer-loading">Caricamento…</div>}
        {!loading && !contact && <div className="drawer-loading">Contatto non trovato.</div>}
      </aside>
    </>
  )
}
