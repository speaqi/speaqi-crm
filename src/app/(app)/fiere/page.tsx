'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '../layout'
import { apiFetch } from '@/lib/api'
import { buildVisitPlan } from '@/lib/trade-fair-plan'
import { DAILY_OUTREACH_CAP, isOutreachAligned, OutreachState, TEMPLATE_LABELS } from '@/lib/trade-fair-outreach'
import { CLASS_META, evaluateExhibitor, FACTOR_DEFS, FactorKey, LeadClass, SOURCE_LABELS } from '@/lib/opportunity-score'
import {
  compareByLocation,
  compareExhibitors,
  effectivePriority,
  FairExhibitor,
  FairFilter,
  filterExhibitors,
  followupState,
  PRIORITY_LABELS,
  standLabel,
  standMapUrl,
  TTG_FLOOR_MAP,
  TTG_HOW_TO_GET_THERE,
  STATUS_LABELS,
  summarize,
  TRADE_FAIR_STATUSES,
  TradeFairStatus,
} from '@/lib/trade-fair'

// Espositori di una fiera da valutare, contattare e riprendere dopo l'evento.
const FAIR = 'ttg-2026'
const FAIR_LABEL = 'TTG Travel Experience 2026'
const PAGE_SIZE = 100

const PRIORITY_COLORS: Record<number, string> = { 1: '#16a34a', 2: '#d97706', 3: '#94a3b8' }
const STATUS_COLORS: Record<TradeFairStatus, string> = {
  new: '#64748b',
  contacted: '#4f6ef7',
  replied: '#0ea5e9',
  interested: '#16a34a',
  meeting: '#7c3aed',
  not_interested: '#b91c1c',
}

function formatDay(value: string | null) {
  if (!value) return ''
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function formatStamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export default function FierePage() {
  const { showToast } = useCRMContext()
  const [rows, setRows] = useState<FairExhibitor[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<FairFilter>({ status: 'open', priority: 'all' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [sort, setSort] = useState<'priority' | 'stand' | 'name'>('priority')
  const [topOnly, setTopOnly] = useState(false)
  const [showPlan, setShowPlan] = useState(false)
  const [planCount, setPlanCount] = useState(120)
  const [planDaysCount, setPlanDaysCount] = useState(3)
  const [planItalyOnly, setPlanItalyOnly] = useState(false)
  const [planDone, setPlanDone] = useState<string[]>([])
  const [showMail, setShowMail] = useState(false)
  const [mailBusy, setMailBusy] = useState(false)
  const [mailFilter, setMailFilter] = useState<'all' | 'selected' | 'prepared' | 'sent'>('all')
  const [mailDraft, setMailDraft] = useState<{ id: string; subject: string; body: string } | null>(null)
  const [outcomeDraft, setOutcomeDraft] = useState<{ id: string; next_step: string } | null>(null)
  const [draft, setDraft] = useState<{ id: string; email: string; phone: string; person: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ exhibitors: FairExhibitor[] }>(`/api/trade-fair-exhibitors?fair=${FAIR}`)
      setRows(response.exhibitors)
      setLoadError('')
      setNow(new Date())
      // Righe mai valutate (import o algoritmo nuovo): si calcola il SOS una volta e si ricarica.
      if (response.exhibitors.some((row) => !row.last_scored_at)) {
        apiFetch('/api/trade-fair-exhibitors/rescore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fair: FAIR }),
        })
          .then(() => apiFetch<{ exhibitors: FairExhibitor[] }>(`/api/trade-fair-exhibitors?fair=${FAIR}`))
          .then((fresh) => setRows(fresh.exhibitors))
          .catch(() => undefined)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare gli espositori')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tappe del piano gia' fatte: restano sul telefono, per postazione.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('speaqi.fiere.plan.done') || '[]')
      if (Array.isArray(saved)) setPlanDone(saved.map(String))
    } catch {
      /* nessuna preferenza salvata */
    }
  }, [])

  const summary = useMemo(() => summarize(rows || [], now), [rows, now])
  const halls = useMemo(
    () => Array.from(new Set((rows || []).map((row) => (row.hall || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  )
  const visible = useMemo(
    () =>
      filterExhibitors(rows || [], filter, now).filter((row) => {
        const o = (row.outreach || {}) as OutreachState
        if (mailFilter === 'selected') return Boolean(o.selected && !o.sent_at)
        if (mailFilter === 'prepared') return Boolean(o.subject && !o.sent_at)
        if (mailFilter === 'sent') return Boolean(o.sent_at)
        return true
      }).sort((a, b) =>
        sort === 'stand' ? compareByLocation(a, b) : sort === 'name' ? a.name.localeCompare(b.name) : compareExhibitors(a, b, now)
      ),
    [rows, filter, now, sort, mailFilter]
  )

  const plan = useMemo(
    () => (rows && showPlan ? buildVisitPlan(rows, planCount, planDaysCount, { italyOnly: planItalyOnly }) : null),
    [rows, showPlan, planCount, planDaysCount, planItalyOnly]
  )

  function togglePlanStop(key: string) {
    setPlanDone((current) => {
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      try {
        window.localStorage.setItem('speaqi.fiere.plan.done', JSON.stringify(next))
      } catch {
        /* ignora */
      }
      return next
    })
  }

  function exportPlanCsv() {
    if (!plan) return
    const header = ['Giorno', 'Padiglione', 'Stand', 'Espositore', 'Priorità TTG', 'Tipologia', 'Paese', 'Stato', 'Fatto']
    const lines = plan.days.flatMap((d) =>
      d.stops.flatMap((stop) =>
        stop.targets.map((t) =>
          [d.day, stop.hall, stop.stand, t.name, (t.ttg_priority_score ?? t.score), FACTOR_DEFS[0].options.find((o) => o.id === t.organization_type)?.label, t.country, STATUS_LABELS[t.status as TradeFairStatus], planDone.includes(stop.key) ? 'sì' : ''].map(csvCell).join(';')
        )
      )
    )
    const blob = new Blob(['﻿' + [header.map(csvCell).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `piano-visita-${FAIR}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const mailStats = useMemo(() => {
    const list = rows || []
    const o = (row: FairExhibitor) => (row.outreach || {}) as OutreachState
    return {
      aligned: list.filter(isOutreachAligned).length,
      prepared: list.filter((row) => o(row).subject && !o(row).sent_at).length,
      selected: list.filter((row) => o(row).selected && !o(row).sent_at).length,
      sent: list.filter((row) => o(row).sent_at).length,
    }
  }, [rows])

  const shown = topOnly ? visible.slice(0, 20) : visible

  async function mailRequest(path: string, payload: Record<string, unknown>) {
    setMailBusy(true)
    try {
      return await apiFetch<any>(`/api/trade-fair-exhibitors/outreach/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fair: FAIR, ...payload }),
      })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Operazione non riuscita')
      return null
    } finally {
      setMailBusy(false)
    }
  }

  async function prepareMails() {
    const preview = await mailRequest('prepare', { dry_run: true })
    if (!preview) return
    if (!window.confirm(`Preparo ${preview.aligned} email (${preview.duplicates} sono doppioni di indirizzo, non selezionate). Non invio nulla. Procedo?`)) return
    const done = await mailRequest('prepare', {})
    if (done) {
      showToast(`Preparate ${done.prepared} email: rivedile e deseleziona chi non vuoi`)
      await load()
    }
  }

  async function sendTest(ids?: string[]) {
    const done = await mailRequest('send', { mode: 'test', ...(ids ? { ids } : {}) })
    if (done) showToast(`Test inviato a ${done.to}: ${done.sent} email, controlla la casella`)
  }

  async function sendReal() {
    if (!window.confirm(`Invio ora fino a 20 email reali agli espositori selezionati (tetto ${DAILY_OUTREACH_CAP} al giorno), in ordine di priorità, dal tuo Gmail. Hai fatto il test privato? Procedo?`)) return
    const done = await mailRequest('send', { mode: 'send', confirm: true })
    if (done) {
      showToast(`Inviate ${done.sent}${done.failed ? `, ${done.failed} non riuscite (${(done.errors || []).join('; ')})` : ''}. Restano oggi: ${done.remaining_today}`)
      await load()
    }
  }

  async function saveMail(row: FairExhibitor) {
    if (!mailDraft || mailDraft.id !== row.id) return
    if (await patch(row.id, { outreach: { subject: mailDraft.subject, body: mailDraft.body } })) {
      setMailDraft(null)
      showToast('Email salvata')
    }
  }

  function setSelected(row: FairExhibitor, selected: boolean) {
    patch(row.id, { outreach: { selected } })
  }

  function setFilterAndReset(next: FairFilter) {
    setFilter(next)
    setLimit(PAGE_SIZE)
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const response = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      setRows((current) => (current || []).map((row) => (row.id === id ? response.exhibitor : row)))
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare')
      return false
    } finally {
      setBusyId(null)
    }
  }

  function draftFor(row: FairExhibitor) {
    return draft && draft.id === row.id
      ? draft
      : { id: row.id, email: row.email || '', phone: row.phone || '', person: row.contact_person || '' }
  }

  /** Salva i dati corretti allo stand; con `toCrm` l'espositore entra anche in pipeline con follow-up. */
  async function saveContactData(row: FairExhibitor, toCrm: boolean) {
    const d = draftFor(row)
    const email = d.email.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Email non valida')
    setBusyId(row.id)
    try {
      const saved = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, email, phone: d.phone.trim(), contact_person: d.person.trim() }),
      })
      let next = saved.exhibitor
      if (toCrm) {
        if (next.status === 'new') {
          const moved = await apiFetch<{ exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: row.id, status: 'contacted' }),
          })
          next = moved.exhibitor
        }
        const made = await apiFetch<{ created: boolean; exhibitor: FairExhibitor }>('/api/trade-fair-exhibitors/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        })
        next = made.exhibitor
        showToast(made.created ? 'Salvato e aggiunto al CRM: lo trovi nei follow-up' : 'Salvato, contatto già nel CRM aggiornato')
      } else {
        showToast('Dati salvati')
      }
      setRows((current) => (current || []).map((item) => (item.id === row.id ? next : item)))
      setDraft(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile salvare')
    } finally {
      setBusyId(null)
    }
  }

  async function addNote(row: FairExhibitor) {
    if (!noteDraft.trim()) return
    if (await patch(row.id, { note: noteDraft })) setNoteDraft('')
  }

  async function runImport() {
    if (!importText.trim()) return showToast('Incolla prima l\'elenco')
    setImporting(true)
    try {
      const result = await apiFetch<{ created: number; updated: number; skipped: number }>('/api/trade-fair-exhibitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fair: FAIR, text: importText }),
      })
      showToast(`Importati: ${result.created} nuovi, ${result.updated} aggiornati, ${result.skipped} scartati`)
      setImportText('')
      setShowImport(false)
      await load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile importare')
    } finally {
      setImporting(false)
    }
  }

  function exportCsv() {
    const header = ['Priorità', 'Classe', 'Affidabilità dati', 'SOS', 'TTG action', 'Priorità TTG', 'Azione consigliata', 'Tipologia', 'Punteggio', 'Espositore', 'Stato', 'Paese', 'Categoria', 'Padiglione', 'Stand', 'Email', 'Telefono', 'Sito', 'Primo contatto', 'Prossimo follow-up', 'Note']
    const lines = visible.map((row) =>
      [
        PRIORITY_LABELS[effectivePriority(row)], row.lead_class || 'Da qualificare', row.data_confidence, row.opportunity_score, row.ttg_action_score, row.ttg_priority_score, row.recommended_action, FACTOR_DEFS[0].options.find((o) => o.id === row.organization_type)?.label, row.score, row.name, STATUS_LABELS[row.status], row.country, row.category,
        row.hall, row.stand, row.email, row.phone, row.website, row.contacted_at?.slice(0, 10), row.next_followup_at,
        row.notes.map((note) => note.text).join(' | '),
      ].map(csvCell).join(';')
    )
    const blob = new Blob(['﻿' + [header.map(csvCell).join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `espositori-${FAIR}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function renderMailPanel(row: FairExhibitor, busy: boolean) {
    const o = (row.outreach || {}) as OutreachState
    if (!o.subject) return null
    const d = mailDraft && mailDraft.id === row.id ? mailDraft : { id: row.id, subject: o.subject || '', body: o.body || '' }
    const locked = Boolean(o.sent_at)
    return (
      <div style={{ display: 'grid', gap: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>✉ Email per {row.name}</strong>
          <span style={{ fontSize: 12, color: '#64748b' }}>{o.template ? TEMPLATE_LABELS[o.template as keyof typeof TEMPLATE_LABELS] : ''} · {o.lang === 'en' ? 'inglese' : 'italiano'} · a {row.email}</span>
          {o.sent_at ? <span style={{ fontSize: 12, fontWeight: 700 }}>Inviata {formatStamp(o.sent_at)}</span> : (
            <label style={{ fontSize: 13 }}><input type="checkbox" disabled={busy} checked={Boolean(o.selected)} onChange={(e) => setSelected(row, e.target.checked)} /> Invia questa email</label>
          )}
          {o.note ? <span style={{ fontSize: 12, color: '#92400e' }}>{o.note}</span> : null}
          {o.error ? <span style={{ fontSize: 12, color: '#b91c1c' }}>Errore: {o.error}</span> : null}
        </div>
        <input className="fi" value={d.subject} disabled={busy || locked} onChange={(e) => setMailDraft({ ...d, subject: e.target.value })} placeholder="Oggetto" />
        <textarea className="fi" rows={14} value={d.body} disabled={busy || locked} onChange={(e) => setMailDraft({ ...d, body: e.target.value })} />
        {!locked ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy || !mailDraft || mailDraft.id !== row.id} onClick={() => saveMail(row)}>Salva modifiche</button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy || mailBusy} onClick={() => sendTest([row.id])}>Invia test a me</button>
            <span style={{ fontSize: 12, color: '#64748b' }}>Tieni il footer con la riga «no grazie»: senza, l&apos;invio viene bloccato.</span>
          </div>
        ) : null}
      </div>
    )
  }

  function renderScorePanel(row: FairExhibitor, busy: boolean) {
    const ev = evaluateExhibitor(row)
    const flags = row.ttg_flags || {}
    const outcome = row.meeting_outcome || {}
    const outcomeNext = outcomeDraft && outcomeDraft.id === row.id ? outcomeDraft.next_step : outcome.next_step || ''
    const cls = ev.leadClass
    return (
      <div style={{ display: 'grid', gap: 10, background: '#f8fafc', borderRadius: 10, padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <strong style={{ fontSize: 13 }}>Speaqi Opportunity Score</strong>
          <span style={pill(cls ? CLASS_META[cls].color : '#92400e')}>
            {cls ? `${cls} — ${CLASS_META[cls].label} · ${ev.opportunityScore}` : `Da qualificare · provvisoria ${ev.provisionalClass}`}
          </span>
          <span style={{ fontSize: 12 }}>Affidabilità dati: <strong>{ev.confidence}</strong></span>
          <span style={{ fontSize: 12 }}>Azione TTG: <strong>{ev.ttgActionScore}/50</strong></span>
          <span style={{ fontSize: 12 }}>Priorità TTG: <strong>{ev.ttgPriorityScore}</strong></span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>→ {ev.recommendedAction}</span>
        </div>
        {ev.topFactors.length ? (
          <div style={{ fontSize: 12, color: '#475569' }}>
            Pesa di più: {ev.topFactors.map((f) => `${f.label} (${f.points}/${f.max})`).join(' · ')}
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 6 }}>
          {FACTOR_DEFS.map((def) => {
            const f = ev.factors.find((x) => x.key === def.key)!
            const manualChoice = row.sos_manual?.[def.key as FactorKey]?.option || ''
            return (
              <div key={def.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span style={{ flex: '0 0 190px' }} title={def.question}>{def.label}</span>
                <select className="fi" style={{ flex: '1 1 260px' }} disabled={busy} value={manualChoice}
                  onChange={(e) => patch(row.id, { sos_factor: { key: def.key, option: e.target.value || null } })}>
                  <option value="">{f.points === null ? 'Sconosciuto — da verificare' : `Dedotto: ${f.optionLabel}`}</option>
                  {def.options.map((o) => <option key={o.id} value={o.id}>{o.label} ({o.points})</option>)}
                </select>
                <span style={{ flex: '0 0 150px', color: '#64748b' }}>
                  {f.points === null ? `?/${def.max}` : `${f.points}/${def.max} · ${SOURCE_LABELS[f.source!]}`}
                </span>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
          {([['decision_maker_present', 'Decisore presente in fiera (+10)'], ['partner_intro', 'Introdotto da SNAV / partner (+10)'], ['existing_client', 'Cliente o partner già attivo']] as const).map(([flag, label]) => (
            <label key={flag}><input type="checkbox" disabled={busy} checked={Boolean(flags[flag])} onChange={(e) => patch(row.id, { ttg_flags: { [flag]: e.target.checked } })} /> {label}</label>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 6, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
          <strong style={{ fontSize: 12 }}>Dopo l&apos;incontro (servono a migliorare l&apos;algoritmo)</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <select className="fi" disabled={busy} value={outcome.interest || ''} onChange={(e) => patch(row.id, { meeting_outcome: { ...outcome, interest: e.target.value || null } })}>
              <option value="">Interesse: non registrato</option><option value="yes">Ha mostrato interesse</option><option value="maybe">Forse</option><option value="no">Nessun interesse</option>
            </select>
            <select className="fi" disabled={busy} value={outcome.budget_plausible === true ? 'yes' : outcome.budget_plausible === false ? 'no' : ''}
              onChange={(e) => patch(row.id, { meeting_outcome: { ...outcome, budget_plausible: e.target.value === '' ? null : e.target.value === 'yes' } })}>
              <option value="">Budget plausibile: non so</option><option value="yes">Budget / modello economico plausibile</option><option value="no">Nessun budget plausibile</option>
            </select>
            <input className="fi" style={{ flex: '1 1 220px' }} placeholder="Prossimo passo concordato" value={outcomeNext} disabled={busy}
              onChange={(e) => setOutcomeDraft({ id: row.id, next_step: e.target.value })}
              onBlur={() => outcomeDraft && outcomeDraft.id === row.id && outcomeDraft.next_step !== (outcome.next_step || '') && patch(row.id, { meeting_outcome: { ...outcome, next_step: outcomeDraft.next_step } })} />
          </div>
        </div>
        <details style={{ fontSize: 12, color: '#475569' }}>
          <summary style={{ cursor: 'pointer' }}>Spiegazione del punteggio e storico modifiche</summary>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>{ev.explanation.map((line) => <li key={line}>{line}</li>)}</ul>
          {(row.sos_history || []).slice(0, 10).map((h) => (
            <div key={`${h.at}${h.factor}`}>{formatStamp(h.at)} — {FACTOR_DEFS.find((d) => d.key === h.factor)?.label}: {h.from || 'dedotto'} → {h.to || 'dedotto'}</div>
          ))}
        </details>
      </div>
    )
  }

  const pill = (color: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: '#fff', background: color,
  })
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', minWidth: 130 }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 24, display: 'grid', gap: 16, alignContent: 'start' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>🎪 {FAIR_LABEL}</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
            Espositori da valutare, contattare e riprendere dopo la fiera. Il punteggio dice quanto somigliano a un cliente di Speaqi Maps.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a className="btn btn-ghost btn-sm" href={TTG_FLOOR_MAP} target="_blank" rel="noopener noreferrer">🗺️ Mappa padiglioni</a>
          <a className="btn btn-ghost btn-sm" href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">🚇 Come arrivare</a>
          <button className={`btn btn-sm ${showPlan ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => setShowPlan((v) => !v)}>🗺️ Piano di visita</button>
          <button className={`btn btn-sm ${showMail ? 'btn-primary' : 'btn-ghost'}`} type="button" onClick={() => setShowMail((v) => !v)}>✉ Mailing</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportCsv} disabled={!visible.length}>Esporta CSV</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={() => setShowImport((v) => !v)}>
            {showImport ? 'Chiudi importazione' : 'Importa elenco'}
          </button>
        </div>
      </header>

      {showImport ? (
        <section style={{ ...card, display: 'grid', gap: 8 }}>
          <strong>Importa gli espositori</strong>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            Incolla una tabella (da Excel, CSV o copiata dal sito) con intestazione: Espositore, Paese, Categoria, Padiglione, Stand, Sito, Email, Telefono, Descrizione.
            Senza intestazione, una riga = un nome. Reimportare aggiorna i dati ma non tocca stato, note e follow-up.
          </span>
          <textarea className="fi" rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'Espositore;Paese;Categoria;Stand\nHotel Sole;Italia;Hotel e resort;B12'} />
          <div>
            <button className="btn btn-primary btn-sm" type="button" onClick={runImport} disabled={importing}>
              {importing ? 'Importo…' : 'Importa'}
            </button>
          </div>
        </section>
      ) : null}

      {showPlan && plan ? (
        <section style={{ ...card, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <strong>🗺️ Piano di visita: i migliori, per padiglione</strong>
            <label style={{ fontSize: 13 }}>Top <input className="fi" type="number" min={10} max={400} style={{ width: 80 }} value={planCount} onChange={(e) => setPlanCount(Math.max(10, Math.min(400, Number(e.target.value) || 120)))} /></label>
            <label style={{ fontSize: 13 }}>Giorni <select className="fi" value={planDaysCount} onChange={(e) => setPlanDaysCount(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={planItalyOnly} onChange={(e) => setPlanItalyOnly(e.target.checked)} /> Solo Italia</label>
            <button className="btn btn-ghost btn-sm" type="button" onClick={exportPlanCsv}>Esporta CSV</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => window.print()}>Stampa</button>
          </div>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            {plan.targets.length} espositori in {plan.stops.length} tappe (gli stand collettivi sono una tappa sola, con più espositori dentro).
            I padiglioni con lo stesso numero (A3 e C3…) sono considerati affiancati; dentro il padiglione l&apos;ordine segue il numero dello stand.
            Questa è la mia ipotesi sulla vicinanza: controlla la «Mappa padiglioni» in alto.
            Tempo indicativo: 6–8 minuti a tappa.
          </span>
          {plan.days.map((d) => (
            <div key={d.day} style={{ display: 'grid', gap: 6 }}>
              <strong style={{ fontSize: 15 }}>Giorno {d.day} · {d.stops.length} tappe · {Array.from(new Set(d.stops.map((s) => s.hall))).join(' → ')} · {planDone.filter((k) => d.stops.some((s) => s.key === k)).length}/{d.stops.length} fatte</strong>
              {d.stops.map((stop, index) => {
                const showHall = index === 0 || d.stops[index - 1].hall !== stop.hall
                const done = planDone.includes(stop.key)
                return (
                  <div key={stop.key}>
                    {showHall ? <div style={{ fontSize: 12, fontWeight: 700, color: '#3730a3', margin: '6px 0 2px' }}>Padiglione {stop.hall.replace(/^Hall\s+/i, '')}</div> : null}
                    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: done ? '#f1f5f9' : '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', opacity: done ? 0.6 : 1 }}>
                      <input type="checkbox" checked={done} onChange={() => togglePlanStop(stop.key)} style={{ marginTop: 3 }} />
                      <span style={{ flex: '0 0 130px', fontWeight: 700, fontSize: 13 }}>📍 Stand {stop.stand}</span>
                      <span style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                        {stop.targets.map((t) => (
                          <span key={t.id}>
                            <button type="button" className="btn-mini" style={{ textAlign: 'left' }}
                              onClick={(e) => { e.preventDefault(); setShowPlan(false); setFilterAndReset({ status: 'all', priority: 'all', search: t.name }); setOpenId(t.id) }}>
                              {t.name}
                            </button>
                            <span style={{ color: '#64748b', fontSize: 12 }}> · {Math.round(t.ttg_priority_score ?? t.score)}{t.country && !/^ital/i.test(t.country) ? ` · ${t.country}` : ''}{t.status !== 'new' ? ` · ${STATUS_LABELS[t.status as TradeFairStatus]}` : ''}</span>
                          </span>
                        ))}
                      </span>
                    </label>
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      ) : null}

      {showMail && rows ? (
        <section style={{ ...card, display: 'grid', gap: 10 }}>
          <strong>✉ Mailing agli espositori in linea con Speaqi</strong>
          <span style={{ fontSize: 13, color: '#64748b' }}>
            Selezione automatica: enti del turismo, consorzi, DMC, tour operator, navigazione, catene alberghiere e attrazioni, con email e ancora da contattare.
            Ogni email è scritta per la sua tipologia (in inglese per l&apos;estero), con stand, footer Speaqi e riga di disiscrizione. Parte dal tuo Gmail, le risposte arrivano nella tua casella.
            Rivedi, correggi o deseleziona dalla scheda di ogni espositore; filtra con «Mailing».
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13 }}>
            <span><strong>{mailStats.aligned}</strong> in linea</span>
            <span><strong>{mailStats.prepared}</strong> preparate</span>
            <span><strong>{mailStats.selected}</strong> selezionate da inviare</span>
            <span><strong>{mailStats.sent}</strong> inviate</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-primary btn-sm" type="button" disabled={mailBusy} onClick={prepareMails}>1 · Prepara le email</button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={mailBusy || !mailStats.prepared} onClick={() => sendTest()}>2 · Test privato: 3 email a me</button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={mailBusy || !mailStats.selected} onClick={sendReal}>3 · Invia le selezionate (max 20 per volta)</button>
            {mailBusy ? <span style={{ fontSize: 13 }}>Un attimo…</span> : null}
          </div>
        </section>
      ) : null}

      {loadError ? <div style={{ color: '#b91c1c' }}>{loadError}</div> : null}
      {rows === null && !loadError ? <div>Caricamento…</div> : null}

      {rows && rows.length === 0 ? (
        <section style={card}>Nessun espositore ancora: usa «Importa elenco» per caricare quelli della fiera.</section>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              ['Espositori', summary.total, () => setFilterAndReset({ status: 'all', priority: 'all' })],
              ['Da contattare', summary.toContact, () => setFilterAndReset({ status: 'new', priority: 'all' })],
              ['…di priorità alta', summary.highToContact, () => setFilterAndReset({ status: 'new', priority: 1 })],
              ['Già contattati', summary.contacted, () => setFilterAndReset({ status: 'open', priority: 'all' })],
              ['Follow-up scaduti', summary.overdue, () => setFilterAndReset({ status: 'open', priority: 'all', onlyFollowup: true })],
              ['Interessati', summary.interested, () => setFilterAndReset({ status: 'interested', priority: 'all' })],
            ].map(([label, value, onClick]) => (
              <button key={label as string} type="button" style={{ ...card, textAlign: 'left', cursor: 'pointer' }} onClick={onClick as () => void}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{value as number}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{label as string}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input className="fi" style={{ minWidth: 220 }} placeholder="Cerca nome, stand, email, categoria…" value={filter.search || ''}
              onChange={(e) => setFilterAndReset({ ...filter, search: e.target.value })} />
            <select className="fi" value={String(filter.status || 'all')} onChange={(e) => setFilterAndReset({ ...filter, status: e.target.value as FairFilter['status'] })}>
              <option value="all">Tutti gli stati</option>
              <option value="open">Aperti (non scartati)</option>
              {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <select className="fi" value={String(filter.priority || 'all')} onChange={(e) => setFilterAndReset({ ...filter, priority: e.target.value === 'all' ? 'all' : (Number(e.target.value) as 1 | 2 | 3) })}>
              <option value="all">Ogni priorità</option>
              <option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
            </select>
            <select className="fi" value={String(filter.leadClass || 'all')} onChange={(e) => setFilterAndReset({ ...filter, leadClass: e.target.value as FairFilter['leadClass'] })}>
              <option value="all">Ogni classe</option>
              <option value="qualify">Da qualificare</option>
              {(Object.keys(CLASS_META) as LeadClass[]).map((c) => <option key={c} value={c}>{c} — {CLASS_META[c].label}</option>)}
            </select>
            <select className="fi" value={filter.organizationType || ''} onChange={(e) => setFilterAndReset({ ...filter, organizationType: e.target.value || undefined })}>
              <option value="">Ogni tipologia</option>
              {FACTOR_DEFS[0].options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <select className="fi" value={filter.hall || ''} onChange={(e) => setFilterAndReset({ ...filter, hall: e.target.value || undefined })}>
              <option value="">Tutti i padiglioni</option>
              {halls.map((hall) => <option key={hall} value={hall}>{hall.replace(/^Hall\s+/i, 'Pad. ')}</option>)}
            </select>
            <select className="fi" value={mailFilter} onChange={(e) => setMailFilter(e.target.value as typeof mailFilter)}>
              <option value="all">Mailing: tutti</option>
              <option value="prepared">Mailing: preparate</option>
              <option value="selected">Mailing: selezionate</option>
              <option value="sent">Mailing: inviate</option>
            </select>
            <select className="fi" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="priority">Ordina: da contattare per primi</option>
              <option value="stand">Ordina: giro della fiera (padiglione e stand)</option>
              <option value="name">Ordina: nome</option>
            </select>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={Boolean(filter.onlyFollowup)} onChange={(e) => setFilterAndReset({ ...filter, onlyFollowup: e.target.checked })} /> Follow-up da fare</label>
            <label style={{ fontSize: 13 }}><input type="checkbox" checked={Boolean(filter.onlyWithContact)} onChange={(e) => setFilterAndReset({ ...filter, onlyWithContact: e.target.checked })} /> Con email o telefono</label>
            <button type="button" className={`btn btn-sm ${topOnly ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTopOnly((v) => !v)}>🎯 Top 20 da incontrare</button>
            <span style={{ fontSize: 13, color: '#64748b' }}>{shown.length} risultati</span>
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {shown.slice(0, limit).map((row) => {
              const priority = effectivePriority(row)
              const follow = followupState(row, now)
              const open = openId === row.id
              const busy = busyId === row.id
              return (
                <li key={row.id} style={{ background: '#fff', border: `1px solid ${follow === 'overdue' ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }} onClick={() => setOpenId(open ? null : row.id)}>
                    <span style={pill(row.lead_class ? CLASS_META[row.lead_class].color : PRIORITY_COLORS[priority])}
                      title={(row.score_explanation || []).join('\n') || 'Non ancora valutato'}>
                      {row.lead_class ? `${row.lead_class} · ${row.opportunity_score}` : `${PRIORITY_LABELS[priority]}? · ${Math.round(row.ttg_priority_score ?? row.score)}`}
                    </span>
                    {!row.lead_class && row.last_scored_at ? <span title="Dati insufficienti: aprilo e compila i criteri" style={{ fontSize: 11, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '2px 6px' }}>da qualificare</span> : null}
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {[row.country, row.category].filter(Boolean).join(' · ')}
                      </div>
                    </div>
 {standLabel(row) ? <span style={{ fontSize: 12, fontWeight: 700, background: '#eef2ff', color: '#3730a3', borderRadius: 6, padding: '2px 8px' }}>📍 {standLabel(row)}</span> : null}
                    {row.outreach?.sent_at ? <span title={`Email inviata ${formatStamp(row.outreach.sent_at)}`} style={{ fontSize: 12 }}>✉ inviata</span>
                      : row.outreach?.subject ? <span title="Email preparata" style={{ fontSize: 12, color: row.outreach.selected ? '#16a34a' : '#94a3b8' }}>✉ {row.outreach.selected ? 'da inviare' : 'esclusa'}</span> : null}
                    {row.contact_id ? <span title="Già nel CRM" style={{ fontSize: 12 }}>✅ CRM</span> : null}
                    {row.notes.length ? <span title="Note" style={{ fontSize: 12 }}>📝 {row.notes.length}</span> : null}
                    {row.next_followup_at && follow !== 'none' ? (
                      <span style={{ fontSize: 12, color: follow === 'overdue' ? '#b91c1c' : '#475569', fontWeight: follow === 'planned' ? 400 : 700 }}>
                        {follow === 'overdue' ? '⚠ scaduto ' : follow === 'today' ? '⏰ oggi ' : '↻ '}{formatDay(row.next_followup_at)}
                      </span>
                    ) : null}
                    <span style={pill(STATUS_COLORS[row.status])}>{STATUS_LABELS[row.status]}</span>
                  </div>

                  {open ? (
                    <div style={{ borderTop: '1px solid #e2e8f0', padding: 14, display: 'grid', gap: 12 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                        <select className="fi" value={row.status} disabled={busy} onChange={(e) => patch(row.id, { status: e.target.value })}>
                          {TRADE_FAIR_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                        </select>
                        <select className="fi" value={row.priority ?? ''} disabled={busy} onChange={(e) => patch(row.id, { priority: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">Priorità automatica ({PRIORITY_LABELS[effectivePriority({ priority: null, score: row.score })]})</option>
                          <option value="1">Alta</option><option value="2">Media</option><option value="3">Bassa</option>
                        </select>
                        <label style={{ fontSize: 13 }}>
                          Follow-up{' '}
                          <input className="fi" type="date" value={row.next_followup_at || ''} disabled={busy} onChange={(e) => patch(row.id, { next_followup_at: e.target.value || null })} />
                        </label>
                        {row.contacted_at ? <span style={{ fontSize: 12, color: '#64748b' }}>Primo contatto {formatStamp(row.contacted_at)}</span> : null}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13, alignItems: 'center' }}>
                        {standLabel(row) ? <strong>📍 {standLabel(row)}</strong> : <span style={{ color: '#64748b' }}>Stand non indicato</span>}
                        <a href={standMapUrl(row)} target="_blank" rel="noopener noreferrer">🗺️ Mappa e percorso allo stand</a>
                        <a href={TTG_HOW_TO_GET_THERE} target="_blank" rel="noopener noreferrer">🚇 Come arrivare in fiera</a>
                        {row.source_url ? <a href={row.source_url} target="_blank" rel="noopener noreferrer">Scheda sul sito della fiera</a> : null}
                        {row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer">🌐 Sito</a> : null}
                      </div>

                      <div style={{ display: 'grid', gap: 8, background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                        <strong style={{ fontSize: 13 }}>Contatto preso allo stand</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {([['person', 'Con chi hai parlato'], ['email', 'Email corretta'], ['phone', 'Telefono']] as const).map(([field, label]) => (
                            <input key={`${row.id}-${field}`} className="fi" style={{ flex: '1 1 200px' }} placeholder={label}
                              type={field === 'email' ? 'email' : 'text'} inputMode={field === 'email' ? 'email' : undefined}
                              value={draftFor(row)[field]} disabled={busy}
                              onChange={(e) => setDraft({ ...draftFor(row), [field]: e.target.value })} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => saveContactData(row, true)}>
                            {row.contact_id ? '💾 Salva e aggiorna il contatto nel CRM' : '➕ Salva e aggiungi al CRM (da ricontattare)'}
                          </button>
                          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => saveContactData(row, false)}>Solo salva</button>
                          {row.contact_id ? <Link className="btn btn-ghost btn-sm" href={`/contacts/${row.contact_id}`}>Apri contatto →</Link> : null}
                          {row.email ? <a className="btn btn-ghost btn-sm" href={`mailto:${row.email}`}>✉ Scrivi</a> : null}
                          {row.phone ? <a className="btn btn-ghost btn-sm" href={`tel:${row.phone}`}>📞 Chiama</a> : null}
                        </div>
                        <span style={{ fontSize: 12, color: '#64748b' }}>
                          «Aggiungi al CRM» crea il contatto in pipeline con follow-up per domani (o la data impostata sopra) e segna l&apos;espositore come contattato.
                        </span>
                      </div>

                      {row.description ? <p style={{ margin: 0, fontSize: 13, color: '#475569' }}>{row.description}</p> : null}
                      {renderMailPanel(row, busy)}
                      {renderScorePanel(row, busy)}

                      <div style={{ display: 'grid', gap: 6 }}>
                        <strong style={{ fontSize: 13 }}>Note</strong>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <textarea className="fi" rows={2} style={{ flex: 1 }} placeholder="Cosa vi siete detti, cosa promettere, chi richiamare…" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} />
                          <button className="btn btn-primary btn-sm" type="button" disabled={busy || !noteDraft.trim()} onClick={() => addNote(row)}>Aggiungi</button>
                        </div>
                        {row.notes.map((note) => (
                          <div key={note.id} style={{ fontSize: 13, background: '#f8fafc', borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                            <span><span style={{ color: '#64748b' }}>{formatStamp(note.at)} — </span>{note.text}</span>
                            <button type="button" className="btn-mini" disabled={busy} onClick={() => patch(row.id, { delete_note_id: note.id })}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>

          {shown.length > limit ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setLimit((v) => v + PAGE_SIZE)}>
              Mostra altri ({shown.length - limit})
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
