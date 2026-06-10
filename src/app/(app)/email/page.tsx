'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

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
  note?: string | null
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

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function urgencyLabel(nextFollowupAt?: string | null): { label: string; className: string } | null {
  if (!nextFollowupAt) return null
  const now = Date.now()
  const due = new Date(nextFollowupAt).getTime()
  if (due < now) return { label: 'Scaduto', className: 'urgency-overdue' }
  const diffDays = Math.ceil((due - now) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return { label: 'Oggi', className: 'urgency-today' }
  if (diffDays === 1) return { label: 'Domani', className: 'urgency-tomorrow' }
  return { label: `+${diffDays}gg`, className: 'urgency-later' }
}

function scoreBadge(score: number | null | undefined): string {
  if (score == null) return ''
  if (score >= 80) return '🔥'
  if (score >= 60) return '⭐'
  return ''
}

export default function EmailPage() {
  const { showToast, refresh } = useCRMContext()
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
  const [sent, setSent] = useState<EmailDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'sent'>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [regenerateNotes, setRegenerateNotes] = useState<Record<string, string>>({})

  const loadData = useCallback(async () => {
    try {
      const [pendingRes, sentRes] = await Promise.all([
        apiFetch<{ drafts: EmailDraft[] }>('/api/automation/drafts?status=pending'),
        apiFetch<{ drafts: EmailDraft[] }>('/api/automation/drafts?status=sent'),
      ])
      setDrafts(pendingRes.drafts || [])
      setSent(sentRes.drafts || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  function setBusy(id: string) {
    setBusyIds((prev) => new Set(prev).add(id))
  }
  function clearBusy(id: string) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleSend(draft: EmailDraft) {
    setBusy(draft.id)
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
      clearBusy(draft.id)
    }
  }

  async function handleDismiss(draft: EmailDraft) {
    setBusy(draft.id)
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
      clearBusy(draft.id)
    }
  }

  async function handleRegenerate(draft: EmailDraft) {
    setBusy(draft.id)
    try {
      const note = regenerateNotes[draft.id]?.trim() || undefined
      const result = await apiFetch<{ draft: EmailDraft; regenerated: boolean }>(
        '/api/automation/regenerate-draft',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_id: draft.id, note }),
        }
      )
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, ...result.draft } : d))
      )
      setRegenerateNotes((prev) => {
        const next = { ...prev }
        delete next[draft.id]
        return next
      })
      showToast(`Bozza rigenerata per ${draft.contact?.name || 'contatto'}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rigenerazione fallita')
    } finally {
      clearBusy(draft.id)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>✉️ Email</h1>
        </div>
        <p className="oggi-muted">Caricamento...</p>
      </div>
    )
  }

  const tabItems = drafts.filter((d) => d.status === 'pending')
  const tabSent = sent.filter((d) => d.status === 'sent')

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>✉️ Email</h1>
          <p className="page-subtitle">
            Gestisci le bozze generate dall&apos;AI, invia o rigenera.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/impostazioni/email-ai" className="btn btn-ghost btn-sm">
            ⚙️ Configura AI
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{
            borderBottom: tab === 'pending' ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: 0,
            fontWeight: tab === 'pending' ? 600 : 400,
            color: tab === 'pending' ? 'var(--accent)' : 'var(--text2)',
            padding: '8px 16px',
          }}
          onClick={() => setTab('pending')}
        >
          📝 Da inviare ({tabItems.length})
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{
            borderBottom: tab === 'sent' ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: 0,
            fontWeight: tab === 'sent' ? 600 : 400,
            color: tab === 'sent' ? 'var(--accent)' : 'var(--text2)',
            padding: '8px 16px',
          }}
          onClick={() => setTab('sent')}
        >
          ✅ Inviate ({tabSent.length})
        </button>
      </div>

      {/* Pending tab */}
      {tab === 'pending' && (
        <>
          {tabItems.length === 0 ? (
            <div className="oggi-card" style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 48, marginBottom: 8 }}>📭</p>
              <p className="oggi-muted">
                Nessuna bozza in attesa. Le bozze vengono generate automaticamente ogni mattina
                per i contatti in scadenza, oppure puoi generarle manualmente dalla dashboard.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tabItems.map((draft) => {
                const urgency = urgencyLabel(draft.contact?.next_followup_at)
                const badge = scoreBadge(draft.contact?.score)
                const isExpanded = expandedId === draft.id
                const isBusy = busyIds.has(draft.id)

                return (
                  <div
                    key={draft.id}
                    className="oggi-card"
                    style={{ padding: 16 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          {badge && <span>{badge}</span>}
                          <strong style={{ fontSize: 15 }}>{draft.contact?.name || 'Sconosciuto'}</strong>
                          {draft.contact?.company && (
                            <span style={{ color: 'var(--text2)', fontSize: 13 }}>{draft.contact.company}</span>
                          )}
                          {urgency && (
                            <span className={`oggi-email-inbox-urgency ${urgency.className}`} style={{ fontSize: 11 }}>
                              {urgency.label}
                            </span>
                          )}
                          {draft.source === 'auto' && (
                            <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>auto</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                          {draft.subject || '(nessun oggetto)'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                          {draft.contact?.email} · {formatDate(draft.created_at)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
                          onClick={() => handleRegenerate(draft)}
                          disabled={isBusy}
                          title="Rigenera con AI"
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDismiss(draft)}
                          disabled={isBusy}
                          title="Archivia"
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
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                        <div
                          className="oggi-email-inbox-body"
                          style={{ marginBottom: 12, maxHeight: 400, overflowY: 'auto', padding: 12, background: 'var(--surface2)', borderRadius: 8, fontSize: 14, lineHeight: 1.6 }}
                          dangerouslySetInnerHTML={{
                            __html: draft.body_html || draft.body_text?.replace(/\n/g, '<br>') || '',
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <textarea
                            className="form-input"
                            placeholder="Contesto aggiuntivo per rigenerare questa email..."
                            value={regenerateNotes[draft.id] || ''}
                            onChange={(e) =>
                              setRegenerateNotes((prev) => ({ ...prev, [draft.id]: e.target.value }))
                            }
                            rows={2}
                            style={{ flex: 1, fontSize: 13, resize: 'vertical' }}
                            disabled={isBusy}
                          />
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRegenerate(draft)}
                            disabled={isBusy}
                            style={{ flexShrink: 0 }}
                          >
                            {isBusy ? '⏳' : '🔄 Rigenera'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Sent tab */}
      {tab === 'sent' && (
        <>
          {tabSent.length === 0 ? (
            <div className="oggi-card" style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 48, marginBottom: 8 }}>📬</p>
              <p className="oggi-muted">Nessuna email inviata tramite questo sistema.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tabSent.slice(0, 50).map((draft) => {
                const isExpanded = expandedId === draft.id
                return (
                  <div
                    key={draft.id}
                    className="oggi-card"
                    style={{ padding: 12, opacity: 0.8 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>✅</span>
                          <strong style={{ fontSize: 14 }}>{draft.contact?.name || 'Sconosciuto'}</strong>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                            {formatDate(draft.sent_at)}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                          {draft.subject || '(nessun oggetto)'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      >
                        👁
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <div
                          className="oggi-email-inbox-body"
                          style={{ maxHeight: 300, overflowY: 'auto', padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 13 }}
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
          )}
        </>
      )}
    </div>
  )
}
