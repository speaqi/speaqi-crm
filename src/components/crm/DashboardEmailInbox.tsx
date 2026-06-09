'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

type EmailDraft = {
  id: string
  contact_id: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  gmail_draft_id: string | null
  status: string
  source: string
  created_at: string
  sent_at: string | null
  contact?: {
    id: string
    name: string
    email: string | null
    company: string | null
    status: string
    score: number | null
    priority: number
    next_followup_at: string | null
  }
}

interface Props {
  showToast: (message: string) => void
  refresh: () => void
}

export function DashboardEmailInbox({ showToast, refresh }: Props) {
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadDrafts = useCallback(async () => {
    try {
      const data = await apiFetch<{ drafts: EmailDraft[] }>('/api/automation/drafts')
      setDrafts(data.drafts || [])
    } catch {
      // silently fail — component shows empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  async function handleSend(draft: EmailDraft) {
    if (sending[draft.id]) return
    setSending((prev) => ({ ...prev, [draft.id]: true }))

    try {
      await apiFetch('/api/automation/send-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id, mode: 'send' }),
      })
      showToast(`Email inviata a ${draft.contact?.name || 'contatto'}`)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
      refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invio fallito')
    } finally {
      setSending((prev) => ({ ...prev, [draft.id]: false }))
    }
  }

  async function handleDismiss(draft: EmailDraft) {
    if (sending[draft.id]) return
    setSending((prev) => ({ ...prev, [draft.id]: true }))

    try {
      await apiFetch('/api/automation/send-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id, mode: 'dismiss' }),
      })
      showToast(`Bozza archiviata per ${draft.contact?.name || 'contatto'}`)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Errore')
    } finally {
      setSending((prev) => ({ ...prev, [draft.id]: false }))
    }
  }

  function urgency(draft: EmailDraft): { label: string; className: string } {
    const followup = draft.contact?.next_followup_at
    if (!followup) return { label: '', className: '' }
    const now = Date.now()
    const due = new Date(followup).getTime()
    if (due < now) return { label: 'Scaduto', className: 'urgency-overdue' }
    const diffDays = Math.ceil((due - now) / (24 * 60 * 60 * 1000))
    if (diffDays === 0) return { label: 'Oggi', className: 'urgency-today' }
    if (diffDays === 1) return { label: 'Domani', className: 'urgency-tomorrow' }
    return { label: `+${diffDays}gg`, className: 'urgency-later' }
  }

  function scoreBadge(score: number | null | undefined): string | null {
    if (score == null) return null
    if (score >= 80) return '🔥'
    if (score >= 60) return '⭐'
    return null
  }

  if (loading) {
    return (
      <section className="oggi-email-draft">
        <div className="oggi-email-draft-head">
          <h2>✉️ Email da inviare</h2>
        </div>
        <p className="oggi-muted">Caricamento bozze...</p>
      </section>
    )
  }

  if (!drafts.length) {
    return (
      <section className="oggi-email-draft">
        <div className="oggi-email-draft-head">
          <h2>✉️ Email da inviare</h2>
          <span className="oggi-email-draft-count">0</span>
        </div>
        <p className="oggi-muted">Nessuna bozza in attesa di invio.</p>
      </section>
    )
  }

  return (
    <section className="oggi-email-draft">
      <div className="oggi-email-draft-head">
        <h2>✉️ Email da inviare</h2>
        <span className="oggi-email-draft-count">{drafts.length}</span>
      </div>

      <div className="oggi-email-inbox-list">
        {drafts.map((draft) => {
          const urgencyInfo = urgency(draft)
          const badge = scoreBadge(draft.contact?.score)
          const isExpanded = expandedId === draft.id
          const isBusy = sending[draft.id]

          return (
            <div
              key={draft.id}
              className={`oggi-email-inbox-row ${urgencyInfo.className} ${isExpanded ? 'expanded' : ''}`}
            >
              <div className="oggi-email-inbox-main">
                <div className="oggi-email-inbox-info">
                  <div className="oggi-email-inbox-name-row">
                    {badge && <span className="oggi-email-inbox-badge">{badge}</span>}
                    <strong className="oggi-email-draft-name">{draft.contact?.name || 'Sconosciuto'}</strong>
                    {draft.contact?.company && (
                      <span className="oggi-email-draft-company">{draft.contact.company}</span>
                    )}
                    {urgencyInfo.label && (
                      <span className={`oggi-email-inbox-urgency ${urgencyInfo.className}`}>
                        {urgencyInfo.label}
                      </span>
                    )}
                  </div>
                  <span className="oggi-email-inbox-subject">
                    {draft.subject || '(nessun oggetto)'}
                  </span>
                  <span className="oggi-email-draft-addr">{draft.contact?.email || ''}</span>
                </div>

                <div className="oggi-email-inbox-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                    title="Anteprima"
                  >
                    👁
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleDismiss(draft)}
                    disabled={isBusy}
                    title="Ignora"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSend(draft)}
                    disabled={isBusy}
                  >
                    {isBusy ? '...' : 'Invia'}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="oggi-email-inbox-preview">
                  <div
                    className="oggi-email-inbox-body"
                    dangerouslySetInnerHTML={{
                      __html: draft.body_html || draft.body_text?.replace(/\n/g, '<br>') || '',
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
