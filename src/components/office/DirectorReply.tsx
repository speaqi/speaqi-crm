'use client'

import { useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import styles from '@/app/(app)/ufficio/ufficio.module.css'

/** Conserva nel testo dell'ordine il riferimento alla voce a cui il titolare risponde. */
export function DirectorReply({ reference, title, onChanged }: { reference: string; title: string; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!message.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const text = `In riferimento a ${title.slice(0, 300)} (riferimento ${reference}):\n${message.trim()}`
      await apiFetch('/api/office/director/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      setMessage(''); setOpen(false); setNotice('Messaggio registrato negli ordini del Direttore. La voce rimane aperta finché non viene risolta o decisa.')
      onChanged?.()
    } catch (err) { setError(err instanceof Error ? err.message : 'Messaggio non registrato. Riprova.') }
    finally { setBusy(false) }
  }
  return <div>
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>Rispondi al Direttore</button>
    {open && <form className={styles.workEditor} onSubmit={send}>
      <label>Messaggio al Direttore per «{title}»<textarea rows={3} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
      <p className={styles.muted}>Il messaggio include il riferimento a questa voce. Una risposta non approva automaticamente una proposta.</p>
      <button className="btn btn-primary btn-sm" disabled={busy || !message.trim()}>{busy ? 'Registro…' : 'Invia al Direttore'}</button>
    </form>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
