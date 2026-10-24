'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/components/layout/CRMContext'
import { formatEuroPlain } from '@/lib/command-center'
import {
  AGENT_OWNERS, OPPORTUNITY_PIPELINES, OPPORTUNITY_ROLES, OPPORTUNITY_STAGES, OWNER_LABELS, PIPELINE_LABELS, ROLE_LABELS, STAGE_LABELS,
  ownerLabel, type OpportunityPipeline, type OpportunityStage,
} from '@/lib/opportunities'
import type { DirectorPlan, PlanItem } from '@/lib/office/director-plan'
import type { OpportunityRow } from '@/lib/server/opportunities'
import styles from './opportunita.module.css'

type ListResponse = { rows: OpportunityRow[]; total: number; counts: Record<OpportunityPipeline, number>; stuck: number; to_activate: number }
const VIEWS = [['all', 'Tutte'], ['stuck', 'Ferme'], ['overdue', 'Scadute'], ['to_activate', 'Da attivare']] as const

const euro = (value: number | null | undefined) => value ? formatEuroPlain(Math.round(Number(value))) : '—'
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' }) : ''
const stageLabel = (stage: string) => STAGE_LABELS[stage as OpportunityStage] || stage
const dateInput = (iso: string | null | undefined) => iso ? new Date(iso).toISOString().slice(0, 10) : ''

function PlanList({ title, hint, rows }: { title: string; hint: string; rows: PlanItem[] }) {
  return <div className={styles.planCol}>
    <h3>{title} <span>{rows.length}</span></h3>
    {rows.length === 0 ? <p className={styles.muted}>{hint}</p> : <ol>{rows.map((row) => <li key={row.deal_id}>
      <Link href={`/scheda/${row.contact_id}`}><strong>{row.name}</strong>{row.organization && row.organization !== row.name ? ` · ${row.organization}` : ''}</Link>
      <small>{PIPELINE_LABELS[row.pipeline as OpportunityPipeline]} · {stageLabel(row.stage)}{row.value ? ` · ${euro(row.value)}` : ''}</small>
      <p>→ {row.next_step}{row.due ? ` (${day(row.due)})` : ''} — {row.owner}</p>
      {(row.stuck || row.reasons.length > 0 || row.missing.length > 0) && <small className={styles.why}>
        {row.stuck || row.reasons.slice(0, 2).join('; ')}{row.missing.length ? ` · manca: ${row.missing.join(', ')}` : ''}</small>}
    </li>)}</ol>}
  </div>
}

function Editor({ row, owners, onSaved, onClose }: { row: OpportunityRow; owners: string[]; onSaved: () => void; onClose: () => void }) {
  const { showToast } = useCRMContext()
  const [nextStep, setNextStep] = useState(row.next_step || '')
  const [due, setDue] = useState(dateInput(row.next_step_due))
  const [owner, setOwner] = useState(row.owner || '')
  const [stage, setStage] = useState(row.stage)
  const [mapRef, setMapRef] = useState(row.map_ref || '')
  const [value, setValue] = useState(row.potential_value ? String(row.potential_value) : '')
  const [source, setSource] = useState(row.potential_value_source || '')
  const [busy, setBusy] = useState(false)
  const vendite = row.pipeline === 'vendite'

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const patch: Record<string, unknown> = {
        next_step: nextStep || null, next_step_due: due ? new Date(`${due}T09:00:00`).toISOString() : null,
        owner: owner || null, map_ref: mapRef || null,
        potential_value: value ? Number(value.replace(',', '.')) : null, potential_value_source: source || null,
      }
      if (!vendite && stage !== row.stage) patch.stage = stage
      await apiFetch(`/api/opportunities/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      showToast('Opportunità aggiornata')
      onSaved()
    } catch (err) { showToast(err instanceof Error ? err.message : 'Salvataggio non riuscito') }
    finally { setBusy(false) }
  }

  return <form className={styles.editor} onSubmit={save}>
    <label className={styles.wide}>Prossimo passo<input className="fi" value={nextStep} maxLength={300} placeholder="Es. mandare la presentazione" onChange={(e) => setNextStep(e.target.value)} /></label>
    <label>Entro il<input className="fi" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
    <label>Responsabile<select className="fi" value={owner} onChange={(e) => setOwner(e.target.value)}>
      <option value="">Da assegnare</option>
      {owners.map((name) => <option key={name} value={name}>{name}</option>)}
      {AGENT_OWNERS.map((agent) => <option key={agent} value={agent}>{OWNER_LABELS[agent]}</option>)}
    </select></label>
    {vendite ? <p className={styles.muted}>Fase: {row.stage} (segue lo stato del contatto)</p>
      : <label>Fase<select className="fi" value={stage} onChange={(e) => setStage(e.target.value)}>
        {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
      </select></label>}
    <label>Guida collegata<input className="fi" value={mapRef} maxLength={120} placeholder="slug o nome della mappa" onChange={(e) => setMapRef(e.target.value)} /></label>
    <label>Valore potenziale (€)<input className="fi" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></label>
    <label>Da dove viene la stima<input className="fi" value={source} maxLength={200} placeholder="listino, camere, passeggeri…" onChange={(e) => setSource(e.target.value)} /></label>
    <div className={styles.actions}>
      <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Salvo…' : 'Salva'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Chiudi</button>
    </div>
  </form>
}

function NewOpportunity({ onCreated }: { onCreated: () => void }) {
  const { showToast } = useCRMContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; company: string | null }>>([])
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null)
  const [pipeline, setPipeline] = useState<OpportunityPipeline>('tourism')
  const [role, setRole] = useState('destinazione')
  const [nextStep, setNextStep] = useState('')
  const [due, setDue] = useState('')
  const [mapRef, setMapRef] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || query.trim().length < 2 || contact) { setResults([]); return }
    const timer = setTimeout(() => {
      void apiFetch<{ contacts: Array<{ id: string; name: string; company: string | null }> }>(`/api/command-center/search?q=${encodeURIComponent(query)}`)
        .then((res) => setResults(res.contacts || [])).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, open, contact])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!contact) return
    setBusy(true)
    try {
      await apiFetch('/api/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        contact_id: contact.id, pipeline, role, next_step: nextStep || null, map_ref: mapRef || null,
        next_step_due: due ? new Date(`${due}T09:00:00`).toISOString() : null, title: `${PIPELINE_LABELS[pipeline]} · ${contact.name}`,
      }) })
      showToast('Opportunità creata')
      setOpen(false); setContact(null); setQuery(''); setNextStep(''); setDue(''); setMapRef('')
      onCreated()
    } catch (err) { showToast(err instanceof Error ? err.message : 'Opportunità non creata') }
    finally { setBusy(false) }
  }

  if (!open) return <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>+ Nuova opportunità</button>
  return <form className={styles.newBox} onSubmit={create}>
    <div className={`${styles.wide} ${styles.field}`}><span>Contatto</span>
      {contact ? <span className={styles.picked}>{contact.name} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContact(null)}>Cambia</button></span>
        : <input className="fi" autoFocus aria-label="Cerca il contatto" value={query} placeholder="Cerca per nome, azienda, email" onChange={(e) => setQuery(e.target.value)} />}
      {!contact && results.length > 0 && <ul className={styles.results}>{results.slice(0, 6).map((r) =>
        <li key={r.id}><button type="button" onClick={() => setContact({ id: r.id, name: r.name })}>{r.name}{r.company ? ` · ${r.company}` : ''}</button></li>)}</ul>}
    </div>
    <label>Pipeline<select className="fi" value={pipeline} onChange={(e) => {
      const next = e.target.value as OpportunityPipeline
      setPipeline(next); setRole(next === 'tourism' ? 'destinazione' : next === 'distribuzione' ? 'distributore' : 'cliente_agenzia')
    }}>{OPPORTUNITY_PIPELINES.filter((p) => p !== 'vendite').map((p) => <option key={p} value={p}>{PIPELINE_LABELS[p]}</option>)}</select></label>
    <label>Ruolo<select className="fi" value={role} onChange={(e) => setRole(e.target.value)}>
      {OPPORTUNITY_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
    <label className={styles.wide}>Prossimo passo<input className="fi" value={nextStep} maxLength={300} onChange={(e) => setNextStep(e.target.value)} /></label>
    <label>Entro il<input className="fi" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
    <label>Guida collegata<input className="fi" value={mapRef} maxLength={120} onChange={(e) => setMapRef(e.target.value)} /></label>
    <div className={styles.actions}>
      <button className="btn btn-primary btn-sm" disabled={busy || !contact}>{busy ? 'Creo…' : 'Crea'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Annulla</button>
    </div>
  </form>
}

export default function OpportunitaPage() {
  const { teamMembers } = useCRMContext()
  const [data, setData] = useState<ListResponse | null>(null)
  const [plan, setPlan] = useState<DirectorPlan | null>(null)
  const [error, setError] = useState('')
  const [pipeline, setPipeline] = useState<string>('')
  const [view, setView] = useState<string>('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (pipeline) params.set('pipeline', pipeline)
    if (view !== 'all') params.set('view', view)
    if (q.trim()) params.set('q', q.trim())
    try { setData(await apiFetch<ListResponse>(`/api/opportunities?${params}`)); setError('') }
    catch (err) { setError(err instanceof Error ? err.message : 'Opportunità non disponibili') }
  }, [pipeline, view, q])
  const loadPlan = useCallback(async () => {
    try { setPlan((await apiFetch<{ plan: DirectorPlan }>('/api/opportunities/plan')).plan) } catch { setPlan(null) }
  }, [])
  useEffect(() => { const t = setTimeout(() => { void load() }, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])
  useEffect(() => { void loadPlan() }, [loadPlan])
  const refresh = () => { void load(); void loadPlan() }
  const owners = [...new Set((teamMembers || []).map((m) => m.name).filter(Boolean))]

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Solo titolare</p><h1>Opportunità</h1>
        <p>Vendite, Tourism, Distribuzione e Agency in un solo percorso: un responsabile e un prossimo passo con scadenza per ognuna.</p></div>
      <NewOpportunity onCreated={refresh} />
    </header>

    <section className={styles.plan} aria-label="Il piano di oggi">
      <h2>Il piano di oggi</h2>
      {plan ? <>
        <p className={styles.muted}>Opportunità aperte {plan.open} · ferme {plan.stuck}. Calcolato adesso su prove, valore, tempi e lavoro che manca.</p>
        <div className={styles.planGrid}>
          <PlanList title="Da lavorare" hint="Nessuna opportunità pronta: assegna un prossimo passo a quelle ferme." rows={plan.work} />
          <PlanList title="Da sbloccare" hint="Niente di fermo." rows={plan.unblock} />
          <PlanList title="Partner da attivare" hint="Nessun accordo firmato in attesa di attivazione." rows={plan.activate} />
        </div>
        {plan.maps.length > 0 && <p className={styles.maps}>Guide che servono a un’opportunità: {plan.maps.map((row) => `${row.map_ref} (${row.name})`).join(', ')}</p>}
      </> : <p className={styles.muted}>Calcolo il piano…</p>}
    </section>

    <div className={styles.filters}>
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={!pipeline} className={!pipeline ? styles.on : ''} onClick={() => setPipeline('')}>Tutte</button>
        {OPPORTUNITY_PIPELINES.map((p) => <button key={p} role="tab" aria-selected={pipeline === p} className={pipeline === p ? styles.on : ''} onClick={() => setPipeline(p)}>
          {PIPELINE_LABELS[p]} <span>{data?.counts?.[p] ?? ''}</span></button>)}
      </div>
      <div className={styles.tabs}>
        {VIEWS.map(([key, label]) => <button key={key} className={view === key ? styles.on : ''} onClick={() => setView(key)}>{label}
          {key === 'stuck' && data ? <span>{data.stuck}</span> : key === 'to_activate' && data ? <span>{data.to_activate}</span> : null}</button>)}
      </div>
      <input className="fi" value={q} placeholder="Cerca contatto, ente, guida" onChange={(e) => setQ(e.target.value)} />
    </div>

    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!data && !error && <p className={styles.muted}>Carico le opportunità…</p>}
    {data && <>
      <p className={styles.muted}>{data.total} opportunità{data.total > data.rows.length ? `, ne mostro ${data.rows.length}: restringi i filtri` : ''}. Prima le ferme, poi per scadenza.</p>
      <ul className={styles.list}>
        {data.rows.map((row) => {
          const overdue = row.next.due && Date.parse(row.next.due) < Date.now()
          return <li key={row.id} className={row.stuck ? styles.stuckRow : ''}>
            <button className={styles.row} onClick={() => setEditing(editing === row.id ? null : row.id)} aria-expanded={editing === row.id}>
              <span className={styles.who}><strong>{row.contact?.name || row.title}</strong><small>{row.entity_name || row.contact?.company || ''}</small></span>
              <span className={styles.badge} data-pipeline={row.pipeline}>{PIPELINE_LABELS[row.pipeline]}</span>
              <span>{stageLabel(row.stage)}{row.role ? <small>{ROLE_LABELS[row.role as keyof typeof ROLE_LABELS]}</small> : null}</span>
              <span className={styles.num}>{euro(row.value ?? row.potential_value)}</span>
              <span>{ownerLabel(row.owner) === 'Da assegnare' && row.contact?.responsible ? row.contact.responsible : ownerLabel(row.owner)}</span>
              <span className={overdue ? styles.overdue : ''}>{row.next.text || 'Nessun prossimo passo'}{row.next.due ? <small>{day(row.next.due)}</small> : null}</span>
            </button>
            {row.stuck && <p className={styles.stuckText}>{row.stuck}</p>}
            {editing === row.id && <Editor row={row} owners={owners} onSaved={() => { setEditing(null); refresh() }} onClose={() => setEditing(null)} />}
          </li>
        })}
      </ul>
    </>}
  </div>
}
