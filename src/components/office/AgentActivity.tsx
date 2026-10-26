'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { OFFICE_RUN_LABELS, type OfficeOverview, type OfficeOutput, type OfficeRun } from '@/lib/office'
import { officeAgentActivity, officeResultLink, OFFICE_ACTION_NAMES } from '@/lib/office-activity'
import { WorkList } from './WorkList'
import { CONTACT_HIDDEN_KEYS, OutputBody } from './OutputBody'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

type History = { runs: OfficeRun[]; outputs: OfficeOutput[]; total: number; offset: number }
const date = (value: string) => new Date(value).toLocaleString('it-IT', {
  timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

export function AgentActivity({ agent, overview, onClose, onChanged }: {
  agent: OfficeOverview['agents'][number]; overview: OfficeOverview; onClose: () => void; onChanged: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const [history, setHistory] = useState<History | null>(null)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const activity = officeAgentActivity(agent, overview.works)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [agent.id])
  useEffect(() => {
    const controller = new AbortController()
    void apiFetch<History>(`/api/office/agents/${encodeURIComponent(agent.id)}?offset=${offset}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setHistory(result); setError('') } })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Storico non disponibile') })
    return () => controller.abort()
  }, [agent.id, offset, overview])

  return <section className={`${styles.card} ${styles.agentActivity}`} aria-label={`Scheda di ${agent.name}`}>
    <div className={styles.agentTop}>
      <h2 ref={heading} tabIndex={-1}>{agent.name}</h2>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={`Chiudi scheda di ${agent.name}`}>Chiudi</button>
    </div>
    <p className={styles.muted}>{agent.description}</p>
    <p className={styles.last}><i className={styles.dot} data-state={activity.key} aria-hidden /> {activity.label}
      {activity.openCount > 0 ? ` · ${activity.openCount} ${activity.openCount === 1 ? 'incarico aperto' : 'incarichi aperti'}` : ''}</p>
    <h3>Cosa sta facendo</h3>
    {activity.current ? <p className={styles.last}>{OFFICE_ACTION_NAMES[activity.current.action] || 'Lavoro assegnato'}
      {activity.current.reason ? ` — ${activity.current.reason}` : ''}</p>
      : <p className={styles.muted}>{agent.last_run?.status === 'running' ? agent.last_run.summary || 'Turno in corso.'
        : overview.work_supported === false ? 'Registro incarichi non disponibile; puoi consultare le esecuzioni qui sotto.' : 'Nessun incarico aperto.'}</p>}
    <WorkList key={agent.id} agentId={agent.id} refreshSignal={overview} onChanged={onChanged} />

    <h3>Cosa ha fatto</h3>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!history && !error && <p className={styles.muted}>Carico lo storico…</p>}
    {history && <>
      {history.runs.length === 0 && history.outputs.length === 0 && <p className={styles.muted}>Nessuna attività registrata in questa pagina.</p>}
      {history.outputs.map((output) => {
        const link = officeResultLink(output.target_table === 'tourism_decks' ? { deck_id: output.target_id }
          : output.target_table === 'invoices' ? { invoice_id: output.target_id } : {})
        return <article key={output.id} className={styles.card}>
          <h3>{output.title}</h3>
          <small>{date(output.created_at)} · {output.status === 'pending' ? 'Aspetta te' : output.status === 'approved' ? 'Approvato' : output.status === 'rejected' ? 'Rifiutato' : 'Registrato'}</small>
          {link && <Link className={styles.more} href={link.href}>{link.label} →</Link>}
          {output.status === 'pending' && <Link className={styles.more} href={`/ufficio?uscita=${encodeURIComponent(output.id)}`}>Apri proposta da decidere →</Link>}
          <details><summary>Leggi il risultato</summary><div className={styles.body}><OutputBody value={output.body}
            hide={output.body.action === 'create_contact' ? CONTACT_HIDDEN_KEYS : undefined} /></div></details>
        </article>
      })}
      <details open><summary>Esecuzioni registrate ({history.runs.length})</summary>
        <p className={styles.muted}>Una corsa conclusa può avere segnalato un blocco. L’esito degli incarichi è indicato sopra.</p>
        {history.runs.map((run) => <article key={run.id} className={styles.card}>
          <small>{date(run.started_at)} · {OFFICE_RUN_LABELS[run.status]}</small>
          <p className={styles.last}>{run.summary || 'Nessun riepilogo registrato.'}</p>
          {run.error && <p className={styles.error}>{run.error}</p>}
        </article>)}
      </details>
      {(history.total > 20 || offset > 0) && <div className={styles.actions}>
        <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => { setHistory(null); setOffset(Math.max(0, offset - 20)) }}>Più recenti</button>
        <button className="btn btn-ghost btn-sm" disabled={offset + 20 >= history.total} onClick={() => { setHistory(null); setOffset(offset + 20) }}>Precedenti</button>
      </div>}
    </>}
    <Link className={styles.more} href={`/ufficio/agenti#agente-${agent.id}`}>Budget e impostazioni →</Link>
  </section>
}
