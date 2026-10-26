'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { formatEuroPlain } from '@/lib/command-center'
import { OFFICE_DEPARTMENTS, OFFICE_RUN_LABELS, officeApprovalEffect, type OfficeOverview, type OfficeRun } from '@/lib/office'
import { PIPELINE_LABELS, STAGE_LABELS, type OpportunityStage } from '@/lib/opportunities'
import type { DirectorPlan, PlanItem } from '@/lib/office/director-plan'
import { CONTACT_HIDDEN_KEYS, OutputBody } from '@/components/office/OutputBody'
import { DirectorOrders } from './agenti/DirectorOrders'
import { WorkList } from '@/components/office/WorkList'
import { AgentActivity } from '@/components/office/AgentActivity'
import { officeAgentActivity } from '@/lib/office-activity'
import styles from './ufficio.module.css'

export type PanelTab = 'waiting' | 'team' | 'plan' | 'work'
type Agent = OfficeOverview['agents'][number]

const euro = (cents: number) => formatEuroPlain(cents / 100)
const date = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const day = (value: string) => new Date(value).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' })

/** Lo stato come lo disegna la scena: lo stesso pallino nel 3D e qui. */
function PlanList({ title, rows, extra }: { title: string; rows: PlanItem[]; extra?: (row: PlanItem) => string | null }) {
  return <section className={styles.planList}>
    <h3>{title} <span>{rows.length}</span></h3>
    {rows.length === 0 ? <p className={styles.muted}>Niente qui.</p> : <ol>{rows.map((row) => <li key={row.deal_id}>
      <Link href={`/scheda/${row.contact_id}`}><strong>{row.name}</strong></Link>
      <small>{PIPELINE_LABELS[row.pipeline as keyof typeof PIPELINE_LABELS] || row.pipeline} · {STAGE_LABELS[row.stage as OpportunityStage] || row.stage}{row.value ? ` · ${formatEuroPlain(Math.round(row.value))}` : ''}</small>
      <p>→ {row.next_step}{row.due ? ` (${day(row.due)})` : ''} — {row.owner}</p>
      {(extra?.(row) || row.reasons[0] || row.missing.length > 0) && <small className={styles.why}>{extra?.(row) || [row.reasons[0], row.missing.length ? `manca: ${row.missing.join(', ')}` : null].filter(Boolean).join(' · ')}</small>}
    </li>)}</ol>}
  </section>
}

/**
 * Il pannello dell'Ufficio: tutto quello che si fa senza cambiare pagina.
 * Parlare al Direttore, decidere le proposte, accendere e far girare gli agenti, il piano di oggi.
 * Budget, impostazioni e storico completo restano in /ufficio/agenti, raggiungibili da qui.
 */
export function OfficePanel({ data, reload, tab, setTab, department, setDepartment, highlight, selectedAgentId, selectAgent }: {
  data: OfficeOverview | null; reload: () => Promise<void>
  tab: PanelTab; setTab: (tab: PanelTab) => void
  department: string | null; setDepartment: (id: string | null) => void
  /** Uscita da mostrare per prima (clic su «Aspetta te» nel 3D). */
  highlight: string | null
  selectedAgentId: string | null; selectAgent: (id: string | null) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<DirectorPlan | null>(null)
  const [planError, setPlanError] = useState('')

  const loadPlan = useCallback(async () => {
    try { const result = await apiFetch<{ plan: DirectorPlan }>('/api/opportunities/plan'); setPlan(result.plan); setPlanError('') }
    catch (err) { setPlanError(err instanceof Error ? err.message : 'Piano non disponibile') }
  }, [])
  useEffect(() => { if (tab === 'plan') void loadPlan() }, [tab, loadPlan])
  useEffect(() => {
    if (!highlight) return
    document.getElementById(`pannello-uscita-${highlight}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [highlight, tab, data])

  async function act(id: string, action: () => Promise<string | void>) {
    setBusy(id); setError(''); setNotice('')
    try { const message = await action(); if (message) setNotice(message); await reload() }
    catch (err) { setError(err instanceof Error ? err.message : 'Operazione non riuscita') }
    finally { setBusy(null) }
  }
  const patchAgent = (id: string, patch: Record<string, unknown>) => apiFetch(`/api/office/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  const toggle = (agent: Agent) => act(agent.id, async () => { await patchAgent(agent.id, { enabled: !agent.enabled }); return `${agent.name} ${agent.enabled ? 'spento' : 'acceso'}.` })
  const run = (agent: Agent) => act(agent.id, async () => {
    // Una chiave per clic: ripetere la stessa richiesta non raddoppia la corsa.
    const result = await apiFetch<{ run: OfficeRun | null; error?: string; skipped?: string; queued?: boolean; summary?: string }>(`/api/office/agents/${encodeURIComponent(agent.id)}/run-now`, {
      method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    })
    if (result.error) throw new Error(result.error)
    return result.queued ? result.summary || 'Incarico salvato: seguilo nella scheda Lavori.'
      : result.skipped ? 'Turno saltato: corsa già presente o agente spento.' : result.run?.summary || 'Corsa conclusa.'
  })
  const decide = (id: string, status: 'approved' | 'rejected') => act(id, async () => {
    const output = data?.outputs.find((item) => item.id === id)
    const result = await apiFetch<{ notice?: string }>(`/api/office/outputs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    return result?.notice || (status === 'approved' && output ? officeApprovalEffect(output).notice : 'Proposta rifiutata.')
  })
  const telegram = (id: string) => act(id, async () => {
    const result = await apiFetch<{ sent: boolean }>(`/api/office/outputs/${id}/telegram`, { method: 'POST' })
    return result.sent ? 'Approvata e inviata su Telegram.' : 'Tentativo già registrato: nessun nuovo invio.'
  })

  if (!data) return <aside className={styles.panel}><p className={styles.muted}>Carico l’ufficio…</p></aside>
  const director = data.agents.find((agent) => agent.id === 'director')
  const agents = department ? data.agents.filter((agent) => agent.department === department) : data.agents
  const outputs = [...data.outputs].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0))
  const agentName = (id: string) => data.agents.find((agent) => agent.id === id)?.name || id
  const selectedAgent = data.agents.find((agent) => agent.id === selectedAgentId)

  return <aside className={styles.panel} aria-label="Gestione dell’ufficio">
    <div className={styles.totals}>
      <span><strong>{data.active_agents}</strong>/{data.agents.length} agenti accesi</span>
      <span>Oggi <strong>{euro(data.totals.day_actual)}</strong></span>
      <span>Mese <strong>{euro(data.totals.month_actual)}</strong></span>
      <button type="button" className={styles.refresh} disabled={!!busy} onClick={() => { void act('refresh', async () => {}) }}>↻ Aggiorna</button>
    </div>

    {selectedAgent && <AgentActivity key={selectedAgent.id} agent={selectedAgent} overview={data}
      onClose={() => selectAgent(null)} onChanged={() => { void reload() }} />}

    <DirectorOrders compact directorEnabled={!!director?.enabled} onChanged={() => { void reload() }}
      onEnable={() => act('director', async () => { await patchAgent('director', { enabled: true }); return 'Direttore acceso.' })} />

    <div className={styles.tabs} role="tablist">
      {([['waiting', `Aspetta te`, data.pending_count], ['work', 'Lavori', null], ['team', department ? OFFICE_DEPARTMENTS[department as keyof typeof OFFICE_DEPARTMENTS] || 'Squadra' : 'Squadra', agents.length], ['plan', 'Piano di oggi', plan ? plan.work.length + plan.unblock.length + plan.activate.length : null]] as const)
        .map(([key, label, count]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? styles.on : ''} onClick={() => setTab(key)}>
          {label}{count !== null ? <span>{count}</span> : null}</button>)}
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p role="status" className={styles.notice}>{notice}</p>

    {tab === 'work' && <WorkList agentNames={Object.fromEntries(data.agents.map((agent) => [agent.id, agent.name]))} refreshSignal={data} onChanged={() => { void reload() }} />}

    {tab === 'waiting' && <div className={styles.list}>
      {data.pending_count === 0 && <p className={styles.muted}>Nessuna proposta da decidere.</p>}
      {outputs.map((output) => {
        const effect = officeApprovalEffect(output)
        return <article key={output.id} id={`pannello-uscita-${output.id}`} className={`${styles.card} ${output.id === highlight ? styles.lit : ''}`}>
          <small>{agentName(output.agent_id)} · {date(output.created_at)}</small>
          <h3>{output.title}</h3>
          <details><summary>Leggi</summary><div className={styles.body}><OutputBody value={output.body} hide={output.body.action === 'create_contact' ? CONTACT_HIDDEN_KEYS : undefined} /></div></details>
          <p className={styles.effect}>{effect.description}</p>
          <div className={styles.actions}>
            <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => { void decide(output.id, 'approved') }}>{effect.label}</button>
            {output.agent_id === 'news_watch' && output.body.telegram_available === true && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { void telegram(output.id) }}>Approva e invia su Telegram</button>}
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { void decide(output.id, 'rejected') }}>Rifiuta</button>
          </div>
        </article>
      })}
      {data.pending_count > data.outputs.length && <Link className={styles.more} href="/ufficio/agenti#coda">Altre {data.pending_count - data.outputs.length} proposte →</Link>}
    </div>}

    {tab === 'team' && <div className={styles.list}>
      <div className={styles.chips}>
        <button className={!department ? styles.on : ''} onClick={() => setDepartment(null)}>Tutti</button>
        {(Object.entries(OFFICE_DEPARTMENTS) as Array<[string, string]>).filter(([id]) => data.agents.some((agent) => agent.department === id))
          .map(([id, label]) => <button key={id} className={department === id ? styles.on : ''} onClick={() => setDepartment(id)}>{label}</button>)}
      </div>
      {agents.length === 0 && <p className={styles.muted}>Nessun agente in questo reparto.</p>}
      {agents.map((agent) => {
        const state = officeAgentActivity(agent, data.works)
        return <article key={agent.id} className={styles.card}>
          <div className={styles.agentTop}>
            <h3><i className={styles.dot} data-state={state.key} aria-hidden />{agent.name}</h3>
            <label className={styles.switch}><input type="checkbox" role="switch" checked={agent.enabled} disabled={!!busy}
              onChange={() => { void toggle(agent) }} aria-label={`Attiva ${agent.name}`} />{agent.enabled ? 'Acceso' : 'Spento'}</label>
          </div>
          <p className={styles.muted}>{agent.description}</p>
          <p className={styles.last}>{state.label}{state.current?.reason ? ` — ${state.current.reason}` : ''}</p>
          <p className={styles.last}>{agent.last_run ? <>{OFFICE_RUN_LABELS[agent.last_run.status]} · {date(agent.last_run.started_at)} — {agent.last_run.summary}</> : 'Non ha ancora lavorato.'}</p>
          {agent.last_run?.error && <p className={styles.error}>{agent.last_run.error}</p>}
          <div className={styles.actions}>
            <button className="btn btn-primary btn-sm" onClick={() => selectAgent(agent.id)}>Attività e storico</button>
            <button className="btn btn-ghost btn-sm" disabled={!!busy || !agent.enabled} onClick={() => { void run(agent) }}>{busy === agent.id ? 'Lavoro…' : 'Fai girare adesso'}</button>
            <span className={styles.muted}>Mese {euro(agent.spend.month_actual)} / {euro(agent.monthly_budget_cents)}</span>
            <Link className={styles.more} href={`/ufficio/agenti#agente-${agent.id}`}>Budget e impostazioni →</Link>
          </div>
        </article>
      })}
    </div>}

    {tab === 'plan' && <div className={styles.list}>
      {planError && <p role="alert" className={styles.error}>{planError}</p>}
      {!plan && !planError && <p className={styles.muted}>Calcolo il piano…</p>}
      {plan && <>
        <p className={styles.muted}>In gioco {plan.open} · ferme {plan.stuck}{plan.dormant ? ` · ${plan.dormant} vendite senza movimenti da 90 giorni fuori dal piano` : ''}. Calcolato adesso, senza AI.</p>
        <PlanList title="Da lavorare oggi" rows={plan.work} />
        <PlanList title="Da sbloccare" rows={plan.unblock} extra={(row) => row.stuck} />
        <PlanList title="Partner da attivare" rows={plan.activate} extra={() => 'Accordo firmato, partner non ancora attivo'} />
        {plan.maps.length > 0 && <p className={styles.muted}>Guide che servono: {plan.maps.map((row) => `${row.map_ref} (${row.name})`).join(', ')}.</p>}
      </>}
      <Link className={styles.more} href="/opportunita">Tutte le opportunità →</Link>
    </div>}
  </aside>
}
