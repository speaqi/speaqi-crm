'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/app/(app)/layout'

type WhatsappStatus = {
  config: {
    configured: boolean
    enabled: boolean
    missing: string[]
    chat_id: string | null
  }
  events: string[]
  session: {
    ok: boolean
    status?: string
    phone?: string | null
    push_name?: string | null
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
  email_reply: 'Risposte (subito)',
  email_unsubscribe: 'Disiscrizioni',
}

export default function WhatsappSettingsPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [status, setStatus] = useState<WhatsappStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await apiFetch<WhatsappStatus>('/api/whatsapp/status'))
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

  async function run(action: 'test' | 'digest') {
    setBusy(action)
    setError('')
    try {
      const result = await apiFetch<{ ok: boolean; sent?: boolean; pending?: number; error?: string | null }>(
        '/api/whatsapp/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      )
      if (action === 'test') {
        showToast(result.ok ? 'Messaggio di prova inviato' : `Invio fallito: ${result.error || 'errore'}`)
      } else {
        showToast(
          result.sent
            ? `Riepilogo inviato (${result.pending} eventi)`
            : 'Nessun evento in coda da riepilogare'
        )
      }
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Azione non riuscita')
    } finally {
      setBusy('')
    }
  }

  if (!isAdmin) return <div className="inline-error">Le notifiche WhatsApp sono riservate agli amministratori.</div>
  if (loading) return <div className="page-container"><p>Caricamento stato WhatsApp…</p></div>

  const config = status?.config
  const session = status?.session
  const sessionReady = session?.ok && session.status === 'ready'

  return (
    <div className="page-container">
      <div className="page-header">
        <Link href="/impostazioni" className="btn btn-ghost btn-sm">← Impostazioni</Link>
        <h1>Notifiche WhatsApp</h1>
        <p className="page-subtitle">
          Gateway OpenWA self-hosted: risposte email subito, invii e reazioni in un riepilogo periodico.
        </p>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <section className="settings-card" style={{ display: 'block', padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Stato</h2>
        <ul style={{ lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>
          <li>
            Configurazione:{' '}
            {config?.configured
              ? '✅ completa'
              : `⚠️ mancano ${config?.missing.join(', ') || 'variabili'}`}
          </li>
          <li>Interruttore <code>WHATSAPP_NOTIFY_ENABLED</code>: {config?.enabled ? '✅ attivo' : '⏸️ spento'}</li>
          <li>Numero destinatario: {config?.chat_id || '—'}</li>
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
          <li>
            Eventi attivi:{' '}
            {(status?.events || []).map((event) => EVENT_LABELS[event] || event).join(' · ') || '—'}
          </li>
        </ul>
      </section>

      <section className="settings-card" style={{ display: 'block', padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Prove</h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          Il riepilogo gira da solo ogni 30 minuti (workflow n8n <code>14-whatsapp-digest</code>); questo pulsante lo
          anticipa e svuota la coda adesso.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => run('test')} disabled={busy !== ''}>
            {busy === 'test' ? 'Invio…' : 'Manda messaggio di prova'}
          </button>
          <button className="btn btn-primary" onClick={() => run('digest')} disabled={busy !== ''}>
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
