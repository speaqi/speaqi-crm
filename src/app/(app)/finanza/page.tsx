'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'

// ─── Tipi (risposta /api/finance/overview) ──────────────────────────────────

interface FinanceSummary {
  paidRevenue: number
  paidRevenueNet: number
  confirmedRevenue: number
  openQuotesValue: number
  expectedRevenue30d: number
  pipelineValue: number
  weightedPipelineValue: number
  mtdRevenue: number
  ytdRevenue: number
  runRateMonthly: number
  runRateAnnual: number
  avgDealValue: number
  avgRevenuePerClient: number
  avgDaysToPay: number | null
  winRate: number
  payingClients: number
  quoteCounts: { draft: number; sent: number; accepted: number; paid: number; cancelled: number }
}

interface MonthlyRow {
  month: string
  paid: number
  confirmed: number
  sent: number
}

interface Opportunity {
  id: string
  quote_number: string
  customer: string
  contact_id: string | null
  status: string
  total: number
  probability: number
  expectedValue: number
  ageDays: number
}

interface Goal {
  id: string
  period_type: 'annual' | 'quarterly' | 'monthly'
  period_start: string
  metric: string
  target_amount: number
  label: string | null
  current: number
  progress: number
  expectedProgress: number
  active: boolean
  atRisk: boolean
}

interface Insight {
  tone: 'positive' | 'warning' | 'critical' | 'info'
  title: string
  detail: string
}

interface FinanceOverview {
  summary: FinanceSummary
  monthly: MonthlyRow[]
  byCategory: Array<{ category: string; amount: number; count: number }>
  topClients: Array<{ name: string; contact_id: string | null; amount: number; quotes: number }>
  opportunities: Opportunity[]
  goals: Goal[]
  insights: Insight[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function formatPercent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`
}

function monthLabel(month: string) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('it-IT', { month: 'short' })
}

const INSIGHT_TONE: Record<Insight['tone'], { icon: string; color: string; background: string }> = {
  positive: { icon: '📈', color: 'var(--green)', background: 'var(--green-light)' },
  warning: { icon: '⚠️', color: 'var(--yellow)', background: 'var(--yellow-light)' },
  critical: { icon: '🚨', color: 'var(--red)', background: 'var(--red-light)' },
  info: { icon: '💡', color: 'var(--accent)', background: 'var(--accent-light)' },
}

const GOAL_METRIC_LABEL: Record<string, string> = {
  revenue: 'Fatturato incassato',
  paid_revenue: 'Fatturato incassato',
  new_clients: 'Nuovi clienti',
  quotes_sent: 'Preventivi inviati',
}

const GOAL_PERIOD_LABEL: Record<Goal['period_type'], string> = {
  annual: 'Annuale',
  quarterly: 'Trimestrale',
  monthly: 'Mensile',
}

function goalCurrentLabel(goal: Goal) {
  if (goal.metric === 'new_clients' || goal.metric === 'quotes_sent') {
    return `${goal.current} / ${goal.target_amount}`
  }
  return `${formatCurrency(goal.current)} / ${formatCurrency(goal.target_amount)}`
}

function quoteStatusLabel(status: string) {
  if (status === 'accepted') return 'Accettato'
  if (status === 'sent') return 'Inviato'
  return status
}

function probabilityColor(probability: number) {
  if (probability >= 0.6) return 'var(--green)'
  if (probability >= 0.3) return 'var(--yellow)'
  return 'var(--red)'
}

function defaultGoalStart(periodType: Goal['period_type']) {
  const now = new Date()
  if (periodType === 'annual') return `${now.getFullYear()}-01-01`
  if (periodType === 'quarterly') {
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3 + 1
    return `${now.getFullYear()}-${String(quarterMonth).padStart(2, '0')}-01`
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function FinanzaPage() {
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [goalPeriodType, setGoalPeriodType] = useState<Goal['period_type']>('monthly')
  const [goalStart, setGoalStart] = useState(defaultGoalStart('monthly'))
  const [goalMetric, setGoalMetric] = useState('revenue')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await apiFetch<FinanceOverview>('/api/finance/overview')
      setOverview(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel caricamento dei dati finanziari')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const maxMonthly = useMemo(() => {
    if (!overview) return 0
    return Math.max(...overview.monthly.map((row) => row.paid + row.confirmed), 1)
  }, [overview])

  async function saveGoal(event: React.FormEvent) {
    event.preventDefault()
    const target = Number(goalTarget)
    if (!Number.isFinite(target) || target <= 0) return
    setGoalSaving(true)
    try {
      await apiFetch('/api/finance/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period_type: goalPeriodType,
          period_start: goalStart,
          metric: goalMetric,
          target_amount: target,
        }),
      })
      setGoalTarget('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel salvataggio dell\'obiettivo')
    } finally {
      setGoalSaving(false)
    }
  }

  async function deleteGoal(id: string) {
    try {
      await apiFetch(`/api/finance/goals?id=${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nell\'eliminazione dell\'obiettivo')
    }
  }

  if (loading) {
    return (
      <div className="finance-page">
        <div className="finance-loading">Caricamento dati finanziari…</div>
      </div>
    )
  }

  if (!overview) {
    return (
      <div className="finance-page">
        <div className="finance-loading">{error || 'Nessun dato disponibile'}</div>
      </div>
    )
  }

  const { summary } = overview

  return (
    <div className="finance-page">
      <header className="finance-header">
        <div>
          <h1>Finanza</h1>
          <p>Ricavi reali, previsioni e obiettivi calcolati da preventivi e pipeline.</p>
        </div>
        <Link href="/preventivi" className="finance-header-link">
          💶 Vai ai preventivi
        </Link>
      </header>

      {error && <div className="finance-error">{error}</div>}

      {/* KPI principali */}
      <section className="finance-kpi-grid">
        <div className="finance-kpi finance-kpi-primary">
          <span className="finance-kpi-label">Incassato totale</span>
          <span className="finance-kpi-value">{formatCurrency(summary.paidRevenue)}</span>
          <span className="finance-kpi-sub">Netto IVA: {formatCurrency(summary.paidRevenueNet)}</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Incassato questo mese</span>
          <span className="finance-kpi-value">{formatCurrency(summary.mtdRevenue)}</span>
          <span className="finance-kpi-sub">Anno in corso: {formatCurrency(summary.ytdRevenue)}</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Entrate confermate</span>
          <span className="finance-kpi-value">{formatCurrency(summary.confirmedRevenue)}</span>
          <span className="finance-kpi-sub">{summary.quoteCounts.accepted} preventivi accettati da incassare</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Previsione 30 giorni</span>
          <span className="finance-kpi-value">{formatCurrency(summary.expectedRevenue30d)}</span>
          <span className="finance-kpi-sub">Valore atteso dei preventivi aperti (ponderato)</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Pipeline trattative</span>
          <span className="finance-kpi-value">{formatCurrency(summary.pipelineValue)}</span>
          <span className="finance-kpi-sub">Ponderata: {formatCurrency(summary.weightedPipelineValue)}</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Run-rate annuale</span>
          <span className="finance-kpi-value">{formatCurrency(summary.runRateAnnual)}</span>
          <span className="finance-kpi-sub">Media mensile ultimi 3 mesi: {formatCurrency(summary.runRateMonthly)}</span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Win rate preventivi</span>
          <span className="finance-kpi-value">{formatPercent(summary.winRate)}</span>
          <span className="finance-kpi-sub">
            {summary.quoteCounts.paid} pagati · {summary.quoteCounts.cancelled} annullati
          </span>
        </div>
        <div className="finance-kpi">
          <span className="finance-kpi-label">Ticket medio</span>
          <span className="finance-kpi-value">{formatCurrency(summary.avgDealValue)}</span>
          <span className="finance-kpi-sub">
            {summary.payingClients} clienti paganti · media cliente {formatCurrency(summary.avgRevenuePerClient)}
            {summary.avgDaysToPay != null ? ` · incasso in ${summary.avgDaysToPay} gg` : ''}
          </span>
        </div>
      </section>

      {/* Insight automatici */}
      {overview.insights.length > 0 && (
        <section className="finance-section">
          <h2>🧠 Analisi automatica</h2>
          <div className="finance-insights">
            {overview.insights.map((insight, index) => {
              const tone = INSIGHT_TONE[insight.tone]
              return (
                <div key={index} className="finance-insight" style={{ background: tone.background }}>
                  <span className="finance-insight-icon">{tone.icon}</span>
                  <div>
                    <div className="finance-insight-title" style={{ color: tone.color }}>
                      {insight.title}
                    </div>
                    <div className="finance-insight-detail">{insight.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Andamento mensile */}
      <section className="finance-section">
        <h2>📊 Andamento mensile (ultimi 12 mesi)</h2>
        <div className="finance-chart">
          {overview.monthly.map((row) => {
            const paidHeight = maxMonthly > 0 ? (row.paid / maxMonthly) * 100 : 0
            const confirmedHeight = maxMonthly > 0 ? (row.confirmed / maxMonthly) * 100 : 0
            return (
              <div key={row.month} className="finance-chart-col" title={`${monthLabel(row.month)}: incassato ${formatCurrency(row.paid)}, confermato ${formatCurrency(row.confirmed)}`}>
                <div className="finance-chart-bars">
                  <div className="finance-chart-bar finance-chart-bar-confirmed" style={{ height: `${confirmedHeight}%` }} />
                  <div className="finance-chart-bar finance-chart-bar-paid" style={{ height: `${paidHeight}%` }} />
                </div>
                <span className="finance-chart-month">{monthLabel(row.month)}</span>
              </div>
            )
          })}
        </div>
        <div className="finance-chart-legend">
          <span><i className="finance-legend-dot" style={{ background: 'var(--accent)' }} /> Incassato</span>
          <span><i className="finance-legend-dot" style={{ background: 'var(--purple)' }} /> Confermato (accettato, da incassare)</span>
        </div>
      </section>

      {/* Opportunità con scoring */}
      <section className="finance-section">
        <h2>🎯 Opportunità aperte (scoring automatico)</h2>
        {overview.opportunities.length === 0 ? (
          <p className="finance-empty">Nessun preventivo aperto. Crea un preventivo per vedere le previsioni.</p>
        ) : (
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Preventivo</th>
                  <th>Stato</th>
                  <th>Età</th>
                  <th className="finance-num">Valore</th>
                  <th className="finance-num">Probabilità</th>
                  <th className="finance-num">Valore atteso</th>
                </tr>
              </thead>
              <tbody>
                {overview.opportunities.map((opportunity) => (
                  <tr key={opportunity.id}>
                    <td>
                      {opportunity.contact_id ? (
                        <Link href={`/contacts/${opportunity.contact_id}`} className="finance-link">
                          {opportunity.customer}
                        </Link>
                      ) : (
                        opportunity.customer
                      )}
                    </td>
                    <td className="finance-muted">{opportunity.quote_number}</td>
                    <td>{quoteStatusLabel(opportunity.status)}</td>
                    <td className="finance-muted">{opportunity.ageDays} gg</td>
                    <td className="finance-num">{formatCurrency(opportunity.total)}</td>
                    <td className="finance-num">
                      <span style={{ color: probabilityColor(opportunity.probability), fontWeight: 600 }}>
                        {formatPercent(opportunity.probability)}
                      </span>
                    </td>
                    <td className="finance-num finance-strong">{formatCurrency(opportunity.expectedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Categorie + Top clienti */}
      <div className="finance-two-col">
        <section className="finance-section">
          <h2>📦 Ricavi per prodotto</h2>
          {overview.byCategory.length === 0 ? (
            <p className="finance-empty">Nessun preventivo pagato finora.</p>
          ) : (
            <div className="finance-bars">
              {overview.byCategory.map((row) => {
                const max = overview.byCategory[0]?.amount || 1
                return (
                  <div key={row.category} className="finance-bar-row">
                    <span className="finance-bar-label">{row.category}</span>
                    <div className="finance-bar-track">
                      <div className="finance-bar-fill" style={{ width: `${Math.max((row.amount / max) * 100, 2)}%` }} />
                    </div>
                    <span className="finance-bar-value">{formatCurrency(row.amount)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="finance-section">
          <h2>🏆 Top clienti</h2>
          {overview.topClients.length === 0 ? (
            <p className="finance-empty">Nessun cliente pagante finora.</p>
          ) : (
            <div className="finance-clients">
              {overview.topClients.map((client, index) => (
                <div key={`${client.name}-${index}`} className="finance-client-row">
                  <span className="finance-client-rank">{index + 1}</span>
                  <span className="finance-client-name">
                    {client.contact_id ? (
                      <Link href={`/contacts/${client.contact_id}`} className="finance-link">
                        {client.name}
                      </Link>
                    ) : (
                      client.name
                    )}
                    <span className="finance-muted"> · {client.quotes} preventiv{client.quotes === 1 ? 'o' : 'i'}</span>
                  </span>
                  <span className="finance-client-amount">{formatCurrency(client.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Obiettivi */}
      <section className="finance-section">
        <h2>🚩 Obiettivi</h2>
        {overview.goals.length === 0 && (
          <p className="finance-empty">Nessun obiettivo impostato. Definisci un target per monitorare l&apos;avanzamento.</p>
        )}
        <div className="finance-goals">
          {overview.goals.map((goal) => (
            <div key={goal.id} className={`finance-goal ${goal.active ? '' : 'finance-goal-inactive'}`}>
              <div className="finance-goal-head">
                <div>
                  <span className="finance-goal-title">
                    {goal.label || `${GOAL_METRIC_LABEL[goal.metric] || goal.metric} · ${GOAL_PERIOD_LABEL[goal.period_type]}`}
                  </span>
                  <span className="finance-muted"> · da {new Date(`${goal.period_start}T12:00:00`).toLocaleDateString('it-IT')}</span>
                  {goal.atRisk && <span className="finance-goal-risk">⚠ a rischio</span>}
                  {goal.progress >= 1 && <span className="finance-goal-done">✓ raggiunto</span>}
                </div>
                <div className="finance-goal-actions">
                  <span className="finance-goal-numbers">{goalCurrentLabel(goal)}</span>
                  <button type="button" className="finance-goal-delete" onClick={() => deleteGoal(goal.id)} title="Elimina obiettivo">
                    ✕
                  </button>
                </div>
              </div>
              <div className="finance-goal-track">
                <div
                  className="finance-goal-fill"
                  style={{
                    width: `${Math.min(goal.progress * 100, 100)}%`,
                    background: goal.progress >= 1 ? 'var(--green)' : goal.atRisk ? 'var(--red)' : 'var(--accent)',
                  }}
                />
                <div className="finance-goal-expected" style={{ left: `${Math.min(goal.expectedProgress * 100, 100)}%` }} title="Avanzamento atteso a oggi" />
              </div>
            </div>
          ))}
        </div>

        <form className="finance-goal-form" onSubmit={saveGoal}>
          <select value={goalPeriodType} onChange={(e) => {
            const next = e.target.value as Goal['period_type']
            setGoalPeriodType(next)
            setGoalStart(defaultGoalStart(next))
          }}>
            <option value="monthly">Mensile</option>
            <option value="quarterly">Trimestrale</option>
            <option value="annual">Annuale</option>
          </select>
          <input type="date" value={goalStart} onChange={(e) => setGoalStart(e.target.value)} required />
          <select value={goalMetric} onChange={(e) => setGoalMetric(e.target.value)}>
            <option value="revenue">Fatturato incassato (€)</option>
            <option value="new_clients">Nuovi clienti (n°)</option>
            <option value="quotes_sent">Preventivi inviati (n°)</option>
          </select>
          <input
            type="number"
            min="1"
            step="any"
            placeholder="Target"
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value)}
            required
          />
          <button type="submit" disabled={goalSaving}>
            {goalSaving ? 'Salvataggio…' : '+ Aggiungi obiettivo'}
          </button>
        </form>
      </section>
    </div>
  )
}
