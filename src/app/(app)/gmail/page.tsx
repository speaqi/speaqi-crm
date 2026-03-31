'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { formatDateTime } from '@/lib/data'
import type { GmailAccountStatus, SentMessageHistoryItem } from '@/types'

type GmailStatusResponse = {
  ready: boolean
  gmail: GmailAccountStatus
  sent_history: SentMessageHistoryItem[]
  error?: string
}

export default function GmailPage() {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<GmailStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function loadStatus() {
    setLoading(true)
    try {
      const payload = await apiFetch<GmailStatusResponse>('/api/gmail')
      setStatus(payload)
    } catch (error) {
      setStatus({
        ready: false,
        gmail: { connected: false },
        sent_history: [],
        error: error instanceof Error ? error.message : 'Impossibile leggere lo stato Gmail',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const oauthStatus = searchParams.get('gmail')
  const oauthMessage = searchParams.get('message')

  return (
    <div className="dash-content">
      <div className="detail-grid">
        <div className="dash-card" style={{ display: 'grid', gap: 16 }}>
          <div>
            <div className="dash-card-title" style={{ marginBottom: 6 }}>Gmail integrato nel CRM</div>
            <p style={{ color: 'var(--text2)', lineHeight: 1.6 }}>
              Collega Gmail per inviare email dai contatti e sincronizzare i messaggi che hai già mandato o ricevuto.
            </p>
          </div>

          {oauthStatus === 'connected' && (
            <div className="inline-success">Gmail collegato correttamente.</div>
          )}

          {oauthStatus === 'error' && (
            <div className="inline-error">
              <strong>Errore Gmail:</strong> {oauthMessage || 'Connessione non completata'}
            </div>
          )}

          {status?.error && (
            <div className="inline-error">
              <strong>Setup Gmail:</strong> {status.error}
            </div>
          )}

          <div className="detail-stack" style={{ gap: 10 }}>
            <div><strong>Stato:</strong> {loading ? 'Verifica in corso...' : status?.gmail.connected ? 'Connesso' : 'Non connesso'}</div>
            <div><strong>Account:</strong> {status?.gmail.email || 'Nessun account collegato'}</div>
            <div><strong>Ultima sync:</strong> {formatDateTime(status?.gmail.last_sync_at)}</div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              disabled={busy || loading || status?.ready === false}
              onClick={async () => {
                try {
                  setBusy(true)
                  const payload = await apiFetch<{ url: string }>('/api/gmail/connect', {
                    method: 'POST',
                  })
                  window.location.href = payload.url
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : 'Impossibile collegare Gmail')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {status?.gmail.connected ? 'Ricollega Gmail' : 'Collega Gmail'}
            </button>

            <button
              className="btn btn-ghost"
              disabled={busy || loading || !status?.gmail.connected}
              onClick={async () => {
                try {
                  setBusy(true)
                  await apiFetch('/api/gmail', {
                    method: 'DELETE',
                  })
                  await loadStatus()
                } catch (error) {
                  window.alert(error instanceof Error ? error.message : 'Impossibile scollegare Gmail')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Disconnetti
            </button>
          </div>

          <div style={{ color: 'var(--text2)', lineHeight: 1.6, fontSize: 13 }}>
            Dopo la connessione, nella scheda contatto trovi il thread email, il pulsante di sync e l’invio diretto da Gmail.
            Le email inviate dal CRM possono anche creare un follow-up automatico.
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">Storico messaggi inviati</div>
          <div className="task-list">
            {(status?.sent_history || []).length === 0 ? (
              <p style={{ color: 'var(--text2)' }}>Nessun messaggio inviato registrato.</p>
            ) : (
              (status?.sent_history || []).map((message) => (
                <div key={message.id} className="task-card">
                  <div>
                    <strong>{message.subject || 'Senza oggetto'}</strong>
                    <div className="task-date">
                      {message.source} · {formatDateTime(message.sent_at)}
                    </div>
                    <div className="task-note">
                      {message.recipient} · stato {message.status || 'sent'}
                    </div>
                  </div>
                  <div className="task-actions">
                    {message.contact ? (
                      <Link href={`/contacts/${message.contact.id}`} className="btn btn-ghost btn-sm">
                        {message.contact.name}
                      </Link>
                    ) : (
                      <span className="ctag" style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                        Log sistema
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
