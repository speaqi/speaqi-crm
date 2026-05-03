'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '@/app/(app)/layout'
import { apiFetch } from '@/lib/api'
import { formatDateTime, priorityBadgeClass, priorityLabel, sourceLabel, statusLabel } from '@/lib/data'
import type { CRMContact, MarketingStatus } from '@/types'

type MarketingBucket = 'prepare' | 'drafted' | 'ready' | 'followup' | 'blocked' | 'unsubscribed'

type MarketingQueueItem = {
  contact: CRMContact
  bucket: MarketingBucket
  effective_status: MarketingStatus
  reason: string
  score: number
  blocked_reason: string | null
  followup_due: boolean
  paused: boolean
}

type QueueResponse = {
  items: MarketingQueueItem[]
  counts: Record<MarketingBucket, number>
}

const BUCKETS: Array<{ key: MarketingBucket; label: string; description: string }> = [
  { key: 'prepare', label: 'Da preparare', description: 'Contatti con email pronti per bozza.' },
  { key: 'drafted', label: 'Bozza creata', description: 'Draft Gmail da controllare.' },
  { key: 'ready', label: 'Da inviare', description: 'Bozze revisionate e pronte.' },
  { key: 'followup', label: 'In follow-up', description: 'Email inviate o follow-up dovuti.' },
  { key: 'blocked', label: 'Bloccati', description: 'Senza email o in pausa.' },
  { key: 'unsubscribed', label: 'Disiscritti', description: 'Esclusi da nuove email.' },
]

const EMPTY_COUNTS: Record<MarketingBucket, number> = {
  prepare: 0,
  drafted: 0,
  ready: 0,
  followup: 0,
  blocked: 0,
  unsubscribed: 0,
}

function tomorrowAt(hour: number) {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function inSevenDaysAt(hour: number) {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function statusLabelMarketing(status: MarketingStatus) {
  switch (status) {
    case 'ready_to_draft':
      return 'Pronto bozza'
    case 'draft_created':
      return 'Bozza creata'
    case 'ready_to_send':
      return 'Da inviare'
    case 'sent':
      return 'Inviata'
    case 'followup_due':
      return 'Follow-up'
    case 'paused':
      return 'Pausa'
    case 'unsubscribed':
      return 'Disiscritto'
    case 'not_ready':
    default:
      return 'Non pronto'
  }
}

function hasEmail(contact: CRMContact) {
  return Boolean(String(contact.email || '').trim())
}

export default function MarketingPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [items, setItems] = useState<MarketingQueueItem[]>([])
  const [counts, setCounts] = useState<Record<MarketingBucket, number>>(EMPTY_COUNTS)
  const [activeBucket, setActiveBucket] = useState<MarketingBucket>('prepare')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  async function loadQueue() {
    setLoading(true)
    setError(null)
    try {
      const query = isAdmin ? '?workspace=all' : ''
      const response = await apiFetch<QueueResponse>(`/api/marketing/queue${query}`)
      setItems(response.items || [])
      setCounts({ ...EMPTY_COUNTS, ...(response.counts || {}) })
      setNotes((previous) => {
        const next = { ...previous }
        for (const item of response.items || []) {
          const id = item.contact.id
          if (!(id in next)) next[id] = item.contact.email_draft_note || ''
        }
        return next
      })
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : 'Marketing queue non caricata')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadQueue()
  }, [isAdmin])

  const visibleItems = useMemo(
    () => items.filter((item) => item.bucket === activeBucket),
    [activeBucket, items]
  )

  async function updateMarketing(contactId: string, payload: Record<string, unknown>, toast: string) {
    setBusyId(contactId)
    try {
      await apiFetch(`/api/marketing/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      showToast(toast)
      await loadQueue()
    } catch (updateError) {
      window.alert(updateError instanceof Error ? updateError.message : 'Aggiornamento non riuscito')
    } finally {
      setBusyId(null)
    }
  }

  async function generateDraft(item: MarketingQueueItem) {
    const contact = item.contact
    if (!hasEmail(contact) || contact.email_unsubscribed_at) return

    setBusyId(contact.id)
    try {
      const response = await apiFetch<{
        created: number
        failed: number
        results: Array<{ contact_id: string; draft_id?: string; error?: string }>
      }>('/api/ai/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: [
            {
              contact_id: contact.id,
              note: notes[contact.id]?.trim() || undefined,
            },
          ],
        }),
      })

      const result = response.results?.[0]
      if (!result?.draft_id) {
        window.alert(result?.error || 'Bozza non generata')
        return
      }

      await apiFetch(`/api/marketing/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketing_status: 'draft_created',
          email_draft_note: notes[contact.id]?.trim() || undefined,
        }),
      })
      showToast('Bozza Gmail creata')
      await loadQueue()
    } catch (draftError) {
      window.alert(draftError instanceof Error ? draftError.message : 'Bozza non generata')
    } finally {
      setBusyId(null)
    }
  }

  async function createCallTask(item: MarketingQueueItem) {
    const contact = item.contact
    setBusyId(contact.id)
    try {
      await apiFetch(`/api/contacts/${contact.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'call',
          action: 'call',
          due_date: tomorrowAt(10),
          priority: Number(contact.priority || 0) >= 3 ? 'high' : 'medium',
          note: 'Task creato dalla Marketing Inbox',
        }),
      })
      await apiFetch(`/api/marketing/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketing_status: 'followup_due' }),
      })
      showToast('Task chiamata creato')
      await loadQueue()
    } catch (taskError) {
      window.alert(taskError instanceof Error ? taskError.message : 'Task non creato')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="dash-content marketing-page">
      <div className="marketing-header">
        <div>
          <div className="marketing-kicker">Marketing Inbox</div>
          <h1>Coda email e follow-up</h1>
          <p>
            Trasforma contatti aperti, bozze AI e segnali email in una lista giornaliera di azioni.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => void loadQueue()} disabled={loading}>
          {loading ? 'Aggiorno...' : 'Aggiorna'}
        </button>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="marketing-tabs" role="tablist" aria-label="Filtri marketing">
        {BUCKETS.map((bucket) => (
          <button
            key={bucket.key}
            type="button"
            className={`marketing-tab ${activeBucket === bucket.key ? 'active' : ''}`}
            onClick={() => setActiveBucket(bucket.key)}
            aria-pressed={activeBucket === bucket.key}
          >
            <span>{bucket.label}</span>
            <strong>{counts[bucket.key] || 0}</strong>
          </button>
        ))}
      </div>

      <div className="marketing-layout">
        <section className="marketing-list" aria-live="polite">
          <div className="marketing-list-head">
            <div>
              <strong>{BUCKETS.find((bucket) => bucket.key === activeBucket)?.label}</strong>
              <span>{BUCKETS.find((bucket) => bucket.key === activeBucket)?.description}</span>
            </div>
            <span>{visibleItems.length} contatti</span>
          </div>

          {loading ? (
            <div className="dash-card">Caricamento coda marketing...</div>
          ) : visibleItems.length === 0 ? (
            <div className="marketing-empty">
              <strong>Nessun contatto in questa vista.</strong>
              <span>La coda si aggiorna dai follow-up, dalle bozze e dai segnali email disponibili.</span>
            </div>
          ) : (
            visibleItems.map((item) => {
              const contact = item.contact
              const busy = busyId === contact.id
              const note = notes[contact.id] ?? ''
              const canDraft = hasEmail(contact) && !contact.email_unsubscribed_at && activeBucket !== 'unsubscribed'

              return (
                <article key={contact.id} className={`marketing-row marketing-row-${item.bucket}`}>
                  <div className="marketing-row-main">
                    <div className="marketing-row-title">
                      <Link href={`/contacts/${contact.id}`}>{contact.name}</Link>
                      {contact.company && <span>{contact.company}</span>}
                    </div>
                    <div className="marketing-meta">
                      <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                      <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>
                        {priorityLabel(contact.priority)}
                      </span>
                      <span className="ctag ctag-referenziato">{sourceLabel(contact.source)}</span>
                      {contact.responsible && (
                        <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                          {contact.responsible}
                        </span>
                      )}
                      <span className="ctag ctag-event">{statusLabelMarketing(item.effective_status)}</span>
                    </div>
                    <p className="marketing-reason">{item.reason}</p>
                    <div className="marketing-details">
                      <span>Email: {contact.email || 'mancante'}</span>
                      <span>Follow-up: {formatDateTime(contact.next_followup_at)}</span>
                      {(contact.email_open_count || contact.email_click_count) && (
                        <span>
                          Engagement: {contact.email_open_count || 0} aperture · {contact.email_click_count || 0} click
                        </span>
                      )}
                    </div>
                    {canDraft && (
                      <textarea
                        className="marketing-note"
                        placeholder="Nota per la prossima bozza..."
                        value={note}
                        rows={2}
                        disabled={busy}
                        onChange={(event) =>
                          setNotes((previous) => ({ ...previous, [contact.id]: event.target.value }))
                        }
                        onBlur={() => {
                          const trimmed = note.trim()
                          if (trimmed !== String(contact.email_draft_note || '').trim()) {
                            void updateMarketing(
                              contact.id,
                              { email_draft_note: trimmed || null },
                              'Nota marketing salvata'
                            )
                          }
                        }}
                      />
                    )}
                  </div>

                  <div className="marketing-actions">
                    {canDraft && (
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void generateDraft(item)}>
                        Genera bozza
                      </button>
                    )}
                    {item.bucket === 'drafted' && (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void updateMarketing(contact.id, { marketing_status: 'ready_to_send' }, 'Bozza segnata pronta')
                        }
                      >
                        Segna pronta
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void updateMarketing(
                          contact.id,
                          { marketing_status: 'paused', marketing_paused_until: inSevenDaysAt(9) },
                          'Contatto in pausa per 7 giorni'
                        )
                      }
                    >
                      Pausa
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void updateMarketing(
                          contact.id,
                          { next_followup_at: tomorrowAt(10), marketing_status: 'followup_due' },
                          'Follow-up spostato a domani'
                        )
                      }
                    >
                      Domani
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void createCallTask(item)}>
                      Task chiamata
                    </button>
                    <Link className="btn btn-ghost btn-sm" href={`/contacts/${contact.id}`}>
                      Scheda
                    </Link>
                  </div>
                </article>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}
