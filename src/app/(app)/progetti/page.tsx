'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { useCRMContext } from '../layout'
import {
  formatDateTime,
  isClosedStatus,
  isInactiveStatus,
  priorityBadgeClass,
  priorityLabel,
  stageColor,
  statusLabel,
} from '@/lib/data'
import {
  dueAtLocalDateKey,
  localDayDateKey,
  shiftDays,
  startOfDay,
  type ScheduledCall,
} from '@/lib/schedule'
import type { CRMContact, TaskWithContact } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

// Soglie "fermo da troppo" per fase (giorni) — coerenti con l'endpoint analytics
const STUCK_DAYS: Record<string, number> = { supertop: 7, quote: 14 }

type Urgency = 'overdue' | 'today' | 'week' | 'scheduled' | 'none'

const URGENCY_ORDER: Urgency[] = ['overdue', 'today', 'none', 'week', 'scheduled']

const URGENCY_META: Record<Urgency, { label: string; icon: string; color: string }> = {
  overdue: { label: 'Recall scaduto', icon: '⏰', color: '#ef4444' },
  today: { label: 'Da richiamare oggi', icon: '📞', color: '#f59e0b' },
  none: { label: 'Senza prossimo passo', icon: '⚠️', color: '#e11d48' },
  week: { label: 'Questa settimana', icon: '🗓️', color: '#4f6ef7' },
  scheduled: { label: 'Programmati', icon: '✅', color: '#10b981' },
}

type ProjectAnalytics = {
  closedWonCount: number
  avgDaysToClose: number | null
  medianDaysToClose: number | null
  stuckSupertop: number
  stuckQuote: number
  avgDaysInStage: { supertop: number | null; quote: number | null }
}

function isProjectContact(contact: CRMContact) {
  const s = String(contact.status || '').trim().toLowerCase()
  return s === 'supertop' || s === 'quote' || s === 'preventivo'
}

function daysSince(value?: string | null) {
  if (!value) return null
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / DAY_MS)
}

function roundDays(value: number | null) {
  if (value === null) return '—'
  return `${Math.round(value)}g`
}

export default function ProgettiPage() {
  const {
    contacts,
    scheduledCalls,
    stages,
    updateContact,
    updateTask,
    completeTask,
    addActivity,
    refresh,
    showToast,
  } = useCRMContext()

  const [groupMode, setGroupMode] = useState<'urgency' | 'stage'>('urgency')
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null)
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<Pick<TaskWithContact, 'id' | 'type'> | null>(null)
  const [analytics, setAnalytics] = useState<ProjectAnalytics | null>(null)

  const today = startOfDay(new Date())
  const todayKey = localDayDateKey(today)
  const weekKey = localDayDateKey(shiftDays(today, 7))

  const scheduledByContactId = useMemo(
    () => new Map(scheduledCalls.map((call) => [call.contact.id, call])),
    [scheduledCalls]
  )

  // ─── Progetti = lead in Supertop / Preventivo, ancora aperti ───
  const projects = useMemo(
    () =>
      contacts.filter(
        (c) => isProjectContact(c) && !isClosedStatus(c.status) && !isInactiveStatus(c.status)
      ),
    [contacts]
  )

  function urgencyOf(contact: CRMContact): { urgency: Urgency; recall: ScheduledCall | null } {
    const recall = scheduledByContactId.get(contact.id) || null
    if (!recall || !recall.due_at) return { urgency: 'none', recall: null }
    const dueKey = dueAtLocalDateKey(recall.due_at)
    if (!dueKey) return { urgency: 'none', recall }
    if (dueKey < todayKey) return { urgency: 'overdue', recall }
    if (dueKey === todayKey) return { urgency: 'today', recall }
    if (dueKey <= weekKey) return { urgency: 'week', recall }
    return { urgency: 'scheduled', recall }
  }

  function stuckDays(contact: CRMContact): number | null {
    const inStage = daysSince(contact.stage_entered_at || contact.updated_at)
    if (inStage === null) return null
    const threshold = STUCK_DAYS[String(contact.status || '').toLowerCase()] ?? 14
    return inStage > threshold ? inStage : null
  }

  // ─── Raggruppamento ───
  const groups = useMemo(() => {
    type Group = { key: string; label: string; icon: string; color: string; items: Array<{ contact: CRMContact; urgency: Urgency; recall: ScheduledCall | null }> }
    const enriched = projects.map((contact) => ({ contact, ...urgencyOf(contact) }))

    const sortAging = (
      a: { contact: CRMContact; urgency: Urgency; recall: ScheduledCall | null },
      b: { contact: CRMContact; urgency: Urgency; recall: ScheduledCall | null }
    ) => {
      const aDue = a.recall?.due_at ? new Date(a.recall.due_at).getTime() : Number.POSITIVE_INFINITY
      const bDue = b.recall?.due_at ? new Date(b.recall.due_at).getTime() : Number.POSITIVE_INFINITY
      if (a.urgency === 'none' && b.urgency === 'none') {
        const aAge = daysSince(a.contact.stage_entered_at || a.contact.updated_at) ?? 0
        const bAge = daysSince(b.contact.stage_entered_at || b.contact.updated_at) ?? 0
        if (aAge !== bAge) return bAge - aAge
      } else if (aDue !== bDue) {
        return aDue - bDue
      }
      if (b.contact.priority !== a.contact.priority) return b.contact.priority - a.contact.priority
      return (b.contact.value || 0) - (a.contact.value || 0)
    }

    if (groupMode === 'stage') {
      const byStage = new Map<string, Group>()
      for (const e of enriched) {
        const label = statusLabel(e.contact.status)
        const color = stageColor(e.contact.status, stages)
        const group = byStage.get(label) || { key: label, label, icon: '🎯', color, items: [] }
        group.items.push(e)
        byStage.set(label, group)
      }
      return [...byStage.values()].map((g) => ({ ...g, items: g.items.sort(sortAging) }))
    }

    return URGENCY_ORDER.map((urgency) => {
      const meta = URGENCY_META[urgency]
      return {
        key: urgency,
        label: meta.label,
        icon: meta.icon,
        color: meta.color,
        items: enriched.filter((e) => e.urgency === urgency).sort(sortAging),
      }
    }).filter((g) => g.items.length > 0)
  }, [projects, groupMode, stages, scheduledByContactId, todayKey, weekKey])

  const noNextStepCount = useMemo(
    () => projects.filter((c) => urgencyOf(c).urgency === 'none').length,
    [projects, scheduledByContactId]
  )

  // ─── Metriche aggregate ───
  useEffect(() => {
    let active = true
    import('@/lib/api')
      .then(({ apiFetch }) => apiFetch<ProjectAnalytics>('/api/analytics/projects'))
      .then((data) => {
        if (active) setAnalytics(data)
      })
      .catch(() => {
        /* metriche opzionali */
      })
    return () => {
      active = false
    }
  }, [])

  // ─── Azioni ───
  async function reschedule(contactId: string, days: number) {
    const recall = scheduledByContactId.get(contactId)
    const base = recall?.due_at ? new Date(recall.due_at) : new Date()
    const target = new Date(base.getTime() + days * DAY_MS)
    try {
      if (recall?.task?.id) {
        await updateTask(recall.task.id, { due_date: target.toISOString() })
      } else {
        await updateContact(contactId, { next_followup_at: target.toISOString() })
      }
      showToast(`Recall spostato a +${days}g`)
    } catch (e) {
      showToast(`Errore: ${e instanceof Error ? e.message : 'spostamento'}`)
    }
  }

  function openOutcome(contact: CRMContact) {
    const recall = scheduledByContactId.get(contact.id)
    setOutcomeContact(contact)
    setOutcomeTask(recall?.task ? { id: recall.task.id, type: recall.task.type } : null)
  }

  const totalValue = projects.reduce((sum, c) => sum + (c.value || 0), 0)

  return (
    <div className="dash-content">
      <div className="proj-head">
        <div>
          <h1 className="proj-title">🎯 Progetti da portare avanti</h1>
          <p className="proj-sub">
            {projects.length} progetti attivi (Supertop + Preventivo) ·{' '}
            {totalValue.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} in pipeline
          </p>
        </div>
        <div className="proj-toggle">
          <button
            type="button"
            className={groupMode === 'urgency' ? 'active' : ''}
            onClick={() => setGroupMode('urgency')}
          >
            Per urgenza
          </button>
          <button
            type="button"
            className={groupMode === 'stage' ? 'active' : ''}
            onClick={() => setGroupMode('stage')}
          >
            Per fase
          </button>
        </div>
      </div>

      {/* ── Metriche tempo ── */}
      <div className="kpi-grid">
        <div className="kpi" style={{ borderLeftColor: '#10b981' }}>
          <div className="kpi-icon">⏱️</div>
          <div className="kpi-val">{roundDays(analytics?.avgDaysToClose ?? null)}</div>
          <div className="kpi-label">Tempo medio di chiusura{analytics?.closedWonCount ? ` (${analytics.closedWonCount} vinti)` : ''}</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#4f6ef7' }}>
          <div className="kpi-icon">📊</div>
          <div className="kpi-val">{roundDays(analytics?.medianDaysToClose ?? null)}</div>
          <div className="kpi-label">Mediana di chiusura</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#e11d48' }}>
          <div className="kpi-icon">🔥</div>
          <div className="kpi-val">{analytics?.stuckSupertop ?? '—'}</div>
          <div className="kpi-label">Supertop fermi &gt;{STUCK_DAYS.supertop}g</div>
        </div>
        <div className="kpi" style={{ borderLeftColor: '#f97316' }}>
          <div className="kpi-icon">💶</div>
          <div className="kpi-val">{analytics?.stuckQuote ?? '—'}</div>
          <div className="kpi-label">Preventivi fermi &gt;{STUCK_DAYS.quote}g</div>
        </div>
      </div>

      {noNextStepCount > 0 && groupMode === 'urgency' && (
        <div className="proj-banner">
          ⚠️ Hai <strong>{noNextStepCount}</strong> progetti senza prossimo passo: rischi di perderli. Pianifica un recall.
        </div>
      )}

      {/* ── Gruppi ── */}
      {groups.length === 0 ? (
        <div className="dash-card">
          <div className="proj-empty">Nessun progetto in Supertop o Preventivo al momento.</div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="dash-card proj-group">
            <div className="proj-group-head" style={{ borderLeftColor: group.color }}>
              <span className="proj-group-icon">{group.icon}</span>
              <h2 className="dash-card-title" style={{ margin: 0 }}>{group.label}</h2>
              <span className="proj-group-count">{group.items.length}</span>
            </div>

            <div className="proj-list">
              {group.items.map(({ contact, urgency, recall }) => {
                const stuck = stuckDays(contact)
                const inStage = daysSince(contact.stage_entered_at || contact.updated_at)
                const sinceOpen = daysSince(contact.created_at)
                return (
                  <div key={contact.id} className={`task-card ${urgency === 'overdue' ? 'overdue' : ''}`}>
                    <div className="proj-card-main">
                      <div className="proj-card-name">
                        <strong>{contact.name}</strong>
                        {contact.company && <span className="proj-card-company"> · {contact.company}</span>}
                      </div>
                      <div className="contact-tags" style={{ marginTop: 5 }}>
                        <span className="ctag" style={{ background: `${stageColor(contact.status, stages)}22`, color: stageColor(contact.status, stages) }}>
                          {statusLabel(contact.status)}
                        </span>
                        {contact.priority > 0 && (
                          <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                        )}
                        {contact.value ? (
                          <span className="ctag" style={{ background: '#ecfdf5', color: '#065f46' }}>
                            {contact.value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                          </span>
                        ) : null}
                        {groupMode === 'stage' && urgency !== 'scheduled' && (
                          <span className="ctag" style={{ background: `${URGENCY_META[urgency].color}22`, color: URGENCY_META[urgency].color }}>
                            {URGENCY_META[urgency].icon} {URGENCY_META[urgency].label}
                          </span>
                        )}
                        {stuck !== null && (
                          <span className="ctag proj-stuck">🐌 Fermo da {stuck}g</span>
                        )}
                      </div>
                      <div className="task-date">
                        {inStage !== null && <>In fase da <strong>{inStage}g</strong> · </>}
                        {sinceOpen !== null && <>Aperto da {sinceOpen}g</>}
                        {recall?.due_at && <> · Recall {formatDateTime(recall.due_at)}</>}
                      </div>
                      {contact.last_activity_summary && (
                        <div className="task-note">{contact.last_activity_summary}</div>
                      )}
                    </div>

                    <div className="task-actions">
                      {urgency === 'none' ? (
                        <button type="button" className="btn-mini btn-mini-primary" onClick={() => reschedule(contact.id, 1)}>
                          Pianifica recall
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn-mini" onClick={() => reschedule(contact.id, 1)}>+1g</button>
                          <button type="button" className="btn-mini" onClick={() => reschedule(contact.id, 3)}>+3g</button>
                          <button type="button" className="btn-mini" onClick={() => reschedule(contact.id, 7)}>+7g</button>
                        </>
                      )}
                      <button type="button" className="btn-mini" onClick={() => openOutcome(contact)}>Esito</button>
                      <button type="button" className="btn-mini" onClick={() => setDrawerContactId(contact.id)}>Apri</button>
                      {contact.phone && <a className="btn-mini" href={`tel:${contact.phone}`}>Chiama</a>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))
      )}

      <ContactDrawer contactId={drawerContactId} onClose={() => setDrawerContactId(null)} />

      <CallOutcomeModal
        open={!!outcomeContact}
        contact={outcomeContact}
        task={outcomeTask}
        stages={stages}
        onClose={() => {
          setOutcomeContact(null)
          setOutcomeTask(null)
        }}
        onSave={async (payload) => {
          if (!outcomeContact) return
          if (outcomeTask) await completeTask(outcomeTask.id, { refresh: false })
          if (payload.status !== outcomeContact.status || isClosedStatus(payload.status)) {
            await updateContact(
              outcomeContact.id,
              { status: payload.status, next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at },
              { refresh: false }
            )
          }
          await addActivity(
            outcomeContact.id,
            {
              type: 'call',
              content: payload.content,
              next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at,
              task_type: payload.task_type,
            },
            { refresh: false }
          )
          await refresh()
          setOutcomeContact(null)
          setOutcomeTask(null)
          showToast('Chiamata registrata')
        }}
      />
    </div>
  )
}
