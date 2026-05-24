'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { apiFetch } from '@/lib/api'
import { SOURCE_OPTIONS, formatDateTime, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact, OperatingQueueItem, OperatingQueueMode, TaskWithContact } from '@/types'

type QueueResponse = {
  mode: OperatingQueueMode
  items: OperatingQueueItem[]
  total: number
}

const MODE_LABELS: Record<OperatingQueueMode, string> = {
  calls: 'Da chiamare',
  overdue: 'Follow-up scaduti',
  quotes: 'Preventivi da recuperare',
  all: 'Tutto',
}

function actionLabel(action: OperatingQueueItem['recommended_action']) {
  switch (action) {
    case 'call':
      return 'Chiama'
    case 'send_email':
      return 'Email'
    case 'recover_quote':
      return 'Recupera preventivo'
    case 'schedule_followup':
      return 'Pianifica'
    default:
      return 'Rivedi'
  }
}

function scoreClass(score: number) {
  if (score >= 120) return 'oc-score oc-score-hot'
  if (score >= 80) return 'oc-score oc-score-warm'
  return 'oc-score'
}

function formatMoney(value?: number | null) {
  if (!value) return ''
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function tomorrowAtTen() {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(10, 0, 0, 0)
  return next.toISOString()
}

function taskForModal(item: OperatingQueueItem | null): TaskWithContact | null {
  if (!item?.task) return null
  return {
    ...item.task,
    status: item.task.status as TaskWithContact['status'],
    contact: {
      id: item.contact.id,
      name: item.contact.name,
      status: item.contact.status,
      source: item.contact.source,
      category: item.contact.category,
      company: item.contact.company,
      phone: item.contact.phone,
      responsible: item.contact.responsible,
      event_tag: item.contact.event_tag,
      last_activity_summary: item.contact.last_activity_summary,
      contact_scope: item.contact.contact_scope,
      personal_section: item.contact.personal_section,
      priority: item.contact.priority,
      next_followup_at: item.contact.next_followup_at,
    },
  }
}

export default function OperativoPage() {
  const { stages, teamMembers, isAdmin, refresh, showToast } = useCRMContext()
  const [mode, setMode] = useState<OperatingQueueMode>('calls')
  const [agent, setAgent] = useState('')
  const [source, setSource] = useState('')
  const [category, setCategory] = useState('')
  const [queue, setQueue] = useState<QueueResponse>({ mode: 'calls', items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [outcomeItem, setOutcomeItem] = useState<OperatingQueueItem | null>(null)
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set())

  const visibleItems = useMemo(
    () => queue.items.filter((item) => !skippedIds.has(item.contact.id)),
    [queue.items, skippedIds]
  )

  const totals = useMemo(() => {
    const quoteValue = visibleItems.reduce((sum, item) => sum + Number(item.quote?.total_amount || 0), 0)
    return {
      hot: visibleItems.filter((item) => item.rank_score >= 100).length,
      overdue: visibleItems.filter((item) => item.rank_reasons.some((reason) => reason.toLowerCase().includes('scad'))).length,
      quoteValue,
    }
  }, [visibleItems])

  const loadQueue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ mode, limit: '100' })
      if (agent) params.set('agent', agent)
      if (source) params.set('source', source)
      if (category) params.set('category', category)
      const response = await apiFetch<QueueResponse>(`/api/operating-center/queue?${params.toString()}`)
      setQueue(response)
      setSkippedIds(new Set())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare il centro operativo')
    } finally {
      setLoading(false)
    }
  }, [agent, category, mode, source])

  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  async function createFastFollowup(item: OperatingQueueItem) {
    await apiFetch(`/api/contacts/${item.contact.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'call',
        action: 'call',
        due_date: tomorrowAtTen(),
        priority: item.rank_score >= 100 ? 'high' : 'medium',
        note: 'Follow-up creato dal Centro Operativo',
        idempotency_key: `operating-center:${item.contact.id}:${new Date().toISOString().slice(0, 10)}`,
      }),
    })
    await refresh()
    await loadQueue()
    showToast('Follow-up creato')
  }

  async function saveOutcome(payload: {
    status: string
    content: string
    next_followup_at: string | null
    task_type: string
  }) {
    if (!outcomeItem) return
    await apiFetch(`/api/contacts/${outcomeItem.contact.id}/call-outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        task_id: outcomeItem.task?.id || null,
        ai_assist: true,
      }),
    })
    setOutcomeItem(null)
    await refresh()
    await loadQueue()
    showToast('Chiamata registrata')
  }

  return (
    <div className="operativo-page">
      <div className="operativo-header">
        <div>
          <div className="operativo-kicker">Centro Operativo</div>
          <h1>Priorità commerciali</h1>
        </div>
        <div className="operativo-stats">
          <div>
            <strong>{visibleItems.length}</strong>
            <span>azioni</span>
          </div>
          <div>
            <strong>{totals.hot}</strong>
            <span>calde</span>
          </div>
          <div>
            <strong>{totals.overdue}</strong>
            <span>scadute</span>
          </div>
          <div>
            <strong>{formatMoney(totals.quoteValue) || '0 €'}</strong>
            <span>preventivi</span>
          </div>
        </div>
      </div>

      <div className="operativo-tabs">
        {(['calls', 'overdue', 'quotes'] as OperatingQueueMode[]).map((tab) => (
          <button
            key={tab}
            className={`operativo-tab ${mode === tab ? 'active' : ''}`}
            onClick={() => setMode(tab)}
          >
            <span>{MODE_LABELS[tab]}</span>
          </button>
        ))}
      </div>

      <div className="operativo-toolbar">
        {isAdmin && (
          <select className="filter-select" value={agent} onChange={(event) => setAgent(event.target.value)}>
            <option value="">Tutti gli operatori</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
              </option>
            ))}
          </select>
        )}
        <select className="filter-select" value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">Tutte le origini</option>
          {SOURCE_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input
          className="operativo-filter-input"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Categoria"
        />
        <button className="btn btn-ghost btn-sm" onClick={loadQueue} disabled={loading}>
          Aggiorna
        </button>
      </div>

      {error && <div className="inline-error">{error}</div>}

      <div className="operativo-list">
        {loading ? (
          <div className="operativo-empty">Caricamento coda...</div>
        ) : visibleItems.length === 0 ? (
          <div className="operativo-empty">Nessuna azione in coda.</div>
        ) : (
          visibleItems.map((item) => {
            const contact: CRMContact = item.contact
            return (
              <div key={`${contact.id}-${item.task?.id || item.quote?.id || item.rank_score}`} className="operativo-row">
                <div className="operativo-rank">
                  <span className={scoreClass(item.rank_score)}>{item.rank_score}</span>
                  <span>{actionLabel(item.recommended_action)}</span>
                </div>

                <div className="operativo-main">
                  <div className="operativo-title-row">
                    <Link href={`/contacts/${contact.id}`} className="operativo-name">
                      {contact.name}
                    </Link>
                    <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                    {contact.score != null && <span className="tag tag-bassa">AI {contact.score}</span>}
                  </div>
                  <div className="operativo-subline">
                    {[contact.company, contact.phone, contact.email, contact.responsible || contact.assigned_agent]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className="operativo-reasons">
                    {item.rank_reasons.map((reason) => (
                      <span key={reason}>{reason}</span>
                    ))}
                  </div>
                </div>

                <div className="operativo-meta">
                  <strong>{formatDateTime(item.due_at)}</strong>
                  <span>{item.last_activity?.content || contact.last_activity_summary || 'Senza attività recente'}</span>
                  {item.quote && (
                    <span>
                      {item.quote.quote_number} · {formatMoney(item.quote.total_amount)}
                    </span>
                  )}
                </div>

                <div className="operativo-actions">
                  {contact.phone && (
                    <a className="btn btn-primary btn-sm" href={`tel:${contact.phone}`}>
                      Chiama
                    </a>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setOutcomeItem(item)}>
                    Esito
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => createFastFollowup(item)}>
                    +24h
                  </button>
                  <button
                    className="icon-btn"
                    title="Salta"
                    onClick={() => setSkippedIds((previous) => new Set(previous).add(contact.id))}
                  >
                    ×
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <CallOutcomeModal
        open={!!outcomeItem}
        contact={outcomeItem?.contact || null}
        task={taskForModal(outcomeItem)}
        stages={stages}
        onClose={() => setOutcomeItem(null)}
        onSave={saveOutcome}
      />
    </div>
  )
}
