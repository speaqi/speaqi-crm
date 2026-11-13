'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

type Candidate = { id: string; title?: string | null; note?: string | null; status?: string; numero?: string | null; external_number?: string | null; externally_issued?: boolean; customer?: { denominazione?: string }; totale?: number; issue_date?: string; payment_state?: string }
type LinkRow = { task_id: string; invoice_id: string }

/** Una relazione esplicita con la scheda della lavagna, distinta dal documento fiscale. */
export function InvoiceTaskLinks({ taskId, invoiceId }: { taskId?: string; invoiceId?: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const field = taskId ? `task_id=${encodeURIComponent(taskId)}` : `invoice_id=${encodeURIComponent(invoiceId || '')}`
  const load = useCallback(async () => {
    setLoading(true)
    try { const result = await apiFetch<{ links: LinkRow[]; candidates: Candidate[] }>(`/api/invoices/task-links?${field}`); setLinks(result.links); setCandidates(result.candidates); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossibile caricare i collegamenti') } finally { setLoading(false) }
  }, [field])
  useEffect(() => { void load() }, [load])
  const linkedIds = new Set(links.map((item) => taskId ? item.invoice_id : item.task_id))
  const linked = candidates.filter((item) => linkedIds.has(item.id))
  const available = candidates.filter((item) => !linkedIds.has(item.id))
  function label(item: Candidate) {
    if (taskId) {
      const number = item.externally_issued ? item.external_number : item.numero
      const amount = Number(item.totale || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
      return `${number ? `Fattura ${number}` : 'Bozza'} · ${item.customer?.denominazione || 'Cliente'} · ${amount}${item.payment_state === 'paid' ? ' · incassata' : item.payment_state === 'unpaid' ? ' · da incassare' : ''}`
    }
    return `${item.title || item.note || 'Attività'}${item.status === 'done' ? ' · completata' : ''}`
  }
  async function change(id: string, remove: boolean) {
    setBusy(true)
    try {
      await apiFetch('/api/invoices/task-links', { method: remove ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: taskId || id, invoice_id: invoiceId || id }) })
      setSelected(''); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossibile aggiornare il collegamento') } finally { setBusy(false) }
  }
  return <div className="todo-field todo-field-wide" style={{ margin: '12px 0' }}>
    <strong>{taskId ? 'Fatture collegate' : 'Attività della lavagna collegate'}</strong>
    {error && <p className="cc-error">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Riprova</button></p>}
    {loading ? <p className="cc-muted">Caricamento…</p> : <>
      {!linked.length && <p className="cc-muted">Nessun collegamento.</p>}
      {linked.map(item => <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {taskId ? <Link href={`/fatture?invoice=${item.id}`}>{label(item)}</Link> : <span>{label(item)}</span>}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void change(item.id, true)}>Scollega</button>
      </div>)}
      {linked.length < links.length && <p className="cc-muted">Alcuni collegamenti non sono nell’elenco caricato.</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 8 }}>
        <label>{taskId ? 'Collega una fattura' : 'Collega un’attività'} <select className="fi" value={selected} onChange={e => setSelected(e.target.value)} disabled={busy || !available.length}><option value="">Seleziona…</option>{available.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}</select></label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !selected} onClick={() => void change(selected, false)}>Collega</button>
      </div>
    </>}
  </div>
}
