'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import { apiFetch } from '@/lib/api'
import { activityTypeLabel, formatDateTime, isClosedStatus, isOverdue, priorityBadgeClass, priorityLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { ActivityWithContact, CRMContact, TaskWithContact } from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padN(n: number) { return String(n).padStart(2, '0') }

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${padN(date.getMonth() + 1)}-${padN(date.getDate())}`
}

function startOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function endOfDay(d: Date) {
  const c = new Date(d)
  c.setHours(23, 59, 59, 999)
  return c
}

function startOfWeek(d: Date) {
  const c = new Date(d)
  const day = c.getDay()
  c.setDate(c.getDate() - (day === 0 ? 6 : day - 1))
  c.setHours(0, 0, 0, 0)
  return c
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function fmtDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('it-IT', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function fmtFullDate(dateStr: string) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('it-IT', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
}

function shiftDate(value: string | null | undefined, days: number) {
  const base = value ? new Date(value) : new Date()
  if (Number.isNaN(base.getTime())) {
    const f = new Date(); f.setDate(f.getDate() + days); return f.toISOString()
  }
  const n = new Date(base); n.setDate(n.getDate() + days); return n.toISOString()
}

function markerColor(type: string) {
  switch (type) {
    case 'call': return '#10b981'
    case 'email': case 'email_sent': case 'email_reply': return '#3b82f6'
    case 'msg': return '#f59e0b'
    case 'task': return '#7c3aed'
    default: return 'var(--accent)'
  }
}

const GENERIC_NAMES = new Set(['info', 'hello', 'contact', 'contatto', 'admin', 'office', 'sales', 'support', 'team', 'marketing', 'commerciale', 'newsletter'])
const GENERIC_DOMAINS = new Set(['gmail', 'hotmail', 'outlook', 'icloud', 'yahoo', 'libero'])

function domainLabel(email?: string | null) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return ''
  const domain = e.split('@')[1] || ''
  const root = domain.split('.')[0] || ''
  if (GENERIC_DOMAINS.has(root)) return e
  return root.replace(/[._-]+/g, ' ').trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function contactDisplayName(a: ActivityWithContact) {
  const name = String(a.contact?.name || '').trim()
  const email = String(a.contact?.email || '').trim()
  if (!name) return domainLabel(email) || email || 'Contatto'
  if (GENERIC_NAMES.has(name.toLowerCase())) return domainLabel(email) || email || name
  return name
}

function isEmailType(type: string) {
  return ['email', 'email_sent', 'email_reply', 'email_open', 'email_click', 'unsubscribe'].includes(type)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'today' | 'week' | 'month' | 'custom'

interface AgentSummary {
  agent: string
  calls: number
  emails: number
  other: number
  contactsWorked: number
}

interface DayTotal {
  date: string
  calls: number
  emails: number
  other: number
  contactsWorked: number
}

interface AnalyticsData {
  agentSummary: AgentSummary[]
  byDate: DayTotal[]
  totalActivities: number
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AttivitaPage() {
  const {
    tasks, scheduledCalls, openContactsWithoutQueue, contacts, stages,
    addActivity, completeTask, updateTask, refresh, showToast, updateContact,
  } = useCRMContext()

  const today = new Date()
  const todayStr = toDateInput(today)
  const tomorrow = new Date(today); tomorrow.setHours(24, 0, 0, 0)

  // ── Analytics state ──
  const [period, setPeriod] = useState<Period>('week')
  const [customStart, setCustomStart] = useState(todayStr)
  const [customEnd, setCustomEnd] = useState(todayStr)
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)

  // ── Day log state ──
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [dayActivities, setDayActivities] = useState<ActivityWithContact[]>([])
  const [dayLoading, setDayLoading] = useState(true)
  const [dayError, setDayError] = useState<string | null>(null)

  // ── Follow-up state ──
  const [inboxFilter, setInboxFilter] = useState<'all' | 'overdue' | 'today' | 'high'>('all')
  const [outcomeContact, setOutcomeContact] = useState<CRMContact | null>(null)
  const [outcomeTask, setOutcomeTask] = useState<TaskWithContact | null>(null)

  // ── Computed ──
  const overdueTasks = tasks.filter(t => t.due_date && isOverdue(t.due_date))
  const callsToday = scheduledCalls.filter(i => new Date(i.due_at).getTime() < tomorrow.getTime())
  const missingNextStep = openContactsWithoutQueue.filter(c => !isClosedStatus(c.status))

  const followupInbox = useMemo(() => {
    const startOfToday = startOfDay(today)
    return [...tasks]
      .filter(t => t.status === 'pending')
      .sort((a, b) => {
        const aOver = a.due_date && isOverdue(a.due_date) ? 1 : 0
        const bOver = b.due_date && isOverdue(b.due_date) ? 1 : 0
        if (aOver !== bOver) return bOver - aOver
        const pri = (t: TaskWithContact) => t.priority === 'high' ? 3 : t.priority === 'medium' ? 2 : t.priority === 'low' ? 1 : 0
        if (pri(a) !== pri(b)) return pri(b) - pri(a)
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity
        const db = b.due_date ? new Date(b.due_date).getTime() : Infinity
        return da - db
      })
      .filter(t => {
        if (inboxFilter === 'all') return true
        if (inboxFilter === 'overdue') return !!t.due_date && isOverdue(t.due_date)
        if (inboxFilter === 'today') {
          if (!t.due_date) return false
          const due = new Date(t.due_date)
          return due >= startOfToday && due < tomorrow
        }
        if (inboxFilter === 'high') return t.priority === 'high' || Number(t.contact?.priority || 0) >= 3
        return true
      })
  }, [inboxFilter, tasks, tomorrow])

  // ── Range computation ──
  function computeRange(p: Period): { start: string; end: string } {
    const now = new Date()
    switch (p) {
      case 'today':
        return { start: startOfDay(now).toISOString(), end: endOfDay(now).toISOString() }
      case 'week':
        return { start: startOfWeek(now).toISOString(), end: endOfDay(now).toISOString() }
      case 'month':
        return { start: startOfMonth(now).toISOString(), end: endOfDay(now).toISOString() }
      case 'custom':
        return {
          start: new Date(`${customStart}T00:00:00`).toISOString(),
          end: new Date(`${customEnd}T23:59:59`).toISOString(),
        }
    }
  }

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    setAnalyticsError(null)
    try {
      const { start, end } = computeRange(period)
      const data = await apiFetch<AnalyticsData>(
        `/api/analytics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      )
      setAnalytics(data)
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : 'Impossibile caricare analytics')
    } finally {
      setAnalyticsLoading(false)
    }
  }, [period, customStart, customEnd])

  const loadDayActivities = useCallback(async () => {
    setDayLoading(true)
    setDayError(null)
    try {
      const start = new Date(`${selectedDate}T00:00:00`).toISOString()
      const end = new Date(`${selectedDate}T23:59:59`).toISOString()
      const data = await apiFetch<{ activities: ActivityWithContact[] }>(
        `/api/activities?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=200`
      )
      setDayActivities(data.activities || [])
    } catch (e) {
      setDayError(e instanceof Error ? e.message : 'Impossibile caricare le attività')
    } finally {
      setDayLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { void loadAnalytics() }, [loadAnalytics])
  useEffect(() => { void loadDayActivities() }, [loadDayActivities])

  const dayStats = useMemo(() => {
    const ids = new Set<string>()
    let calls = 0; let emails = 0
    for (const a of dayActivities) {
      ids.add(a.contact_id)
      if (a.type === 'call') calls++
      if (isEmailType(a.type)) emails++
    }
    return { contactsWorked: ids.size, calls, emails, other: Math.max(0, dayActivities.length - calls - emails) }
  }, [dayActivities])

  const teamTotal = useMemo<AgentSummary>(() => {
    if (!analytics) return { agent: 'Totale', calls: 0, emails: 0, other: 0, contactsWorked: 0 }
    return analytics.agentSummary.reduce(
      (acc, a) => ({
        agent: 'Totale',
        calls: acc.calls + a.calls,
        emails: acc.emails + a.emails,
        other: acc.other + a.other,
        contactsWorked: acc.contactsWorked + a.contactsWorked,
      }),
      { agent: 'Totale', calls: 0, emails: 0, other: 0, contactsWorked: 0 }
    )
  }, [analytics])

  // ─── Bar chart helper (text-based) ───
  function maxVal(arr: DayTotal[], key: keyof Pick<DayTotal, 'calls' | 'emails' | 'contactsWorked'>) {
    return Math.max(1, ...arr.map(d => d[key]))
  }

  return (
    <div className="dash-content">

      {/* ── Analytics Team ──────────────────────────────────────────────────── */}
      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="detail-row" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="dash-card-title" style={{ marginBottom: 4 }}>Analytics team</div>
            <div style={{ color: 'var(--text2)', fontSize: 13 }}>
              Attività per agente · {period === 'today' ? 'Oggi' : period === 'week' ? 'Questa settimana' : period === 'month' ? 'Questo mese' : 'Personalizzato'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['today', 'week', 'month', 'custom'] as Period[]).map(p => (
              <button
                key={p}
                className={`filter-chip ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p === 'today' ? 'Oggi' : p === 'week' ? 'Settimana' : p === 'month' ? 'Mese' : 'Personalizzato'}
              </button>
            ))}
            {period === 'custom' && (
              <>
                <input className="fi" type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ margin: 0, minWidth: 150 }} />
                <span style={{ color: 'var(--text2)' }}>→</span>
                <input className="fi" type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ margin: 0, minWidth: 150 }} />
              </>
            )}
          </div>
        </div>

        {analyticsLoading ? (
          <p style={{ color: 'var(--text3)' }}>Caricamento analytics...</p>
        ) : analyticsError ? (
          <p style={{ color: 'var(--danger)' }}>{analyticsError}</p>
        ) : analytics && analytics.agentSummary.length === 0 ? (
          <p style={{ color: 'var(--text3)' }}>Nessuna attività nel periodo selezionato.</p>
        ) : analytics ? (
          <>
            {/* Agent table */}
            <div style={{ overflowX: 'auto', marginBottom: 24 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text2)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>Agente</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Chiamate</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Email</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Altre att.</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Contatti toccati</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Totale att.</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.agentSummary.map(agent => (
                    <tr key={agent.agent} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500 }}>{agent.agent}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                          {agent.calls}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block' }} />
                          {agent.emails}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text2)' }}>{agent.other}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{agent.contactsWorked}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text2)' }}>{agent.calls + agent.emails + agent.other}</td>
                    </tr>
                  ))}
                  {analytics.agentSummary.length > 1 && (
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)', fontWeight: 700 }}>
                      <td style={{ padding: '10px 12px' }}>Totale team</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{teamTotal.calls}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{teamTotal.emails}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{teamTotal.other}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{teamTotal.contactsWorked}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{analytics.totalActivities}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Daily bar chart (text-based) */}
            {analytics.byDate.length > 1 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--text2)' }}>
                  Andamento giornaliero — chiamate
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {analytics.byDate.map(day => {
                    const max = maxVal(analytics.byDate, 'calls')
                    const pct = Math.round((day.calls / max) * 100)
                    return (
                      <div key={day.date} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                        <div style={{ width: 80, flexShrink: 0, color: 'var(--text2)', fontSize: 12 }}>
                          {fmtDate(day.date)}
                        </div>
                        <div style={{ flex: 1, background: 'var(--surface2)', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              minWidth: day.calls > 0 ? 4 : 0,
                              height: '100%',
                              background: '#10b981',
                              borderRadius: 4,
                              transition: 'width 0.3s',
                            }}
                          />
                        </div>
                        <div style={{ width: 28, textAlign: 'right', fontWeight: 600 }}>{day.calls}</div>
                        <div style={{ width: 60, fontSize: 12, color: 'var(--text3)' }}>
                          {day.emails > 0 && `+${day.emails} email`}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ── Lavorato nel giorno ────────────────────────────────────────────────── */}
      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="detail-row" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="dash-card-title" style={{ marginBottom: 4 }}>Log giornaliero</div>
            <div style={{ color: 'var(--text2)', fontSize: 13 }}>
              {selectedDate === todayStr ? 'Oggi' : 'Storico'} · {fmtFullDate(selectedDate)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(todayStr)} disabled={selectedDate === todayStr}>
              Oggi
            </button>
            <input className="fi" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ minWidth: 170, margin: 0 }} />
          </div>
        </div>

        <div className="dash-meta-grid">
          <div className="meta-card meta-card-strong"><strong>{dayStats.contactsWorked}</strong><span>contatti toccati</span></div>
          <div className="meta-card"><strong>{dayStats.calls}</strong><span>chiamate</span></div>
          <div className="meta-card"><strong>{dayStats.emails}</strong><span>email</span></div>
          <div className="meta-card"><strong>{dayStats.other}</strong><span>altre attività</span></div>
        </div>

        <div className="timeline-list" style={{ marginTop: 20 }}>
          {dayLoading ? (
            <p style={{ color: 'var(--text3)' }}>Caricamento...</p>
          ) : dayError ? (
            <p style={{ color: 'var(--danger)' }}>{dayError}</p>
          ) : dayActivities.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessuna attività in questa giornata.</p>
          ) : (
            dayActivities.map(a => (
              <div key={a.id} className="timeline-item">
                <div className="timeline-marker" style={{ background: markerColor(a.type) }} />
                <div style={{ minWidth: 0 }}>
                  <div className="timeline-title">
                    <Link href={`/contacts/${a.contact_id}`}>{contactDisplayName(a)}</Link>
                    {' · '}{activityTypeLabel(a.type)}
                    {a.contact?.responsible && (
                      <span style={{ fontSize: 12, color: 'var(--text2)', marginLeft: 6 }}>
                        [{a.contact.responsible}]
                      </span>
                    )}
                  </div>
                  <div className="timeline-time">
                    {formatDateTime(a.created_at)}
                    {a.contact?.status ? ` · ${statusLabel(a.contact.status)}` : ''}
                  </div>
                  <div className="timeline-body">{a.content || 'Nessun contenuto'}</div>
                  {a.contact && (
                    <div className="contact-tags" style={{ marginTop: 8 }}>
                      <span className={`ctag ${priorityBadgeClass(a.contact.priority)}`}>{priorityLabel(a.contact.priority)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Azione del giorno ────────────────────────────────────────────────── */}
      <div className="detail-grid">
        <div className="dash-card">
          <div className="dash-card-title" style={{ marginBottom: 12 }}>Chiamate da fare oggi</div>
          <div className="dash-meta-grid">
            <div className="meta-card meta-card-strong"><strong>{callsToday.length}</strong><span>contatti da chiamare</span></div>
            <div className="meta-card"><strong>{callsToday.filter(i => i.contact.priority >= 2).length}</strong><span>alta/media priorità</span></div>
            <div className="meta-card"><strong>{callsToday.filter(i => !i.contact.phone).length}</strong><span>senza numero</span></div>
            <div className="meta-card"><strong>{overdueTasks.length}</strong><span>task in ritardo</span></div>
          </div>
          <div className="task-list" style={{ marginTop: 16 }}>
            {callsToday.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nessuna chiamata prevista per oggi.</p>
            ) : (
              callsToday.map(item => (
                <div key={`${item.contact.id}:${item.due_at}`} className={`task-card ${isOverdue(item.due_at) ? 'overdue' : ''}`}>
                  <div>
                    <strong>{item.contact.name}</strong>
                    <div className="task-date">{statusLabel(item.contact.status)} · {formatDateTime(item.due_at)}</div>
                    <div className="task-note">{item.contact.phone || 'Telefono mancante'} · {item.contact.last_activity_summary || 'Nessuna attività'}</div>
                    <div className="contact-tags" style={{ marginTop: 8 }}>
                      <span className={`ctag ${priorityBadgeClass(item.contact.priority)}`}>{priorityLabel(item.contact.priority)}</span>
                      {item.contact.responsible && (
                        <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>{item.contact.responsible}</span>
                      )}
                    </div>
                  </div>
                  <div className="task-actions">
                    {item.task && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={async () => { await updateTask(item.task!.id, { due_date: shiftDate(item.task!.due_date, 1) }); showToast('+1 giorno') }}>+1g</button>
                        <button className="btn btn-ghost btn-sm" onClick={async () => { await updateTask(item.task!.id, { due_date: shiftDate(item.task!.due_date, 7) }); showToast('+7 giorni') }}>+7g</button>
                      </>
                    )}
                    <Link href={`/contacts/${item.contact.id}`} className="btn btn-ghost btn-sm">Apri</Link>
                    {item.contact.phone ? (
                      <a href={`tel:${item.contact.phone}`} className="btn btn-primary btn-sm">Chiama</a>
                    ) : (
                      <span className="btn btn-ghost btn-sm" style={{ opacity: 0.5, pointerEvents: 'none' }}>N. assente</span>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => { setOutcomeContact(item.contact); setOutcomeTask(item.task) }}>Esito</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-card">
          <div className="detail-row" style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div className="dash-card-title" style={{ marginBottom: 4 }}>Follow-up inbox</div>
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>Task pending ordinati per urgenza e priorità.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'overdue', 'today', 'high'] as const).map(f => (
                <button key={f} className={`filter-chip ${inboxFilter === f ? 'active' : ''}`} onClick={() => setInboxFilter(f)}>
                  {f === 'all' ? 'Tutto' : f === 'overdue' ? 'Scaduti' : f === 'today' ? 'Oggi' : 'Alta priorità'}
                </button>
              ))}
            </div>
          </div>
          <div className="task-list">
            {followupInbox.length === 0 ? (
              <p style={{ color: 'var(--text3)' }}>Nessun task pending.</p>
            ) : (
              followupInbox.map(task => (
                <div key={task.id} className={`task-card ${task.due_date && isOverdue(task.due_date) ? 'overdue' : ''}`}>
                  <div>
                    <strong>{task.contact?.name || 'Contatto'}</strong>
                    <div className="task-date">{task.type} · {formatDateTime(task.due_date)}</div>
                    <div className="task-note">{task.note || task.contact?.last_activity_summary || 'Nessuna nota'}</div>
                    <div className="contact-tags" style={{ marginTop: 8 }}>
                      <span className={`ctag ${task.priority === 'high' ? 'tag-alta' : task.priority === 'low' ? 'tag-bassa' : 'tag-media'}`}>
                        {task.priority === 'high' ? 'Alta' : task.priority === 'low' ? 'Bassa' : 'Media'}
                      </span>
                      {task.contact?.responsible && (
                        <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>{task.contact.responsible}</span>
                      )}
                      {task.contact?.event_tag && <span className="ctag ctag-event">{task.contact.event_tag}</span>}
                    </div>
                  </div>
                  <div className="task-actions">
                    {[1, 3, 7].map(d => (
                      <button key={d} className="btn btn-ghost btn-sm" onClick={async () => { await updateTask(task.id, { due_date: shiftDate(task.due_date, d) }); showToast(`+${d} ${d === 1 ? 'giorno' : 'giorni'}`) }}>+{d}g</button>
                    ))}
                    {task.contact && <Link href={`/contacts/${task.contact.id}`} className="btn btn-ghost btn-sm">Apri</Link>}
                    {task.type === 'call' || task.type === 'follow-up' ? (
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        const c = contacts.find(x => x.id === task.contact_id) || null
                        if (!c) { window.alert('Contatto non trovato'); return }
                        setOutcomeContact(c); setOutcomeTask(task)
                      }}>Esito</button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={async () => { await completeTask(task.id); await loadDayActivities(); showToast('Completato') }}>Completa</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Lead senza next step ──────────────────────────────────────────────── */}
      <div className="dash-card" style={{ marginTop: 20 }}>
        <div className="dash-card-title" style={{ marginBottom: 12 }}>Lead che richiedono intervento</div>
        <div className="dash-meta-grid" style={{ marginBottom: 16 }}>
          <div className="meta-card meta-card-strong"><strong>{missingNextStep.length}</strong><span>senza follow-up impostato</span></div>
          <div className="meta-card meta-card-strong"><strong>{overdueTasks.length}</strong><span>task in ritardo</span></div>
        </div>
        <div className="timeline-list">
          {missingNextStep.slice(0, 10).map(contact => (
            <div key={contact.id} className="timeline-item">
              <div className="timeline-marker" />
              <div>
                <div className="timeline-title"><Link href={`/contacts/${contact.id}`}>{contact.name}</Link></div>
                <div className="timeline-time">{statusLabel(contact.status)} · {priorityLabel(contact.priority)}</div>
                {contact.responsible && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{contact.responsible}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <CallOutcomeModal
        open={!!outcomeContact}
        contact={outcomeContact}
        task={outcomeTask}
        stages={stages}
        onClose={() => { setOutcomeContact(null); setOutcomeTask(null) }}
        onSave={async (payload) => {
          if (!outcomeContact) return
          if (outcomeTask) await completeTask(outcomeTask.id, { refresh: false })
          if (payload.status !== outcomeContact.status || isClosedStatus(payload.status)) {
            await updateContact(outcomeContact.id, { status: payload.status, next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at }, { refresh: false })
          }
          await addActivity(outcomeContact.id, { type: 'call', content: payload.content, next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at, task_type: payload.task_type }, { refresh: false })
          await refresh()
          await loadDayActivities()
          showToast('Chiamata registrata')
        }}
      />
    </div>
  )
}
