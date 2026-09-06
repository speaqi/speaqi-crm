'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/app/(app)/layout'

type WhatsappSettings = {
  notify_to: string | null
  enabled: boolean
  events: string[]
}

type WhatsappStatus = {
  gateway: { configured: boolean; missing: string[]; hard_disabled: boolean }
  settings: WhatsappSettings
  chat_id: string | null
  all_events: string[]
  session: {
    ok: boolean
    status?: string
    phone?: string | null
    connected_at?: string | null
    last_error?: string | null
    error?: string
  } | null
  pending_events: number | null
}

const EVENT_LABELS: Record<string, string> = {
  email_sent: 'Email inviate',
  email_open: 'Aperture',
  email_click: 'Click',
  email_reply: 'Risposte (messaggio immediato)',
  email_unsubscribe: 'Disiscrizioni',
}

export default function WhatsappSettingsPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [status, setStatus] = useState<WhatsappStatus | null>(null)
  const [notifyTo, setNotifyTo] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiFetch<WhatsappStatus>('/api/whatsapp/status')
      setStatus(result)
      setNotifyTo(result.settings.notify_to || '')
      setEnabled(result.settings.enabled)
      setEvents(result.settings.events)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Stato WhatsApp non disponibile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    load()
  }, [isAdmin, load])

  async function save() {
    setBusy('save')
    setError('')
    try {
      const result = await apiFetch<{ settings: WhatsappSettings }>('/api/whatsapp/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', notify_to: notifyTo, enabled, events }),
      })
      showToast(
        result.settings.enabled
          ? `Notifiche attive verso ${result.settings.notify_to}`
          : 'Notifiche WhatsApp salvate (spente)'
      )
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio non riuscito')
    } finally {
      setBusy('')
    }
  }

  async function run(action: 'test' | 'digest') {
    setBusy(action)
    setError('')
    try {
      const result = await apiFetch<{
        ok: boolean
        sent?: boolean
        pending?: number
        reason?: string
        error?: string | null
      }>('/api/whatsapp/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (action === 'test') {
        showToast(result.ok ? 'Messaggio di prova inviato' : `Invio fallito: ${result.error || 'errore'}`)
      } else {
        showToast(
          result.sent
            ? `Riepilogo inviato (${result.pending} eventi)`
            : result.reason || 'Nessun evento in coda da riepilogare'
        )
      }
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Azione non riuscita')
    } finally {
      setBusy('')
    }
  }

  function toggleEvent(event: string) {
    setEvents((previous) =>
      previous.includes(event) ? previous.filter((item) => item !== event) : [...previous, event]
    )
  }

  if (!isAdmin) return <div className="inline-error">Le notifiche WhatsApp sono riservate agli amministratori.</div>
  if (loading) return <div className="page-container"><p>Caricamento stato WhatsApp…</p></div>

  const gateway = status?.gateway
  const session = status?.session
  const sessionReady = session?.ok && session.status === 'ready'
  const allEvents = status?.all_events || []

  return (
    <div className="page-container">
      <div className="page-header">
        <Link href="/impostazioni" className="btn btn-ghost btn-sm">← Impostazioni</Link>
        <h1>Notifiche WhatsApp</h1>
        <p className="page-subtitle">
          Le risposte email arrivano subito, invii e reazioni in un riepilogo ogni mezz&apos;ora.
        </p>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <section className="settings-card" style={{ display: 'block', padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Dove arrivano</h2>

        <label className="form-label" htmlFor="whatsapp-notify-to">Numero WhatsApp</label>
        <input
          id="whatsapp-notify-to"
          className="form-input"
          value={notifyTo}
          onChange={(event) => setNotifyTo(event.target.value)}
          placeholder="+39 389 6868162"
          style={{ maxWidth: 320 }}
        />
        <p className="page-subtitle" style={{ marginTop: 4 }}>
          Un numero italiano senza prefisso prende il +39 in automatico.
          {status?.chat_id ? ` Destinatario in uso: ${status.chat_id}` : ''}
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Notifiche attive</span>
        </label>

        <div style={{ marginBottom: 16 }}>
          <div className="form-label">Cosa notificare</div>
          {allEvents.map((event) => (
            <label key={event} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              <span>{EVENT_LABELS[event] || event}</span>
            </label>
          ))}
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Su liste grandi le aperture sono centinaia al giorno: se il riepilogo diventa illeggibile, togli
            &ldquo;Aperture&rdquo; e tieni click e risposte.
          </p>
        </div>

        <button className="btn btn-primary" onClick={save} disabled={busy !== ''}>
          {busy === 'save' ? 'Salvataggio…' : 'Salva'}
        </button>
      </section>

      <section className="settings-card" style={{ display: 'block', padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Stato e prove</h2>
        <ul style={{ lineHeight: 1.9, margin: '0 0 12px', paddingLeft: 18 }}>
          <li>
            Gateway OpenWA:{' '}
            {gateway?.configured ? '✅ configurato' : `⚠️ mancano ${gateway?.missing.join(', ') || 'variabili'}`}
          </li>
          {gateway?.hard_disabled ? <li>⛔ <code>WHATSAPP_NOTIFY_ENABLED=false</code>: tutto spento dalle env</li> : null}
          <li>
            Sessione WhatsApp:{' '}
            {!session
              ? '—'
              : session.ok
                ? `${sessionReady ? '✅' : '⚠️'} ${session.status}${session.phone ? ` · ${session.phone}` : ''}`
                : `❌ ${session.error}`}
          </li>
          {session?.last_error ? <li>Ultimo errore gateway: {session.last_error}</li> : null}
          <li>Eventi in coda non ancora notificati: {status?.pending_events ?? '—'}</li>
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => run('test')} disabled={busy !== ''}>
            {busy === 'test' ? 'Invio…' : 'Manda messaggio di prova'}
          </button>
          <button className="btn btn-secondary" onClick={() => run('digest')} disabled={busy !== ''}>
            {busy === 'digest' ? 'Invio…' : 'Manda subito il riepilogo'}
          </button>
          <button className="btn btn-ghost" onClick={load} disabled={busy !== ''}>
            Aggiorna stato
          </button>
        </div>
      </section>
    </div>
  )
}
