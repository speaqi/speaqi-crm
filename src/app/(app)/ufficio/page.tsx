'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { formatEuroPlain } from '@/lib/command-center'
import { OFFICE_DEPARTMENTS, OFFICE_RUN_LABELS, type OfficeAgent, type OfficeOverview, type OfficeRun } from '@/lib/office'
import styles from './office.module.css'

const euro = (cents: number) => formatEuroPlain(cents / 100)
const date = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const BODY_LABELS: Record<string, string> = { testo: 'Testo', text: 'Testo', subject: 'Oggetto', body: 'Contenuto', summary: 'Riepilogo', points: 'Punti', sources: 'Fonti', evidence: 'Fonti', proposal: 'Proposta' }

function OutputBody({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}><OutputBody value={item} /></li>)}</ul>
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{BODY_LABELS[key] || key.replace(/_/g, ' ')}</dt><dd><OutputBody value={item} /></dd></div>)}</dl>
  return <p>{typeof value === 'boolean' ? value ? 'Sì' : 'No' : String(value)}</p>
}

function AgentRow({ agent, busy, change, run }: {
  agent: OfficeOverview['agents'][number]; busy: boolean
  change: (id: string, patch: Record<string, unknown>) => Promise<void>
  run: (id: string) => Promise<void>
}) {
  const [daily, setDaily] = useState(String(agent.daily_budget_cents / 100))
  const [weekly, setWeekly] = useState(String(agent.weekly_budget_cents / 100))
  const [monthly, setMonthly] = useState(String(agent.monthly_budget_cents / 100))
  const [settings, setSettings] = useState(JSON.stringify(agent.settings, null, 2))
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      const amounts = [daily, weekly, monthly].map((value) => {
        if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Scrivi importi positivi, con al massimo due decimali')
        return Math.round(Number(value.replace(',', '.')) * 100)
      })
      const parsed: unknown = JSON.parse(settings)
      await change(agent.id, { daily_budget_cents: amounts[0], weekly_budget_cents: amounts[1], monthly_budget_cents: amounts[2], settings: parsed })
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Impostazioni non valide') }
  }

  return <article className={styles.agent} aria-label={agent.name}>
    <div className={styles.agentTop}>
      <div><h3>{agent.name}</h3><p>{agent.description}</p><small>{agent.model}{agent.schedule_job ? ` · ${agent.schedule_job}` : ' · Nessun orario assegnato'}</small></div>
      <label className={styles.toggle}><input type="checkbox" role="switch" checked={agent.enabled} disabled={busy}
        onChange={(event) => { void change(agent.id, { enabled: event.target.checked }).catch(() => {}) }} aria-label={`Attiva ${agent.name}`} />{agent.enabled ? 'Acceso' : 'Spento'}</label>
    </div>
    <div className={styles.metrics}>
      {(['day', 'week', 'month'] as const).map((period, index) => <div key={period}><span>{['Oggi', 'Settimana', 'Mese'][index]}</span>
        <strong>{euro(agent.spend[`${period}_actual`])}</strong><small>{euro(agent.spend[`${period}_reserved`])} prenotati</small></div>)}
    </div>
    <div className={styles.lastRun}>{agent.last_run ? <><span className={styles.status}>{OFFICE_RUN_LABELS[agent.last_run.status]}</span>
      <span>{date(agent.last_run.started_at)} · {agent.last_run.summary}</span>{agent.last_run.error && <p className={styles.error}>{agent.last_run.error}</p>}</> : <span>Nessuna corsa eseguita.</span>}</div>
    <div className={styles.actions}>
      <button className="btn btn-ghost btn-sm" disabled={busy || !agent.enabled} onClick={() => { void run(agent.id) }}>Fai girare adesso</button>
      <details><summary>Budget e impostazioni</summary>
        <form onSubmit={save} className={styles.form}>
          <div className={styles.budgets}>
            {[[daily, setDaily, 'giorno'], [weekly, setWeekly, 'settimana'], [monthly, setMonthly, 'mese']].map(([value, setValue, label]) => <label key={String(label)}>
              Euro / {String(label)}<input inputMode="decimal" value={value as string} onChange={(event) => (setValue as (v: string) => void)(event.target.value)} required />
            </label>)}
          </div>
          <p>Ogni tetto vale insieme agli altri. Zero blocca la spesa. Settimana da lunedì, fuso Europe/Rome.</p>
          <label>Impostazioni (JSON)<textarea rows={5} spellCheck={false} value={settings} onChange={(event) => setSettings(event.target.value)} /></label>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <button className="btn btn-primary btn-sm" disabled={busy}>Salva impostazioni</button>
        </form>
      </details>
    </div>
  </article>
}

export default function OfficePage() {
  const [data, setData] = useState<OfficeOverview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const load = useCallback(async () => {
    const response = await apiFetch<OfficeOverview>(`/api/office?offset=${offset}`)
    setData(response)
    setError('')
  }, [offset])
  useEffect(() => { void load().catch((err) => setError(err instanceof Error ? err.message : 'Ufficio non disponibile')) }, [load])

  useEffect(() => { if (data && data.outputs.length === 0 && offset > 0) setOffset(Math.max(0, offset - 50)) }, [data, offset])

  async function act(id: string, action: () => Promise<unknown>, message: string) {
    setBusy(id); setError(''); setNotice('')
    try { await action(); setNotice(message); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Operazione non riuscita'); throw err }
    finally { setBusy(null) }
  }
  async function change(id: string, patch: Record<string, unknown>) {
    const previous = data
    if (typeof patch.enabled === 'boolean') {
      setData((current) => current ? { ...current, agents: current.agents.map((agent) => agent.id === id ? { ...agent, enabled: patch.enabled as boolean } : agent) } : current)
    }
    try {
      await act(id, () => apiFetch<{ agent: OfficeAgent }>(`/api/office/agents/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      }), 'Impostazioni salvate.')
    } catch (error) { setData(previous); throw error }
  }
  async function run(id: string) {
    // Una chiave per clic: ripetere la stessa richiesta non raddoppia la corsa.
    const key = crypto.randomUUID()
    try {
      await act(id, async () => {
        const result = await apiFetch<{ run: OfficeRun | null; error?: string; skipped?: string }>(`/api/office/agents/${encodeURIComponent(id)}/run-now`, { method: 'POST', headers: { 'Idempotency-Key': key } })
        if (result.error) { await load(); throw new Error(result.error) }
        setNotice(result.skipped ? 'Turno saltato: corsa già presente o agente spento.' : result.run?.summary || 'Corsa conclusa.')
      }, 'Corsa registrata.')
    } catch { /* Il messaggio resta visibile nella pagina. */ }
  }
  async function decide(id: string, status: 'approved' | 'rejected') {
    try { await act(id, () => apiFetch(`/api/office/outputs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }), status === 'approved' ? 'Approvata. La decisione è registrata; nessun invio eseguito.' : 'Uscita rifiutata.') }
    catch { /* Il messaggio resta visibile nella pagina. */ }
  }

  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Solo titolare</p><h1>Ufficio</h1><p>Compiti, corse e cose che aspettano una tua decisione.</p></div>
      <button className="btn btn-ghost btn-sm" onClick={() => { void load().catch((err) => setError(String(err))) }} disabled={!!busy}>Aggiorna</button></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <p role="status" className={styles.notice}>{notice}</p>
    {!data && !error && <p>Carico l’ufficio…</p>}
    {data && <>
      <div className={styles.overview}>
        <div><span>Agenti accesi</span><strong>{data.active_agents} <small>/ {data.agents.length}</small></strong></div>
        <div><span>Spesa oggi</span><strong>{euro(data.totals.day_actual)}</strong><small>{euro(data.totals.day_reserved)} prenotati</small></div>
        <div><span>Questa settimana</span><strong>{euro(data.totals.week_actual)}</strong><small>{euro(data.totals.week_reserved)} prenotati</small></div>
        <div><span>Questo mese</span><strong>{euro(data.totals.month_actual)}</strong><small>{euro(data.totals.month_reserved)} prenotati</small></div>
      </div>
      {data.agents.length === 0 && <section className={styles.empty}><h2>L’ufficio è pronto, i compiti arrivano dopo.</h2><p>Non ci sono ancora agenti installati. Ogni nuovo agente nascerà spento, con il suo budget da controllare.</p></section>}
      {(Object.entries(OFFICE_DEPARTMENTS) as Array<[keyof typeof OFFICE_DEPARTMENTS, string]>).map(([department, label]) => {
        const agents = data.agents.filter((agent) => agent.department === department)
        return agents.length > 0 && <section key={department} className={styles.department}><h2>{label}</h2>{agents.map((agent) => <AgentRow key={agent.id} agent={agent} busy={!!busy} change={change} run={run} />)}</section>
      })}
      <section className={styles.queue}><h2>Aspetta te <span>{data.pending_count}</span></h2><p>Approva o rifiuta la proposta. L’approvazione registra la decisione: non invia email, fatture o pubblicazioni.</p>
        {data.pending_count === 0 && <p className={styles.emptyQueue}>Nessuna uscita da valutare.</p>}
        {data.outputs.map((output) => <article className={styles.output} id={`uscita-${output.id}`} key={output.id}>
          <small>{data.agents.find((agent) => agent.id === output.agent_id)?.name || output.agent_id} · {date(output.created_at)}</small><h3>{output.title}</h3>
          <div className={styles.outputBody}><OutputBody value={output.body} /></div>
          <div className={styles.actions}><button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => { void decide(output.id, 'approved') }}>Approva</button>
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { void decide(output.id, 'rejected') }}>Rifiuta</button></div>
        </article>)}
        {(data.pending_count > 50 || offset > 0) && <div className={styles.actions}>
          <button className="btn btn-ghost btn-sm" disabled={!!busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Precedenti</button>
          <span>{offset + 1}–{Math.min(offset + 50, data.pending_count)} di {data.pending_count}</span>
          <button className="btn btn-ghost btn-sm" disabled={!!busy || offset + 50 >= data.pending_count} onClick={() => setOffset(offset + 50)}>Successive</button>
        </div>}
      </section>
      <section className={styles.history}><h2>Ultime corse</h2>{data.runs.length === 0 ? <p>Nessuna corsa registrata.</p> : <ul>{data.runs.map((item) => <li key={item.id}>
        <div><strong>{data.agents.find((agent) => agent.id === item.agent_id)?.name || item.agent_id}</strong><span>{date(item.started_at)} · {OFFICE_RUN_LABELS[item.status]}</span></div>
        <p>{item.summary}</p><small>{item.items_created} uscite · {euro(item.cost_cents_actual)} di spesa{item.error ? ` · ${item.error}` : ''}</small>
      </li>)}</ul>}</section>
    </>}
  </div>
}
