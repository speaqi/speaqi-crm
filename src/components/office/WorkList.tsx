'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { DirectorReply } from './DirectorReply'
import { OFFICE_WORK_LABELS, type OfficeWorkItem } from '@/lib/office-work'
import { OFFICE_ACTION_NAMES as ACTION_NAMES, officeResultLink } from '@/lib/office-activity'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

type WorkPage = { supported: boolean; works: OfficeWorkItem[]; total: number; offset: number; notice?: string }
type WorkDetail = { work: OfficeWorkItem; attempts: Array<{ id: string; run_id: string | null; status?: string; created_at: string; started_at?: string; finished_at?: string | null }>
  dependencies: Array<{ depends_on_work_id: string }>; outputs: Array<{ id: string; title: string; status: string; target_table?: string; target_id?: string }>
  events: Array<{ id: string; created_at: string; message?: string; status?: string }> }
const TERMINAL = new Set(['succeeded', 'cancelled'])
const AGENT_NAMES: Record<string, string> = { director: 'Direttore', entity_enricher: 'Arricchimento enti', presentations: 'Presentazioni',
  mymaps_builder: 'Costruttore My Maps', maps_quality: 'Controllo qualità mappe', languages_voice: 'Lingue e voce',
  events_scout: 'Ricercatore eventi', news_watch: 'Osservatorio novità', sales_followup: 'Commerciale', finance: 'Finanza', social: 'Social', db_cleaner: 'Pulizia database' }
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('it-IT', {
  timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : ''

/** Nessun timer autonomo: il pannello passa il suo aggiornamento condiviso. */
export function WorkList({ orderId, agentId, agentNames = {}, refreshSignal, compact = false, onChanged }: {
  orderId?: string; agentId?: string; agentNames?: Record<string, string>; refreshSignal?: unknown; compact?: boolean; onChanged?: () => void
}) {
  const [page, setPage] = useState<WorkPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [view, setView] = useState<'open' | 'all'>(orderId ? 'all' : 'open')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, WorkDetail>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const load = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({ offset: String(offset), view })
    if (orderId) query.set('order_id', orderId)
    if (agentId) query.set('agent_id', agentId)
    try {
      const result = await apiFetch<WorkPage>(`/api/office/work?${query}`, { signal })
      if (signal?.aborted) return
      setPage({ ...result, works: Array.isArray(result.works) ? result.works : [] }); setError('')
      if (offset > 0 && offset >= result.total) setOffset(Math.max(0, Math.ceil(result.total / 25) * 25 - 25))
    } catch (err) { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Lavori non disponibili') }
  }, [offset, view, orderId, agentId])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load, refreshSignal])
  useEffect(() => {
    const changed = () => { void load() }
    window.addEventListener('office:work-changed', changed)
    return () => window.removeEventListener('office:work-changed', changed)
  }, [load])

  async function detail(id: string, refresh = false) {
    if (details[id] && !refresh) return
    try {
      const result = await apiFetch<WorkDetail>(`/api/office/work/${id}`)
      if (!result.work) { setError('Il dettaglio del lavoro è in aggiornamento.'); return }
      setDetails((old) => ({ ...old, [id]: result }))
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Dettaglio non disponibile') }
  }
  useEffect(() => {
    for (const work of page?.works || []) if (details[work.id] && details[work.id].work.revision !== work.revision) void detail(work.id, true)
    // Solo i dettagli già aperti vengono riletti quando cambia la fotografia condivisa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  async function act(work: OfficeWorkItem, action: 'resume' | 'cancel' | 'update_payload', payload?: Record<string, string>) {
    setBusy(work.id); setNotice(''); setError('')
    try {
      const result = await apiFetch<{ notice: string }>(`/api/office/work/${work.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expected_revision: work.revision, ...(payload ? { payload } : {}) }),
      })
      setNotice(result.notice); setEditing(null); setDetails((old) => { const next = { ...old }; delete next[work.id]; return next })
      await load(); window.dispatchEvent(new Event('office:work-changed')); onChanged?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Modifica non riuscita') }
    finally { setBusy(null) }
  }

  function edit(work: OfficeWorkItem) {
    const payload = work.payload || {}
    const keys = work.action === 'interpret_order' ? ['text', 'city'] : work.action === 'import_mymaps' ? ['source', 'city']
      : work.action === 'verify_tourism_entity' ? ['website', 'city'] : ['city', 'brief']
    setEditFields(Object.fromEntries(keys.map((key) => [key, typeof payload[key] === 'string' ? payload[key] : ''])))
    setEditing(work.id)
  }

  return <section className={styles.list} aria-label={orderId ? 'Lavori dell’ordine' : agentId ? 'Lavori del personaggio' : 'Lavori dell’ufficio'}>
    {!compact && <div className={styles.chips}>
      <button type="button" className={view === 'open' ? styles.on : ''} onClick={() => { setView('open'); setOffset(0) }}>Aperti</button>
      <button type="button" className={view === 'all' ? styles.on : ''} onClick={() => { setView('all'); setOffset(0) }}>Anche conclusi</button>
      <button type="button" onClick={() => { void load() }}>Aggiorna lavori</button>
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!page && !error && <p className={styles.muted}>Carico i lavori…</p>}
    {page?.supported === false && <p className={styles.muted}>{page.notice || 'Il registro dei lavori è in aggiornamento. Gli ordini restano salvati.'}</p>}
    {page?.supported && page.works.length === 0 && <p className={styles.muted}>{orderId ? 'Nessun lavoro collegato a questo ordine.' : 'Nessun lavoro in questa vista.'}</p>}
    {page?.works.map((work) => {
      const payload = work.payload || {}
      const target = [payload.city, payload.target, payload.name].find((value) => typeof value === 'string' && value)
      const uncertain = /reconcil|uncertain|incerto/.test(work.reason_code || '') || work.phase === 'effect_started'
      const terminal = TERMINAL.has(work.status)
      const resultLink = work.status === 'succeeded' ? officeResultLink(work.result || {}) : null
      return <article key={work.id} className={styles.card} data-work-id={work.id}>
        <div className={styles.workHeading}>
          <h3>{ACTION_NAMES[work.action] || 'Lavoro assegnato'}{target ? ` · ${target}` : ''}</h3>
          <span className={styles.workState} data-status={work.status}>{OFFICE_WORK_LABELS[work.status] || work.status}</span>
        </div>
        <small>{agentNames[work.agent_id] || AGENT_NAMES[work.agent_id] || 'Agente assegnato'} · {date(work.created_at)}</small>
        {work.result_summary && <p className={styles.last}>{work.result_summary}</p>}
        {resultLink && <Link className={styles.more} href={resultLink.href}>{resultLink.label} →</Link>}
        {work.reason && <p className={styles.workReason}>{work.reason}</p>}
        {work.required_action && <p className={styles.last}><strong>Prossima azione:</strong> {work.required_action}</p>}
        {work.responsible && <p className={styles.muted}>Se ne occupa: {agentNames[work.responsible] || AGENT_NAMES[work.responsible] || work.responsible}.</p>}
        {!terminal && <p className={styles.muted}>{work.next_check_at ? `Ricontrollo: ${date(work.next_check_at)} (Roma).`
          : work.status === 'waiting_owner' ? 'Riprende dopo la tua decisione.' : work.status === 'running' ? 'L’agente sta lavorando.' : 'La prossima azione resta registrata in questo lavoro.'}</p>}
        {work.status === 'waiting_owner' && <Link className={styles.more} href="/ufficio/agenti#coda">Apri le proposte da decidere →</Link>}
        {editing === work.id && <form className={styles.workEditor} onSubmit={(event) => {
          event.preventDefault()
          const changed = Object.fromEntries(Object.entries(editFields).filter(([key, value]) => value.trim() && value !== payload[key]).map(([key, value]) => [key, value.trim()]))
          if (!Object.keys(changed).length) { setError('Inserisci almeno un dato nuovo.'); return }
          void act(work, 'update_payload', changed)
        }}>
          {Object.entries(editFields).map(([key, value]) => <label key={key}>{key === 'text' ? 'Istruzione completa o dati mancanti' : key === 'source' ? 'Link My Maps' : key === 'website' ? 'Sito ufficiale' : key === 'city' ? 'Città' : 'Informazioni aggiuntive'}
            <input value={value} maxLength={key === 'brief' ? 2000 : 2000} onChange={(event) => setEditFields((old) => ({ ...old, [key]: event.target.value }))} />
          </label>)}
          <div className={styles.actions}><button className="btn btn-primary btn-sm" disabled={!!busy}>Salva i dati</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Chiudi</button></div>
        </form>}
        {!terminal && work.status !== 'running' && <div className={styles.actions}>
          {['blocked', 'failed', 'waiting'].includes(work.status) && !uncertain && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { void act(work, 'resume') }}>Ricontrolla e riprendi</button>}
          {['blocked', 'failed', 'waiting'].includes(work.status) && !uncertain && <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => edit(work)}>Completa i dati</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => { void act(work, 'cancel') }}>Annulla lavoro</button>
        </div>}
        {!terminal && <DirectorReply reference={`lavoro ${work.id}`} title={`${ACTION_NAMES[work.action] || 'Lavoro assegnato'}${target ? ` · ${target}` : ''}${work.reason ? ` — ${work.reason}` : ''}`} onChanged={onChanged} />}
        <details onToggle={(event) => { if (event.currentTarget.open) void detail(work.id) }}>
          <summary>Risultati e cronologia</summary>
          {details[work.id] && <div className={styles.workHistory}>
            {details[work.id].outputs.length > 0 && <ul>{details[work.id].outputs.map((output) => {
              const document = officeResultLink(output.target_table === 'tourism_decks' ? { deck_id: output.target_id }
                : output.target_table === 'invoices' ? { invoice_id: output.target_id } : {})
              const href = document?.href || (output.status === 'pending' ? `/ufficio?uscita=${encodeURIComponent(output.id)}` : null)
              return <li key={output.id}>{href ? <Link href={href}>{output.title}</Link> : output.title}
                {' · '}{output.status === 'pending' ? 'Da decidere' : output.status === 'approved' ? 'Approvata' : output.status === 'rejected' ? 'Rifiutata' : 'Registrata'}</li>
            })}</ul>}
            <p>{details[work.id].dependencies.length} prerequisiti · {details[work.id].attempts.length} tentativi registrati</p>
            <ul>{details[work.id].attempts.map((attempt) => <li key={attempt.id}>{date(attempt.started_at || attempt.created_at)}
              {attempt.finished_at ? ` → ${date(attempt.finished_at)}` : ''}{attempt.run_id ? <small> Corsa {attempt.run_id}</small> : null}</li>)}</ul>
            {work.order_id && !orderId && <p>Collegato a un ordine del Direttore.</p>}
            <small>Lavoro {work.id} · versione {work.payload_version}</small>
          </div>}
        </details>
      </article>
    })}
    {page?.supported && (page.total > 25 || offset > 0) && <div className={styles.actions}>
      <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0 || !!busy} onClick={() => setOffset(Math.max(0, offset - 25))}>Precedenti</button>
      <span className={styles.muted}>{Math.min(offset + 1, page.total)}–{Math.min(offset + 25, page.total)} di {page.total}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={offset + 25 >= page.total || !!busy} onClick={() => setOffset(offset + 25)}>Successivi</button>
    </div>}
  </section>
}
