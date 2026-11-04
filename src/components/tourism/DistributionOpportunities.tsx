'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { TOURISM_TYPES } from '@/lib/tourism'
import {
  COMMERCIAL_STATUSES,
  COMPONENT_LABELS,
  coverageGaps,
  distributionCsv,
  GUIDE_DESTINATIONS,
  guideLabel,
  MODEL_LABELS,
  MODEL_SUPPORT,
  MODELS,
  SCORE_WEIGHTS,
  STATUS_LABELS,
  TIER_LABELS,
  TIERS,
  VOLUME_LABELS,
  type CommercialModel,
  type CommercialStatus,
  type DistributionRow,
  type MatrixCell,
  type ScoreComponent,
} from '@/lib/tourism-distribution'
import d from './distribution.module.css'

type Summary = {
  total: number
  qualified: number
  strategic: number
  quick_wins: number
  with_email: number
  tiers: Record<string, number>
  statuses: Record<string, number>
  models: Record<string, number>
  by_slug: { slug: string; total: number; a: number; b: number; quick: number; with_email: number }[]
  by_type: { type: string; total: number; a: number; b: number }[]
  by_country: { country: string; total: number; ab: number }[]
  matrix: MatrixCell[]
  matrix_country: { slug: string; country: string; total: number; ab: number }[]
}

type View = 'ranking' | 'top100' | 'quick' | 'dashboard'
type Filters = {
  slug: string
  type: string
  country: string
  tier: string
  model: string
  status: string
  contact: string
  volume: string
  q: string
  min_score: string
  strategic: boolean
  quick_win: boolean
}
const EMPTY: Filters = {
  slug: '', type: '', country: '', tier: '', model: '', status: '', contact: '', volume: '',
  q: '', min_score: '', strategic: false, quick_win: false,
}

const typeLabel = (code: string) => (TOURISM_TYPES as Record<string, string>)[code] || code
const PAGE = 50

function toQuery(f: Filters, extra: Record<string, string> = {}) {
  const p = new URLSearchParams()
  for (const [key, value] of Object.entries(f)) {
    if (typeof value === 'boolean') {
      if (value) p.set(key, '1')
    } else if (value) p.set(key, value)
  }
  for (const [key, value] of Object.entries(extra)) p.set(key, value)
  return p.toString()
}

export default function DistributionOpportunities() {
  const [view, setView] = useState<View>('dashboard')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [rows, setRows] = useState<DistributionRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<DistributionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSummary = useCallback(async () => {
    try {
      const response = await apiFetch<{ summary: Summary }>('/api/tourism/distribution?summary=1')
      setSummary(response.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Riepilogo non disponibile')
    }
  }, [])

  const effective = useMemo<Filters>(() => {
    if (view === 'top100') return { ...filters, tier: filters.tier || 'A,B' }
    if (view === 'quick') return { ...filters, quick_win: true }
    return filters
  }, [view, filters])

  const loadRows = useCallback(async () => {
    if (view === 'dashboard') return
    setLoading(true)
    setError('')
    try {
      const limit = view === 'top100' ? 100 : view === 'quick' ? 20 : PAGE
      const response = await apiFetch<{ rows: DistributionRow[]; total: number }>(
        `/api/tourism/distribution?${toQuery(effective, { limit: String(limit), offset: String(view === 'ranking' ? offset : 0) })}`,
      )
      setRows(response.rows)
      setTotal(response.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Elenco non disponibile')
    } finally {
      setLoading(false)
    }
  }, [effective, offset, view])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadRows() }, [loadRows])

  const set = (patch: Partial<Filters>) => { setOffset(0); setFilters((f) => ({ ...f, ...patch })) }

  async function recompute() {
    setBusy(true)
    setNotice('')
    try {
      const response = await apiFetch<{ result: { scored: number } }>('/api/tourism/distribution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recompute' }),
      })
      setNotice(`Punteggi ricalcolati: ${response.result.scored.toLocaleString('it-IT')} aziende.`)
      await Promise.all([loadSummary(), loadRows()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ricalcolo non riuscito')
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    setBusy(true)
    try {
      const response = await apiFetch<{ rows: DistributionRow[] }>(
        `/api/tourism/distribution?${toQuery(effective, { export: 'json', limit: '5000' })}`,
      )
      const blob = new Blob([distributionCsv(response.rows)], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `speaqi-guides-distribuzione-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Esportazione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(row: DistributionRow, status: CommercialStatus, notes?: string) {
    try {
      await apiFetch('/api/tourism/distribution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', entity_id: row.entity_id, commercial_status: status, ...(notes !== undefined ? { notes } : {}) }),
      })
      const next = { ...row, commercial_status: status, notes: notes !== undefined ? notes : row.notes }
      setRows((current) => current.map((r) => (r.entity_id === row.entity_id ? next : r)))
      setOpen(next)
      loadSummary()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Stato non salvato')
    }
  }

  async function toCrm(ids: string[]) {
    if (!ids.length) return
    setBusy(true)
    setNotice('')
    try {
      const response = await apiFetch<{ results: { name: string; ok: boolean; message: string }[] }>('/api/tourism/distribution', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'to_crm', entity_ids: ids }),
      })
      const ok = response.results.filter((r) => r.ok).length
      const failed = response.results.filter((r) => !r.ok)
      setNotice(`${ok} in pipeline Distribuzione.${failed.length ? ` Non riusciti: ${failed.map((r) => `${r.name} (${r.message})`).join('; ')}` : ''} Nessuna email è partita.`)
      setSelected(new Set())
      await Promise.all([loadSummary(), loadRows()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passaggio al CRM non riuscito')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const typeOptions = useMemo(() => (summary?.by_type || []).map((t) => t.type), [summary])
  const gaps = useMemo(() => (summary ? coverageGaps(summary.matrix, ['tour_operator', 'dmc', 'property_manager', 'ota', 'travel_agency', 'ferry_operator'], 3) : []), [summary])

  return (
    <section className={d.root} aria-label="Speaqi Guides — Distribution Opportunities">
      <header className={d.head}>
        <div>
          <h2>Speaqi Guides — Distribution Opportunities</h2>
          <p>Chi può comprare, rivendere o distribuire le nove guide, in ordine di priorità. Il punteggio usa solo dati presenti: un dato ignoto vale «ignoto».</p>
        </div>
        <div className={d.actions}>
          <button onClick={recompute} disabled={busy}>Ricalcola punteggi</button>
          <button onClick={exportCsv} disabled={busy || view === 'dashboard'}>Esporta CSV</button>
        </div>
      </header>

      {(error || notice) && (
        <div className={error ? d.error : d.notice} role={error ? 'alert' : 'status'}>{error || notice}</div>
      )}

      <nav className={d.views} aria-label="Viste distribuzione">
        {([
          ['dashboard', 'Dashboard e copertura'],
          ['ranking', 'Classifica completa'],
          ['top100', 'Top 100 partner'],
          ['quick', 'Top 20 attivabili'],
        ] as [View, string][]).map(([key, label]) => (
          <button key={key} className={view === key ? d.activeView : ''} onClick={() => { setView(key); setOffset(0) }}>{label}</button>
        ))}
      </nav>

      {view !== 'dashboard' && (
        <div className={d.filters}>
          <input placeholder="Cerca nome o sito" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
          <select value={filters.slug} onChange={(e) => set({ slug: e.target.value })} aria-label="Destinazione">
            <option value="">Tutte le guide</option>
            {GUIDE_DESTINATIONS.map((g) => <option key={g.slug} value={g.slug}>{g.label}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => set({ type: e.target.value })} aria-label="Categoria">
            <option value="">Tutte le categorie</option>
            {typeOptions.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
          <select value={filters.country} onChange={(e) => set({ country: e.target.value })} aria-label="Paese">
            <option value="">Tutti i paesi</option>
            {(summary?.by_country || []).map((c) => <option key={c.country} value={c.country}>{c.country} ({c.ab})</option>)}
          </select>
          <select value={filters.tier} onChange={(e) => set({ tier: e.target.value })} aria-label="Tier" disabled={view === 'top100'}>
            <option value="">Tutti i tier</option>
            <option value="A,B">Tier A + B (qualificati)</option>
            {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </select>
          <select value={filters.model} onChange={(e) => set({ model: e.target.value })} aria-label="Modello commerciale">
            <option value="">Tutti i modelli</option>
            {MODELS.map((m) => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} aria-label="Stato commerciale">
            <option value="">Tutti gli stati</option>
            {COMMERCIAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          <select value={filters.contact} onChange={(e) => set({ contact: e.target.value })} aria-label="Contatti disponibili">
            <option value="">Contatti: tutti</option>
            <option value="email">Con email</option>
            <option value="phone">Con telefono</option>
            <option value="any">Con email o telefono</option>
            <option value="none">Senza contatti</option>
          </select>
          <select value={filters.volume} onChange={(e) => set({ volume: e.target.value })} aria-label="Volume potenziale">
            <option value="">Volume: tutti</option>
            {Object.entries(VOLUME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className={d.num} type="number" min={0} max={100} placeholder="Punteggio min." value={filters.min_score} onChange={(e) => set({ min_score: e.target.value })} />
          <label><input type="checkbox" checked={filters.strategic} onChange={(e) => set({ strategic: e.target.checked })} /> Strategici</label>
          <label><input type="checkbox" checked={filters.quick_win || view === 'quick'} disabled={view === 'quick'} onChange={(e) => set({ quick_win: e.target.checked })} /> Attivabili subito</label>
          <button onClick={() => { setFilters(EMPTY); setOffset(0) }}>Azzera filtri</button>
        </div>
      )}

      {view === 'dashboard' && summary && (
        <div className={d.dashboard}>
          <div className={d.cards}>
            <div><strong>{summary.total.toLocaleString('it-IT')}</strong><span>aziende valutate</span></div>
            <div><strong>{summary.qualified.toLocaleString('it-IT')}</strong><span>prospect qualificati (Tier A+B)</span></div>
            <div><strong>{summary.tiers.A || 0}</strong><span>Tier A</span></div>
            <div><strong>{summary.strategic}</strong><span>partner strategici</span></div>
            <div><strong>{summary.quick_wins}</strong><span>attivabili subito</span></div>
            <div><strong>{summary.with_email.toLocaleString('it-IT')}</strong><span>con email</span></div>
          </div>

          <h3>Copertura per guida</h3>
          <table className={d.table}>
            <thead><tr><th>Guida</th><th>Prospect</th><th>Tier A</th><th>Tier B</th><th>Attivabili subito</th><th>Con email</th></tr></thead>
            <tbody>
              {GUIDE_DESTINATIONS.map((g) => {
                const row = summary.by_slug.find((x) => x.slug === g.slug)
                return (
                  <tr key={g.slug} onClick={() => { setFilters({ ...EMPTY, slug: g.slug }); setView('ranking') }} className={d.clickable}>
                    <td>{g.label}</td><td>{row?.total || 0}</td><td>{row?.a || 0}</td><td>{row?.b || 0}</td><td>{row?.quick || 0}</td><td>{row?.with_email || 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <h3>Matrice destinazione × categoria (prospect Tier A+B / totali)</h3>
          <div className={d.scroll}>
            <table className={d.matrix}>
              <thead>
                <tr><th>Categoria</th>{GUIDE_DESTINATIONS.map((g) => <th key={g.slug}>{g.label}</th>)}</tr>
              </thead>
              <tbody>
                {summary.by_type.filter((t) => t.total >= 5).slice(0, 14).map((t) => (
                  <tr key={t.type}>
                    <th>{typeLabel(t.type)}</th>
                    {GUIDE_DESTINATIONS.map((g) => {
                      const cell = summary.matrix.find((c) => c.slug === g.slug && c.type === t.type)
                      const ab = cell?.ab || 0
                      return (
                        <td key={g.slug} className={ab >= 10 ? d.hot : ab >= 3 ? d.warm : ab > 0 ? d.cool : d.cold}
                            onClick={() => { setFilters({ ...EMPTY, slug: g.slug, type: t.type, tier: 'A,B' }); setView('ranking') }}>
                          {ab}/{cell?.total || 0}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Segmenti da esplorare</h3>
          <p className={d.hint}>Celle destinazione × categoria con meno di 3 prospect qualificati: è dove la ricerca va estesa per prima.</p>
          <ul className={d.gaps}>
            {gaps.slice(0, 18).map((g) => (
              <li key={`${g.slug}-${g.type}`}>{guideLabel(g.slug)} · {typeLabel(g.type)} — {g.ab} qualificati su {g.total}</li>
            ))}
          </ul>

          <h3>Paesi con più prospect qualificati</h3>
          <div className={d.chips}>
            {summary.by_country.slice(0, 20).map((c) => <span key={c.country}>{c.country} <b>{c.ab}</b></span>)}
          </div>

          <h3>Modelli commerciali consigliati (Tier A+B) e cosa supporta la piattaforma</h3>
          <table className={d.table}>
            <thead><tr><th>Modello</th><th>Prospect</th><th>Supporto oggi</th><th>Nota</th></tr></thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m}>
                  <td>{MODEL_LABELS[m]}</td><td>{summary.models[m] || 0}</td>
                  <td>{{ supported: 'Sì', partial: 'In parte', missing: 'No' }[MODEL_SUPPORT[m].level]}</td>
                  <td>{MODEL_SUPPORT[m].note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view !== 'dashboard' && (
        <>
          <div className={d.bar}>
            <span>{loading ? 'Carico…' : `${total.toLocaleString('it-IT')} risultati`}</span>
            {selected.size > 0 && (
              <button onClick={() => toCrm([...selected])} disabled={busy}>Porta {selected.size} in pipeline Distribuzione</button>
            )}
          </div>
          <table className={d.table}>
            <thead>
              <tr><th></th><th>Azienda</th><th>Categoria</th><th>Paese</th><th>Punteggio</th><th>Guide</th><th>Modello</th><th>Contatti</th><th>Stato</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entity_id} className={d.clickable} onClick={() => setOpen(r)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r.entity_id)} onChange={() => toggle(r.entity_id)} aria-label={`Seleziona ${r.entity.name}`} /></td>
                  <td>{r.entity.name}{r.strategic && <em className={d.tag}>strategico</em>}{r.quick_win && <em className={d.tagQuick}>subito</em>}</td>
                  <td>{typeLabel(r.entity.type_code)}</td>
                  <td>{r.entity.country_code}</td>
                  <td><b className={d[`tier${r.tier}`]}>{r.score}</b> <small>Tier {r.tier}</small></td>
                  <td>{r.guide_slugs.map(guideLabel).join(', ') || '—'}</td>
                  <td>{MODEL_LABELS[r.model]}</td>
                  <td>{[r.entity.email ? '✉' : '', r.entity.phone ? '☎' : '', r.entity.website ? '🌐' : ''].join(' ') || '—'}</td>
                  <td>{STATUS_LABELS[r.commercial_status]}</td>
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={9}>Nessun prospect con questi filtri.</td></tr>}
            </tbody>
          </table>
          {view === 'ranking' && total > PAGE && (
            <div className={d.pager}>
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Precedenti</button>
              <span>{offset + 1}–{Math.min(offset + PAGE, total)} di {total.toLocaleString('it-IT')}</span>
              <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Successivi →</button>
            </div>
          )}
        </>
      )}

      {open && (
        <aside className={d.detail} aria-label={`Dettaglio ${open.entity.name}`}>
          <button className={d.close} onClick={() => setOpen(null)} aria-label="Chiudi">×</button>
          <h3>{open.entity.name}</h3>
          <p>{typeLabel(open.entity.type_code)} · {open.entity.country_code} · punteggio <b>{open.score}</b> (Tier {open.tier}) · dati completi al {open.completeness}%</p>
          <ul className={d.parts}>
            {(Object.keys(SCORE_WEIGHTS) as ScoreComponent[]).map((key) => (
              <li key={key}>
                <span>{COMPONENT_LABELS[key]} <small>({SCORE_WEIGHTS[key]}%)</small></span>
                <div><i style={{ width: `${open.components[key] || 0}%` }} /></div>
                <b>{open.components[key] ?? 0}</b>
              </li>
            ))}
          </ul>
          <p><strong>Volume potenziale:</strong> {VOLUME_LABELS[open.volume_potential] || open.volume_potential}</p>
          <p><strong>Guide pertinenti:</strong> {open.guide_slugs.map(guideLabel).join(', ') || 'nessuna individuata'}</p>
          <p><strong>Modello consigliato:</strong> {MODEL_LABELS[open.model]} — {MODEL_SUPPORT[open.model].note}</p>
          {open.model_alt && <p><strong>Alternativa:</strong> {MODEL_LABELS[open.model_alt as CommercialModel]}</p>}
          <p>
            {open.entity.website && <a href={open.entity.website} target="_blank" rel="noopener noreferrer">{open.entity.website}</a>}
            {open.entity.email && <> · {open.entity.email}</>}
            {open.entity.phone && <> · {open.entity.phone}</>}
          </p>
          <label>
            Stato commerciale
            <select value={open.commercial_status} onChange={(e) => setStatus(open, e.target.value as CommercialStatus)}>
              {COMMERCIAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label>
            Note
            <textarea defaultValue={open.notes || ''} rows={3} onBlur={(e) => { if (e.target.value !== (open.notes || '')) setStatus(open, open.commercial_status, e.target.value) }} />
          </label>
          <button onClick={() => toCrm([open.entity_id])} disabled={busy}>Porta in pipeline Distribuzione (CRM)</button>
        </aside>
      )}
    </section>
  )
}
