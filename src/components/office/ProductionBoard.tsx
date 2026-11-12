'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  PRODUCTION_ACTION_LABELS, PRODUCTION_PHASES, PRODUCTION_PHASE_LABELS, filterProduction, productionActionFor, productionOrder, productionStudioLink,
  type ProductionAction, type ProductionFilter, type ProductionJob, type ProductionOverview, type ProductionPhaseKey, type ProductionPlan, type ProductionRow,
} from '@/lib/office/production'
import styles from './production.module.css'

const usd = (value: number) => `${value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
const FILTERS: Array<[ProductionFilter, string]> = [['all', 'Tutte'], ['progress', 'In produzione'], ['behind', 'Online con arretrati'], ['live', 'Online']]
const MARK = { done: '✓', partial: '◐', todo: '' } as const
const COMMAND_KEY = 'speaqi.ufficio.comando'

/** Un comando alla volta: prima il piano con la stima, poi la conferma, poi si segue il lavoro. */
type Command = { slug: string; name: string; action: ProductionAction; request_id: string
  stage: 'planning' | 'confirm' | 'starting' | 'running' | 'done' | 'failed'
  plan?: ProductionPlan; job?: ProductionJob; error?: string }
const remember = (command: Command | null) => {
  try {
    if (command && (command.stage === 'running' || command.stage === 'starting')) {
      window.localStorage.setItem(COMMAND_KEY, JSON.stringify({ slug: command.slug, name: command.name, action: command.action, request_id: command.request_id }))
    } else window.localStorage.removeItem(COMMAND_KEY)
  } catch { /* senza storage il comando si segue finché la pagina resta aperta */ }
}

/**
 * La sala di controllo: una riga per città, otto fasi dai luoghi all'online, e per ognuna
 * la prima cosa che manca. È la vista di partenza dell'Ufficio; il campus 3D è l'altra.
 */
export function ProductionBoard({ onOrdered }: { onOrdered?: () => void }) {
  const [data, setData] = useState<ProductionOverview | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<ProductionFilter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const [command, setCommandState] = useState<Command | null>(null)
  const setCommand = useCallback((next: Command | null) => { setCommandState(next); remember(next) }, [])

  const load = useCallback(async (fresh = false) => {
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    try {
      const value = await apiFetch<ProductionOverview>(`/api/office/production${fresh ? '?fresh=1' : ''}`, { signal: current.signal })
      if (current.signal.aborted) return
      setData(value); setError('')
    } catch (err) {
      if (!current.signal.aborted) setError(err instanceof Error ? err.message : 'Città non disponibili')
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { if (!document.hidden) void load() }, 120_000)
    return () => { clearInterval(timer); controller.current?.abort() }
  }, [load])

  const post = useCallback((body: object) => apiFetch<{ plan?: ProductionPlan; job?: ProductionJob }>('/api/office/production/action',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), [])

  async function plan(row: ProductionRow, action: ProductionAction) {
    if (command && ['planning', 'starting', 'running'].includes(command.stage)) return
    const next: Command = { slug: row.slug, name: row.name, action, request_id: crypto.randomUUID(), stage: 'planning' }
    setCommand(next)
    try {
      const result = await post({ slug: next.slug, action, request_id: next.request_id, dry_run: true })
      setCommand(result.plan ? { ...next, stage: 'confirm', plan: result.plan } : { ...next, stage: 'failed', error: 'Piano non disponibile.' })
    } catch (err) { setCommand({ ...next, stage: 'failed', error: err instanceof Error ? err.message : 'Piano non disponibile' }) }
  }
  async function confirm() {
    if (!command || command.stage !== 'confirm' || !command.plan?.allowed) return
    const next: Command = { ...command, stage: 'starting' }
    setCommand(next)
    try {
      const result = await post({ slug: next.slug, action: next.action, request_id: next.request_id })
      setCommand(result.job ? { ...next, stage: result.job.done ? (result.job.error ? 'failed' : 'done') : 'running', job: result.job, error: result.job.error || undefined }
        : { ...next, stage: 'failed', error: 'Avvio non confermato: controlla Lavorazioni in StudioMap.' })
    } catch (err) { setCommand({ ...next, stage: 'failed', error: err instanceof Error ? err.message : 'Comando non partito' }) }
  }

  // Un comando avviato si ritrova anche dopo aver ricaricato la pagina.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COMMAND_KEY) || 'null')
      if (saved?.slug && saved?.action && saved?.request_id) setCommandState({ ...saved, name: saved.name || saved.slug, stage: 'running' })
    } catch { /* niente da riprendere */ }
  }, [])
  useEffect(() => {
    if (command?.stage !== 'running') return
    let stopped = false
    const tick = async () => {
      try {
        const result = await post({ slug: command.slug, action: command.action, request_id: command.request_id })
        if (stopped || !result.job) return
        if (result.job.done) {
          setCommand({ ...command, stage: result.job.error ? 'failed' : 'done', job: result.job, error: result.job.error || undefined })
          void load(true); onOrdered?.()
        } else setCommandState((current) => current && current.request_id === command.request_id ? { ...current, job: result.job } : current)
      } catch (err) {
        // Un errore di rete non è l'esito del lavoro: si riprova al giro dopo.
        if (!stopped) setCommandState((current) => current && current.request_id === command.request_id
          ? { ...current, error: err instanceof Error ? err.message : 'Stato non disponibile' } : current)
      }
    }
    const timer = setInterval(() => { if (!document.hidden) void tick() }, 4000)
    void tick()
    return () => { stopped = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.stage, command?.request_id])

  const rows = useMemo(() => data?.available ? filterProduction(data.rows, filter, query) : [], [data, filter, query])

  async function order_(row: ProductionRow, phase: ProductionPhaseKey) {
    const text = productionOrder(row, phase)
    if (!text || busy) return
    setBusy(row.slug); setNotice('')
    try {
      await apiFetch('/api/office/director/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      setNotice(`Ordine dato al Direttore: «${text}». L’esito arriva in «Scrivi al Direttore».`)
      onOrdered?.()
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Ordine non partito') }
    finally { setBusy('') }
  }

  if (!data && !error) return <div className={styles.board}><p className={styles.empty}>Leggo le città da StudioMap…</p></div>
  if (error || !data?.available) return <div className={styles.board}>
    <div className={styles.empty} role="alert">
      <p>{error || (data && !data.available ? data.reason : '')}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void load(true) }}>Riprova</button>
    </div>
  </div>

  const { totals } = data
  return <div className={styles.board}>
    <header className={styles.head}>
      <div className={styles.kpis}>
        <span><strong>{totals.cities}</strong> città</span>
        <span><strong>{totals.live}</strong> online</span>
        <span data-warn={totals.live_behind > 0}><strong>{totals.live_behind}</strong> online con arretrati</span>
        <span><strong>{totals.in_progress}</strong> in produzione</span>
        <span><strong>{totals.places.toLocaleString('it-IT')}</strong> luoghi</span>
        {totals.writing_usd > 0 && <span title="Stima di StudioMap per scrivere temi e presentazioni che mancano">Per finire i testi guida <strong>~{usd(totals.writing_usd)}</strong></span>}
        {data.credit_usd !== null && <span data-warn={data.credit_usd < 5} title="Credito OpenRouter di StudioMap">Credito <strong>{usd(data.credit_usd)}</strong></span>}
      </div>
      <div className={styles.tools}>
        <input type="search" placeholder="Cerca una città" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Cerca una città" />
        {FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        <button type="button" onClick={() => { void load(true) }} title={data.generated_at ? `Letto alle ${new Date(data.generated_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}` : undefined}>↻</button>
      </div>
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {command && <div className={styles.command} data-stage={command.stage} role={command.stage === 'failed' ? 'alert' : 'status'}>
        <strong>{PRODUCTION_ACTION_LABELS[command.action]} — {command.plan?.name || command.name}</strong>
        {command.stage === 'planning' && <span>Chiedo a StudioMap se può partire e quanto costa…</span>}
        {command.stage === 'confirm' && command.plan && <>
          <span>{command.plan.reason}</span>
          {command.plan.allowed && <span>{command.plan.estimate_usd > 0
            ? <>Costo stimato <b>~{usd(command.plan.estimate_usd)}</b>{command.plan.estimate_max_usd > command.plan.estimate_usd ? <> (fino a {usd(command.plan.estimate_max_usd)})</> : null} sul credito OpenRouter di StudioMap{command.plan.credit_usd !== null ? <>, oggi {usd(command.plan.credit_usd)}</> : null}.</>
            : 'Non costa niente.'}</span>}
          {command.plan.allowed && command.plan.warning && <span className={styles.warn}>{command.plan.warning}</span>}
          <span className={styles.commandActions}>
            {command.plan.allowed && <button type="button" className="btn btn-primary btn-sm" onClick={() => { void confirm() }}>Conferma e avvia</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCommand(null)}>{command.plan.allowed ? 'Annulla' : 'Chiudi'}</button>
          </span>
        </>}
        {command.stage === 'starting' && <span>Avvio…</span>}
        {command.stage === 'running' && <span>In corso{command.job?.phase ? ` · ${command.job.phase}` : ''}{command.job?.last ? ` — ${command.job.last}` : ''}{command.error ? ` (stato non letto: ${command.error})` : ''}</span>}
        {command.stage === 'done' && <><span>Fatto{command.job?.last ? ` — ${command.job.last}` : ''}.</span>
          <span className={styles.commandActions}><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCommand(null)}>Chiudi</button></span></>}
        {command.stage === 'failed' && <><span>{command.error || 'Non riuscito.'}</span>
          <span className={styles.commandActions}><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCommand(null)}>Chiudi</button></span></>}
      </div>}
    </header>

    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead><tr>
          <th scope="col">Città</th>
          {PRODUCTION_PHASES.map((key) => <th key={key} scope="col" className={styles.phaseHead}>{PRODUCTION_PHASE_LABELS[key]}</th>)}
          <th scope="col">Prossimo passo</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={PRODUCTION_PHASES.length + 2} className={styles.empty}>Nessuna città con questo filtro.</td></tr>}
          {rows.map((row) => {
            const expanded = open === row.slug
            return [
              <tr key={row.slug} className={expanded ? styles.open : ''} onClick={() => setOpen(expanded ? null : row.slug)}>
                <th scope="row">
                  <button type="button" className={styles.city} aria-expanded={expanded}>{row.name}</button>
                  <small>{row.places.toLocaleString('it-IT')} luoghi · {row.done}/8{row.protected ? ' · protetta' : ''}</small>
                </th>
                {row.phases.map((phase) => <td key={phase.key} className={styles.phase} data-state={phase.state}
                  title={`${PRODUCTION_PHASE_LABELS[phase.key]}: ${phase.detail}`}>
                  <span aria-hidden>{MARK[phase.state]}</span>
                  <span className={styles.sr}>{PRODUCTION_PHASE_LABELS[phase.key]}: {phase.detail}</span>
                </td>)}
                <td className={styles.next}>
                  {row.error ? <span className={styles.bad}>Ultimo invio fallito</span>
                    : row.next ? row.next.text
                    : row.protected ? <span className={styles.soft}>Solo lettura</span>
                    : <span className={styles.good}>Allineata</span>}
                </td>
              </tr>,
              expanded && <tr key={`${row.slug}-detail`} className={styles.detail}><td colSpan={PRODUCTION_PHASES.length + 2}>
                <ul>
                  {row.phases.map((phase) => {
                    const order = phase.state !== 'done' ? productionOrder(row, phase.key) : null
                    const action = productionActionFor(row, phase)
                    const locked = !!command && ['planning', 'starting', 'running'].includes(command.stage)
                    return <li key={phase.key} data-state={phase.state}>
                      <b>{PRODUCTION_PHASE_LABELS[phase.key]}</b><span>{phase.detail}</span>
                      {phase.state !== 'done' && !row.protected && <a href={productionStudioLink(data.studio_url, row.slug, phase.key)} target="_blank" rel="noreferrer">Apri in StudioMap ↗</a>}
                      {action && <button type="button" disabled={locked} onClick={(event) => { event.stopPropagation(); void plan(row, action) }}>
                        {PRODUCTION_ACTION_LABELS[action]}…</button>}
                      {order && <button type="button" disabled={!!busy} onClick={(event) => { event.stopPropagation(); void order_(row, phase.key) }}>
                        {busy === row.slug ? 'Invio…' : 'Fallo fare al Direttore'}</button>}
                    </li>
                  })}
                </ul>
                <p className={styles.links}>
                  {row.error && <span className={styles.bad}>{row.error}</span>}
                  {row.writing_usd !== null && <span>Scrivere temi e presentazione che mancano: ~{usd(row.writing_usd)} (stima)</span>}
                  <a href={productionStudioLink(data.studio_url, row.slug)} target="_blank" rel="noreferrer">Apri la città in StudioMap ↗</a>
                  {row.public_url && <a href={row.public_url} target="_blank" rel="noreferrer">Apri la guida ↗</a>}
                  {row.protected && <span>Napoli è protetta: dall’Ufficio si guarda soltanto.</span>}
                </p>
              </td></tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  </div>
}
