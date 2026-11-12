'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import type { RecurringInput, RecurringOrder } from '@/lib/office-recurring'
import { WorkList } from './WorkList'
import { OfficeReportConfig } from './OfficeReportConfig'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const fresh = (): RecurringInput => ({ title: '', instruction: '', every_days: 1, local_time: '09:00', next_local_date: today(), enabled: true })
const labels = { 1: 'Ogni giorno', 2: 'Ogni due giorni', 7: 'Ogni settimana' } as const

export function RecurringOrders() {
  const [items, setItems] = useState<RecurringOrder[]>([])
  const [form, setForm] = useState<RecurringInput>(fresh)
  const [editing, setEditing] = useState<RecurringOrder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  const load = useCallback(async () => {
    const result = await apiFetch<{ schedules: RecurringOrder[] }>('/api/office/recurring')
    setItems(result.schedules)
  }, [])
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Agenda non disponibile')) }, [load])
  const edit = (item: RecurringOrder) => {
    setEditing(item); setNotice(''); setError('')
    setForm({ title: item.title, instruction: item.instruction, every_days: item.every_days, local_time: item.local_time.slice(0, 5),
      next_local_date: item.next_local_date, enabled: item.enabled })
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      await apiFetch(editing ? `/api/office/recurring/${editing.id}` : '/api/office/recurring', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ...(editing ? { revision: editing.revision } : {}) }),
      })
      setNotice(editing ? 'Incarico aggiornato.' : 'Incarico programmato.'); setEditing(null); setForm(fresh()); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossibile salvare') }
    finally { setBusy(false) }
  }
  async function toggle(item: RecurringOrder) {
    setBusy(true); setError(''); setNotice('')
    try {
      await apiFetch(`/api/office/recurring/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, instruction: item.instruction, every_days: item.every_days,
          local_time: item.local_time, next_local_date: item.next_local_date, enabled: !item.enabled, revision: item.revision }) })
      setNotice(item.enabled ? 'Incarico in pausa.' : 'Incarico riattivato.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossibile aggiornare') }
    finally { setBusy(false) }
  }
  return <section className={styles.list} aria-label="Incarichi ricorrenti">
    <p className={styles.muted}>Il Direttore riceve l’incarico alla frequenza scelta, nell’ora di Roma. Se l’ufficio è spento, non lavora finché non viene riattivato.</p>
    <form onSubmit={save} className={`${styles.card} ${styles.agendaForm}`}>
      <h3>{editing ? 'Modifica incarico' : 'Programma un incarico'}</h3>
      <label>Titolo <input required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label>Istruzioni <textarea required maxLength={4000} rows={3} value={form.instruction} onChange={(e) => setForm({ ...form, instruction: e.target.value })} /></label>
      <div className={styles.actions}>
        <label>Frequenza <select value={form.every_days} onChange={(e) => setForm({ ...form, every_days: Number(e.target.value) as 1 | 2 | 7 })}>
          <option value={1}>Ogni giorno</option><option value={2}>Ogni due giorni</option><option value={7}>Ogni settimana</option>
        </select></label>
        <label>Primo o prossimo giorno <input type="date" required value={form.next_local_date} onChange={(e) => setForm({ ...form, next_local_date: e.target.value })} /></label>
        <label>Ora <input type="time" required value={form.local_time} onChange={(e) => setForm({ ...form, local_time: e.target.value })} /></label>
      </div>
      <div className={styles.actions}><button className="btn btn-primary btn-sm" disabled={busy}>{editing ? 'Salva modifiche' : 'Programma'}</button>
        {editing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setForm(fresh()) }}>Annulla</button>}</div>
    </form>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    <OfficeReportConfig />
    {items.map((item) => <article key={item.id} className={styles.card}>
      <h3>{item.title}</h3><p>{item.instruction}</p>
      <p className={styles.muted}>{item.enabled ? 'Attivo' : 'In pausa'} · {labels[item.every_days]} · prossimo turno {new Date(item.next_due_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>
      {item.last_scheduled_at && <p className={styles.muted}>Ultimo turno: {new Date(item.last_scheduled_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}</p>}
      {item.last_skipped_at && <p className={styles.muted}>Un turno è stato saltato perché quello precedente era ancora aperto.</p>}
      <div className={styles.actions}><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => edit(item)}>Modifica</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void toggle(item) }}>{item.enabled ? 'Metti in pausa' : 'Riattiva'}</button>
        {item.last_order_id && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={openOrder === item.last_order_id}
          onClick={() => setOpenOrder(openOrder === item.last_order_id ? null : item.last_order_id)}>Ultimo risultato</button>}</div>
      {item.last_order_id && openOrder === item.last_order_id && <WorkList orderId={item.last_order_id} compact refreshSignal={item.revision} onChanged={() => { void load() }} />}
    </article>)}
  </section>
}
