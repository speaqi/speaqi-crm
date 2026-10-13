'use client'

import { useMemo, useState } from 'react'
import { CLASS_META, FACTOR_DEFS, LeadClass } from '@/lib/opportunity-score'
import {
  compareByLocation, compareExhibitors, effectivePriority, FairExhibitor, FairFilter, filterExhibitors, followupState,
  standLabel, STATUS_LABELS, summarize, TRADE_FAIR_STATUSES, TradeFairStatus,
} from '@/lib/trade-fair'
import type { OutreachState } from '@/lib/trade-fair-outreach'
import ExhibitorDetail from './ExhibitorDetail'
import { formatDay, STATUS_COLORS, TYPE_SHORT } from './shared'

const PAGE_SIZE = 50

type Quick = 'new' | 'followup' | 'interested' | 'all'

type Props = {
  rows: FairExhibitor[]
  now: Date
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
  completeList?: boolean
}

export default function ElencoTab({ rows, now, showToast, onRowChange, completeList = false }: Props) {
  const defaultSort = completeList ? 'name' : 'priority'
  const [quick, setQuick] = useState<Quick>(completeList ? 'all' : 'new')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [extra, setExtra] = useState<FairFilter>({ priority: 'all' })
  const [sort, setSort] = useState<'priority' | 'stand' | 'name'>(completeList ? 'name' : 'priority')
  const [mailFilter, setMailFilter] = useState<'all' | 'selected' | 'prepared' | 'sent'>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [openId, setOpenId] = useState<string | null>(null)

  const summary = useMemo(() => summarize(rows, now), [rows, now])
  const halls = useMemo(() => Array.from(new Set(rows.map((r) => (r.hall || '').trim()).filter(Boolean))).sort(), [rows])
  const followups = useMemo(() => rows.filter((r) => ['overdue', 'today'].includes(followupState(r, now))).length, [rows, now])

  const filter: FairFilter = useMemo(() => {
    const base: FairFilter = { ...extra, search }
    if (quick === 'new') base.status = 'new'
    else if (quick === 'interested') base.status = 'interested'
    else if (quick === 'followup') { base.status = 'open'; base.onlyFollowup = true }
    else base.status = extra.status || 'all'
    // Chi cerca un nome lo vuole trovare qualunque sia il suo stato.
    if (search.trim() && quick !== 'followup') base.status = extra.status || 'all'
    return base
  }, [extra, search, quick])

  const visible = useMemo(
    () =>
      filterExhibitors(rows, filter, now)
        .filter((row) => {
          const o = (row.outreach || {}) as OutreachState
          if (mailFilter === 'selected') return Boolean(o.selected && !o.sent_at)
          if (mailFilter === 'prepared') return Boolean(o.subject && !o.sent_at)
          if (mailFilter === 'sent') return Boolean(o.sent_at)
          return true
        })
        .sort((a, b) => (sort === 'stand' ? compareByLocation(a, b) : sort === 'name' ? a.name.localeCompare(b.name) : compareExhibitors(a, b, now))),
    [rows, filter, now, sort, mailFilter]
  )

  const activeExtras = [extra.priority !== 'all', extra.leadClass && extra.leadClass !== 'all', extra.organizationType, extra.hall, extra.onlyWithContact, mailFilter !== 'all', sort !== defaultSort, quick === 'all' && extra.status && extra.status !== 'all'].filter(Boolean).length

  function setQuickAndReset(next: Quick) {
    setQuick(next)
    setLimit(PAGE_SIZE)
  }
  function setExtraAndReset(next: FairFilter) {
    setExtra(next)
    setLimit(PAGE_SIZE)
  }

  const chips: [Quick, string, number | null][] = [
    ['new', 'Da contattare', summary.toContact],
    ['followup', 'Da richiamare', followups],
    ['interested', 'Interessati', summary.interested],
    ['all', 'Tutti', summary.total],
  ]

  return (
    <>
      <div className="fx-bar">
        <input className="fi fx-search" placeholder="Cerca nome, stand, email, categoria…" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE) }} />
        <button type="button" className={`btn btn-sm ${showFilters || activeExtras ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowFilters((v) => !v)}>
          Filtri{activeExtras ? ` · ${activeExtras}` : ''}
        </button>
      </div>

      <div className="fx-chips" role="group" aria-label="Mostra">
        {chips.map(([id, label, count]) => (
          <button key={id} type="button" className="fx-chip" aria-pressed={quick === id} onClick={() => setQuickAndReset(id)}>
            {label}{count !== null ? ` · ${count}` : ''}
          </button>
        ))}
      </div>

      {showFilters ? (
        <div className="fx-filters">
          {quick === 'all' ? (
            <select className="fi" value={String(extra.status || 'all')} onChange={(e) => setExtraAndReset({ ...extra, status: e.target.value as FairFilter['status'] })}>
              <option value="all">Ogni stato</option>
              {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s as TradeFairStatus]}</option>)}
            </select>
          ) : null}
          <select className="fi" value={String(extra.priority || 'all')} onChange={(e) => setExtraAndReset({ ...extra, priority: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 2 | 3) })}>
            <option value="all">Ogni priorità</option><option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
          </select>
          <select className="fi" value={String(extra.leadClass || 'all')} onChange={(e) => setExtraAndReset({ ...extra, leadClass: e.target.value as FairFilter['leadClass'] })}>
            <option value="all">Ogni classe</option><option value="qualify">Da qualificare</option>
            {(Object.keys(CLASS_META) as LeadClass[]).map((c) => <option key={c} value={c}>{c} — {CLASS_META[c].label}</option>)}
          </select>
          <select className="fi" value={extra.organizationType || ''} onChange={(e) => setExtraAndReset({ ...extra, organizationType: e.target.value || undefined })}>
            <option value="">Ogni tipologia</option>
            {FACTOR_DEFS[0].options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select className="fi" value={extra.hall || ''} onChange={(e) => setExtraAndReset({ ...extra, hall: e.target.value || undefined })}>
            <option value="">Ogni padiglione</option>
            {halls.map((h) => <option key={h} value={h}>{h.replace(/^Hall\s+/i, 'Pad. ')}</option>)}
          </select>
          <select className="fi" value={mailFilter} onChange={(e) => { setMailFilter(e.target.value as typeof mailFilter); setLimit(PAGE_SIZE) }}>
            <option value="all">Email: tutte</option><option value="prepared">Email preparate</option><option value="selected">Email da inviare</option><option value="sent">Email inviate</option>
          </select>
          <select className="fi" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="priority">Ordine: migliori prima</option><option value="stand">Ordine: giro della fiera</option><option value="name">Ordine: nome</option>
          </select>
          <label className="fx-check"><input type="checkbox" checked={Boolean(extra.onlyWithContact)} onChange={(e) => setExtraAndReset({ ...extra, onlyWithContact: e.target.checked })} /> Solo con email o telefono</label>
          {activeExtras ? <button type="button" className="btn-mini" onClick={() => { setExtraAndReset({ priority: 'all' }); setMailFilter('all'); setSort(defaultSort) }}>Azzera filtri</button> : null}
        </div>
      ) : null}

      <div className="fx-muted">{visible.length} espositori{search ? ` per «${search}»` : ''}</div>

      {visible.length === 0 ? <div className="fx-card fx-empty">Nessun espositore con questi filtri.</div> : (
        <ul className="fx-list">
          {(completeList ? visible : visible.slice(0, limit)).map((row) => {
            const open = openId === row.id
            const follow = followupState(row, now)
            const o = (row.outreach || {}) as OutreachState
            const priority = effectivePriority(row)
            const mailLabel = o.sent_at ? '✉ inviata' : o.subject ? (o.selected ? '✉ da inviare' : '✉ esclusa') : ''
            return (
              <li key={row.id} className="fx-item" data-open={open} data-late={follow === 'overdue'}>
                <button type="button" className="fx-row" aria-expanded={open} onClick={() => setOpenId(open ? null : row.id)}>
                  <span className="fx-score" data-k={row.lead_class || priority} title={(row.score_explanation || []).join('\n') || undefined}>
                    {row.lead_class || Math.round(row.ttg_priority_score ?? row.score)}
                  </span>
                  <span>
                    <div className="fx-name">{row.name}</div>
                    <div className="fx-meta">
                      {row.organization_type ? <span>{TYPE_SHORT[row.organization_type]}</span> : null}
                      {row.country ? <span>· {row.country}</span> : null}
                      {row.contact_id ? <span>· ✅ nel CRM</span> : null}
                      {mailLabel ? <span>· {mailLabel}</span> : null}
                      {row.notes.length ? <span>· 📝 {row.notes.length}</span> : null}
                      {row.next_followup_at && follow !== 'none' ? <span style={{ color: follow === 'overdue' ? '#b91c1c' : undefined, fontWeight: follow === 'planned' ? 400 : 700 }}>· {follow === 'overdue' ? 'scaduto' : follow === 'today' ? 'oggi' : 'richiamo'} {formatDay(row.next_followup_at)}</span> : null}
                    </div>
                  </span>
                  {standLabel(row) ? <span className="fx-stand">{standLabel(row)}</span> : <span />}
                  <span className="fx-status" style={{ ['--st' as string]: STATUS_COLORS[row.status] }}>{STATUS_LABELS[row.status]}</span>
                </button>
                {open ? <ExhibitorDetail row={row} showToast={showToast} onRowChange={onRowChange} /> : null}
              </li>
            )
          })}
        </ul>
      )}

      {!completeList && visible.length > limit ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLimit((v) => v + PAGE_SIZE)}>Mostra altri ({visible.length - limit})</button> : null}
    </>
  )
}
