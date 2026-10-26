'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { officeApprovalEffect, type OfficeOverview } from '@/lib/office'
import { INBOX_DOCUMENT_STATES, officeInboxGroups, type InboxAction, type InboxCategory, type InboxPage, type InboxResult } from '@/lib/office-inbox'
import { CONTACT_HIDDEN_KEYS, OutputBody } from './OutputBody'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

const date = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Una sola coda per scena 3D e gestione agenti. Le selezioni non attraversano pagine o filtri. */
export function PendingInbox({ data, onChanged, highlight }: { data: OfficeOverview; onChanged: () => Promise<void> | void; highlight?: string | null }) {
  const [page, setPage] = useState<InboxPage>({ outputs: data.outputs, total: data.pending_count, offset: 0 })
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<'all' | InboxCategory>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [failures, setFailures] = useState<Record<string, string>>({})
  const inFlight = useRef(false)
  const loadVersion = useRef(0)
  const handledHighlight = useRef<string | null>(null)
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++loadVersion.current
    try {
      const result = await apiFetch<InboxPage>(`/api/office/inbox?offset=${offset}`, { signal })
      if (signal?.aborted || version !== loadVersion.current) return
      if (!Array.isArray(result.outputs)) throw new Error('Coda non disponibile. Riprova tra poco.')
      setPage(result); setError('')
      if (offset > 0 && offset >= result.total) setOffset(Math.max(0, Math.ceil(result.total / 50) * 50 - 50))
    } catch (err) { if (!signal?.aborted && version === loadVersion.current) setError(err instanceof Error ? err.message : 'Coda non disponibile') }
  }, [offset])
  useEffect(() => {
    const controller = new AbortController(); void load(controller.signal)
    return () => controller.abort()
  }, [data, load])
  useEffect(() => { setSelected(new Set()); setFailures({}) }, [offset, filter])
  useEffect(() => {
    const ids = new Set(page.outputs.map((output) => output.id))
    setSelected((old) => new Set([...old].filter((id) => ids.has(id))))
  }, [page.outputs])
  useEffect(() => {
    if (!highlight || handledHighlight.current === highlight) return
    const group = officeInboxGroups(page.outputs).find((item) => item.ids.includes(highlight))
    if (group) { handledHighlight.current = highlight; setFilter('all'); document.getElementById(`pannello-uscita-${group.output.id}`)?.scrollIntoView({ block: 'nearest' }) }
  }, [highlight, page.outputs])

  const groups = officeInboxGroups(page.outputs)
  const visible = groups.filter((group) => filter === 'all' || group.category === filter)
  const selectedGroups = groups.filter((group) => group.ids.some((id) => selected.has(id)))
  const selectedIds = selectedGroups.flatMap((group) => group.ids)
  const decisionsOnly = selectedGroups.length > 0 && selectedGroups.every((group) => group.category === 'decisions')
  const noticesOnly = selectedGroups.length > 0 && selectedGroups.every((group) => group.category !== 'decisions')

  async function process(ids: string[], action: InboxAction) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setFailures({})
    try {
      const response = await apiFetch<{ results: InboxResult[] }>('/api/office/inbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, action }),
      })
      const succeeded = response.results.filter((result) => result.ok)
      const failed = response.results.filter((result) => !result.ok)
      setSelected(new Set(failed.map((result) => result.id)))
      setFailures(Object.fromEntries(failed.map((result) => [result.id, result.error || 'Voce da verificare'])))
      const label = action === 'acknowledge' ? succeeded.length === 1 ? 'avviso archiviato' : 'avvisi archiviati'
        : action === 'approved' ? succeeded.length === 1 ? 'decisione approvata' : 'decisioni approvate'
          : succeeded.length === 1 ? 'decisione rifiutata' : 'decisioni rifiutate'
      setNotice(`${succeeded.length} ${label}${failed.length ? `; ${failed.length} da verificare qui sotto` : ''}.`)
      await load(); await onChanged()
      window.dispatchEvent(new Event('office:work-changed'))
    } catch (err) { setError(err instanceof Error ? err.message : 'Operazione non completata. Aggiorna la coda prima di riprovare.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function telegram(id: string) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiFetch<{ sent: boolean }>(`/api/office/outputs/${id}/telegram`, { method: 'POST' })
      setNotice(result.sent ? 'Rassegna approvata e inviata su Telegram.' : 'Tentativo già registrato. Verifica il registro degli invii.')
      await load(); await onChanged()
    } catch (err) { setError(err instanceof Error ? err.message : 'Invio da verificare. Controlla il registro prima di riprovare.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <section className={styles.list} aria-label="Coda Aspetta te">
    <p className={styles.muted}>Le decisioni aggiornano il lavoro. Gli avvisi si possono segnare come letti, anche in gruppo.</p>
    <div className={styles.chips} aria-label="Filtra la coda">
      {([['all', 'Tutte'], ['decisions', 'Decisioni'], ['documents', 'Documenti'], ['notices', 'Avvisi']] as const).map(([key, label]) =>
        <button type="button" key={key} disabled={busy} aria-pressed={filter === key} className={filter === key ? styles.on : ''} onClick={() => setFilter(key)}>
          {label} ({key === 'all' ? groups.length : groups.filter((group) => group.category === key).length})
        </button>)}
    </div>
    {page.total > 50 && <p className={styles.muted}>Filtri e selezione si riferiscono alle voci di questa pagina.</p>}
    {visible.length > 0 && <div className={styles.actions}>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSelected(new Set(visible.flatMap((group) => group.ids)))}>Seleziona questa vista</button>
      {selectedIds.length > 0 && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSelected(new Set())}>Deseleziona</button>}
    </div>}
    {selectedIds.length > 0 && <div className={styles.inboxToolbar} role="region" aria-label="Azioni sulla selezione">
      <strong>{selectedGroups.length} voci selezionate · {selectedIds.length} elementi</strong>
      <p>{decisionsOnly ? 'Applicherai gli effetti descritti nelle proposte selezionate.'
        : noticesOnly ? 'Archivia gli avvisi selezionati. I documenti e i lavori collegati conservano il loro stato.'
          : 'Seleziona solo decisioni oppure solo avvisi per applicare un’azione in gruppo.'}</p>
      <div className={styles.actions}>
        {decisionsOnly && <><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { void process(selectedIds, 'approved') }}>Approva selezionate ({selectedGroups.length})</button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void process(selectedIds, 'rejected') }}>Rifiuta selezionate ({selectedGroups.length})</button></>}
        {noticesOnly && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { void process(selectedIds, 'acknowledge') }}>Archivia avvisi selezionati ({selectedIds.length})</button>}
      </div>
    </div>}
    {busy && <p role="status" className={styles.muted}>Applico le azioni selezionate…</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {visible.length === 0 && <p className={styles.muted}>{page.total === 0 ? 'Nessuna uscita da valutare.' : 'Nessuna voce in questa vista.'}</p>}
    {visible.map((group) => {
      const output = group.output
      const effect = officeApprovalEffect(output)
      const failure = group.ids.flatMap((id) => failures[id] ? [failures[id]] : [])
      return <article key={group.id} id={`pannello-uscita-${output.id}`} className={`${styles.card} ${highlight && group.ids.includes(highlight) ? styles.lit : ''}`}>
        {group.ids.map((id) => <span id={`uscita-${id}`} key={id} />)}
        <div className={styles.inboxHeading}>
          <input type="checkbox" disabled={busy} checked={group.ids.every((id) => selected.has(id))} aria-label={`Seleziona ${group.title}`}
            onChange={(event) => setSelected((old) => { const next = new Set(old); for (const id of group.ids) event.target.checked ? next.add(id) : next.delete(id); return next })} />
          <h3>{group.title}</h3>
        </div>
        <small>{data.agents.find((agent) => agent.id === output.agent_id)?.name || output.agent_id} · {date(output.created_at)}</small>
        {group.ids.length > 1 && <p className={styles.muted}>{group.ids.length} avvisi sulla stessa presentazione, raggruppati. Dettagli dell’avviso più recente.</p>}
        {output.document && <p className={styles.last}>{INBOX_DOCUMENT_STATES[output.document.status] || output.document.status} · versione {output.document.version}</p>}
        {output.document && typeof output.body.version === 'number' && output.body.version !== output.document.version
          && <p className={styles.muted}>Questo avviso riguarda la versione {output.body.version}. Il documento è ora alla versione {output.document.version}.</p>}
        <details open={!!highlight && group.ids.includes(highlight)}><summary>Leggi</summary><div className={styles.body}><OutputBody value={output.body} hide={output.body.action === 'create_contact' ? CONTACT_HIDDEN_KEYS : undefined} /></div></details>
        <p className={styles.effect}>{group.category === 'decisions' ? effect.description : group.category === 'documents'
          ? 'Rivedi il documento dalla sua scheda. Archiviare questi avvisi non approva la presentazione.' : 'Segna come letto per togliere questo rapporto dalla coda.'}</p>
        {failure.length > 0 && <p role="alert" className={styles.error}>{[...new Set(failure)].join(' ')}</p>}
        <div className={styles.actions}>
          {group.href && <Link className="btn btn-primary btn-sm" href={group.href}>Apri documento →</Link>}
          {group.category === 'decisions' ? <>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { void process(group.ids, 'approved') }}>{effect.label}</button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void process(group.ids, 'rejected') }}>Rifiuta</button>
          </> : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void process(group.ids, 'acknowledge') }}>{group.category === 'documents' ? `Archivia ${group.ids.length > 1 ? `${group.ids.length} avvisi` : 'avviso'}` : 'Segna come letto'}</button>}
          {output.agent_id === 'news_watch' && output.body.telegram_available === true && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void telegram(output.id) }}>Approva e invia su Telegram</button>}
        </div>
      </article>
    })}
    {(page.total > 50 || offset > 0) && <div className={styles.actions}>
      <button className="btn btn-ghost btn-sm" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Precedenti</button>
      <span className={styles.muted}>{Math.min(offset + 1, page.total)}–{Math.min(offset + 50, page.total)} di {page.total}</span>
      <button className="btn btn-ghost btn-sm" disabled={busy || offset + 50 >= page.total} onClick={() => setOffset(offset + 50)}>Successive</button>
    </div>}
  </section>
}
