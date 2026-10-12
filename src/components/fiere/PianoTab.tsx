'use client'

import { useEffect, useMemo, useState } from 'react'
import { buildVisitPlan } from '@/lib/trade-fair-plan'
import { FairExhibitor, STATUS_LABELS, TradeFairStatus, TTG_FLOOR_MAP } from '@/lib/trade-fair'
import ExhibitorDetail from './ExhibitorDetail'
import { downloadCsv, TYPE_SHORT } from './shared'

type Props = {
  rows: FairExhibitor[]
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
}

const STORAGE_KEY = 'speaqi.fiere.plan.done'

export default function PianoTab({ rows, showToast, onRowChange }: Props) {
  const [count, setCount] = useState(120)
  const [days, setDays] = useState(3)
  const [italyOnly, setItalyOnly] = useState(false)
  const [activeDay, setActiveDay] = useState(1)
  const [done, setDone] = useState<string[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]')
      if (Array.isArray(saved)) setDone(saved.map(String))
    } catch {
      /* nessuna preferenza salvata */
    }
  }, [])

  const plan = useMemo(() => buildVisitPlan(rows, count, days, { italyOnly }), [rows, count, days, italyOnly])
  const day = plan.days.find((d) => d.day === activeDay) || plan.days[0]
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])

  function toggle(key: string) {
    setDone((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignora */
      }
      return next
    })
  }

  function exportCsv() {
    downloadCsv('piano-visita-ttg-2026.csv', ['Giorno', 'Padiglione', 'Stand', 'Espositore', 'Priorità TTG', 'Tipologia', 'Paese', 'Stato', 'Fatto'],
      plan.days.flatMap((d) => d.stops.flatMap((stop) => stop.targets.map((t) => [
        d.day, stop.hall, stop.stand, t.name, t.ttg_priority_score ?? t.score, TYPE_SHORT[t.organization_type || ''] || '', t.country, STATUS_LABELS[t.status as TradeFairStatus], done.includes(stop.key) ? 'sì' : '',
      ]))))
  }

  const doneIn = (stops: { key: string }[]) => stops.filter((s) => done.includes(s.key)).length

  return (
    <>
      <p className="fx-hint">
        I {plan.targets.length} espositori migliori per Speaqi, raggruppati per padiglione e numero di stand, divisi in giorni. Spunta le tappe man mano che le fai.
        Stand collettivi = una tappa sola. I padiglioni con lo stesso numero (A3 e C3…) sono considerati vicini: è una mia ipotesi, controlla la <a href={TTG_FLOOR_MAP} target="_blank" rel="noopener noreferrer">mappa dei padiglioni</a>.
      </p>

      <div className="fx-days" role="tablist">
        {plan.days.map((d) => (
          <button key={d.day} type="button" role="tab" className="fx-day" aria-selected={day.day === d.day} onClick={() => setActiveDay(d.day)}>
            <b>Giorno {d.day}</b>
            <span>{d.stops.length === 0 ? 'nessuna tappa' : `${doneIn(d.stops)}/${d.stops.length} tappe · Pad. ${Array.from(new Set(d.stops.map((s) => s.hall.replace(/^Hall\s+/i, '')))).slice(0, 4).join(', ')}${new Set(d.stops.map((s) => s.hall)).size > 4 ? '…' : ''}`}</span>
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setShowSettings((v) => !v)}>Impostazioni</button>
      </div>

      {showSettings ? (
        <div className="fx-filters">
          <label className="fx-check">Quanti top <input className="fi" type="number" min={10} max={400} style={{ width: 80 }} value={count} onChange={(e) => setCount(Math.max(10, Math.min(400, Number(e.target.value) || 120)))} /></label>
          <label className="fx-check">Giorni <select className="fi" value={days} onChange={(e) => { setDays(Number(e.target.value)); setActiveDay(1) }}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="fx-check"><input type="checkbox" checked={italyOnly} onChange={(e) => setItalyOnly(e.target.checked)} /> Solo Italia</label>
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportCsv}>Esporta CSV</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => window.print()}>Stampa</button>
          {done.length ? <button className="btn-mini" type="button" onClick={() => { setDone([]); try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* ignora */ } }}>Azzera le spunte</button> : null}
        </div>
      ) : null}

      {day && day.stops.length === 0 ? <div className="fx-card fx-empty">Nessuna tappa: serve almeno un espositore in linea con padiglione e stand.</div> : null}

      <div style={{ display: 'grid', gap: 6 }}>
        {day?.stops.map((stop, index) => {
          const showHall = index === 0 || day.stops[index - 1].hall !== stop.hall
          const isDone = done.includes(stop.key)
          return (
            <div key={stop.key} style={{ display: 'grid', gap: 6 }}>
              {showHall ? <div className="fx-hall">Padiglione {stop.hall.replace(/^Hall\s+/i, '')} · {day.stops.filter((s) => s.hall === stop.hall).length === 1 ? '1 tappa' : `${day.stops.filter((s) => s.hall === stop.hall).length} tappe`}</div> : null}
              <div className="fx-stop" data-done={isDone}>
                <input type="checkbox" checked={isDone} onChange={() => toggle(stop.key)} aria-label={`Fatto: stand ${stop.stand}`} style={{ marginTop: 3 }} />
                <strong style={{ fontSize: 13 }}>Stand {stop.stand}</strong>
                <div style={{ display: 'grid', gap: 4 }}>
                  {stop.targets.map((t) => {
                    const full = rowById.get(t.id)
                    const open = openId === t.id
                    return (
                      <div key={t.id}>
                        <button type="button" className="btn-mini" style={{ textAlign: 'left', whiteSpace: 'normal' }} aria-expanded={open} onClick={() => setOpenId(open ? null : t.id)}>
                          {t.name}
                        </button>
                        <span className="fx-muted"> · {TYPE_SHORT[t.organization_type || '']}{t.country && !/^ital/i.test(t.country) ? ` · ${t.country}` : ''}{t.status !== 'new' ? ` · ${STATUS_LABELS[t.status as TradeFairStatus]}` : ''}</span>
                        {open && full ? <div style={{ marginTop: 6, border: '1px solid var(--border)', borderRadius: 8 }}><ExhibitorDetail row={full} showToast={showToast} onRowChange={onRowChange} /></div> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
