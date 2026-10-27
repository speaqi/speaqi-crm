'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '@/lib/api'
import { WorkList } from '@/components/office/WorkList'
import styles from './director.module.css'

type Order = {
  id: string; source: 'web' | 'telegram'; text: string; attachments: Array<{ name: string }>
  status: 'received' | 'working' | 'waiting' | 'blocked' | 'cancelled' | 'done' | 'waiting_you' | 'failed'; reply: string | null; created_at: string
}

const STATUS: Record<Order['status'], string> = {
  received: 'Ricevuto', working: 'Ci sto lavorando', done: 'Fatto', waiting_you: 'Aspetta te', failed: 'Non fatto',
  waiting: 'In attesa', blocked: 'Bloccato', cancelled: 'Annullato',
}
const date = (value: string) => new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * La casella per parlare al Direttore: testo, foto del bigliettino, voce.
 * L'ordine parte subito; la risposta arriva qui sotto quando il Direttore ha finito.
 */
export function DirectorOrders({ directorEnabled, onEnable, onChanged, compact = false }: {
  directorEnabled: boolean; onEnable: () => Promise<void>; onChanged: () => void
  /** Nel pannello dell'Ufficio: esempi in una riga e solo gli ultimi ordini. */
  compact?: boolean
}) {
  const [orders, setOrders] = useState<Order[]>([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [workOrderId, setWorkOrderId] = useState<string | null>(null)
  const changedCallback = useRef(onChanged)
  useEffect(() => { changedCallback.current = onChanged }, [onChanged])
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const fileInput = useRef<HTMLInputElement | null>(null)
  const working = orders.some((order) => ['received', 'working', 'waiting'].includes(order.status))

  const load = useCallback(async () => {
    const response = await apiFetch<{ orders: Order[] }>('/api/office/director/orders')
    setOrders(Array.isArray(response?.orders) ? response.orders : [])
  }, [])
  useEffect(() => { void load().catch(() => {}) }, [load])
  // Il server lavora anche a pagina chiusa. Qui si aggiorna solo la vista attiva.
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load().then(() => changedCallback.current()).catch(() => {})
    }, 30_000)
    return () => clearInterval(timer)
  }, [working, load])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load().catch(() => {}) }
    window.addEventListener('office:work-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('office:work-changed', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [load])

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!text.trim() && !files.length) return
    setSending(true); setError('')
    try {
      const form = new FormData()
      form.set('text', text)
      files.forEach((file) => form.append('files', file))
      await apiFetch('/api/office/director/orders', { method: 'POST', body: form })
      setText(''); setFiles([])
      if (fileInput.current) fileInput.current.value = ''
      await load()
      changedCallback.current()
    } catch (err) { setError(err instanceof Error ? err.message : 'Ordine non inviato') }
    finally { setSending(false) }
  }

  async function toggleMic() {
    if (recording) { recorder.current?.stop(); return }
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        setRecording(false)
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        if (!blob.size) return
        setTranscribing(true)
        try {
          const form = new FormData()
          form.set('audio', new File([blob], 'direttore.webm', { type: blob.type }))
          const { transcript } = await apiFetch<{ transcript: string }>('/api/ai/transcribe', { method: 'POST', body: form })
          setText((current) => [current.trim(), String(transcript || '').trim()].filter(Boolean).join(' '))
        } catch (err) { setError(err instanceof Error ? err.message : 'Trascrizione non riuscita') }
        finally { setTranscribing(false) }
      }
      rec.start(250)
      recorder.current = rec
      setRecording(true)
    } catch { setError('Microfono non disponibile: controlla il permesso del browser.') }
  }

  return <section className={styles.box} aria-labelledby="direttore-titolo">
    <h2 id="direttore-titolo">Scrivi al Direttore</h2>
    {compact ? <p className={styles.hint}>Un contatto o la foto del bigliettino, «prepara la presentazione per Visit Marseille», «come va la pipeline?», «ricordami di chiamare Rossi venerdì».</p>
      : <p className={styles.hint}>Un contatto (anche la foto del bigliettino), «costruisci la mappa di Marsiglia da questo link», «prepara la presentazione per Visit Marseille», «controlla la mappa di Barcellona», «come va la pipeline?», «ricordami di chiamare Rossi venerdì». Ti propongo i contatti prima di inserirli; il resto lo passo all’agente giusto.</p>}
    {!directorEnabled && <p className={styles.off}>Il Direttore è spento: gli ordini restano in attesa e riprendono quando lo accendi. <button type="button" className="btn btn-primary btn-sm" onClick={() => { void onEnable() }}>Accendi il Direttore</button></p>}
    <form onSubmit={send} className={styles.form}>
      <textarea rows={3} value={text} maxLength={4000} placeholder="Cosa devo fare?" onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <div className={styles.row}>
        <label className="btn btn-ghost btn-sm">📷 Foto
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
            onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 4))} />
        </label>
        <button type="button" className={`btn btn-ghost btn-sm ${recording ? styles.rec : ''}`} onClick={() => { void toggleMic() }} disabled={transcribing}>
          {recording ? '■ Ferma' : transcribing ? 'Trascrivo…' : '🎙 Parla'}
        </button>
        {files.length > 0 && <span className={styles.files}>{files.map((file) => file.name).join(', ')}</span>}
        <button className="btn btn-primary btn-sm" disabled={sending || recording || (!text.trim() && !files.length)}>{sending ? 'Invio…' : 'Manda al Direttore'}</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>
    {orders.length > 0 && <ul className={styles.orders}>
      {orders.slice(0, compact && !showAll ? 3 : 10).map((order) => <li key={order.id}>
        <div className={styles.meta}><span className={styles[`s_${order.status}`]}>{STATUS[order.status]}</span>
          <small>{date(order.created_at)}{order.source === 'telegram' ? ' · Telegram' : ''}{order.attachments?.length ? ` · ${order.attachments.length} foto` : ''}</small></div>
        {order.text && <p className={styles.said}>«{order.text}»</p>}
        {order.reply && <p className={styles.reply}>{order.reply}</p>}
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={workOrderId === order.id}
          onClick={() => setWorkOrderId((current) => current === order.id ? null : order.id)}>{workOrderId === order.id ? 'Chiudi lavori dell’ordine' : 'Lavori dell’ordine'}</button>
        {workOrderId === order.id && <WorkList orderId={order.id} compact refreshSignal={order} onChanged={onChanged} />}
      </li>)}
    </ul>}
    {compact && !showAll && orders.length > 3 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAll(true)}>Ordini precedenti ({Math.min(orders.length, 10) - 3})</button>}
  </section>
}
