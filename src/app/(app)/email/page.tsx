'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type EmailDraft = {
  id: string
  contact_id: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  gmail_draft_id: string | null
  status: string
  source: string
  created_at: string
  sent_at: string | null
  note?: string | null
  contact?: {
    id: string
    name: string
    email: string | null
    company: string | null
    status: string
    score: number | null
    priority: number
    next_followup_at: string | null
  }
}

function formatDate(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function urgencyLabel(nextFollowupAt?: string | null): { label: string; className: string } | null {
  if (!nextFollowupAt) return null
  const now = Date.now()
  const due = new Date(nextFollowupAt).getTime()
  if (due < now) return { label: 'Scaduto', className: 'urgency-overdue' }
  const diffDays = Math.ceil((due - now) / (24 * 60 * 60 * 1000))
  if (diffDays === 0) return { label: 'Oggi', className: 'urgency-today' }
  if (diffDays === 1) return { label: 'Domani', className: 'urgency-tomorrow' }
  return { label: `+${diffDays}gg`, className: 'urgency-later' }
}

function scoreBadge(score: number | null | undefined): string {
  if (score == null) return ''
  if (score >= 80) return '🔥'
  if (score >= 60) return '⭐'
  return ''
}

export default function EmailPage() {
  const { showToast, refresh } = useCRMContext()
  const [drafts, setDrafts] = useState<EmailDraft[]>([])
  const [sent, setSent] = useState<EmailDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'sent'>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [regenerateNotes, setRegenerateNotes] = useState<Record<string, string>>({})
  const [editedSubjects, setEditedSubjects] = useState<Record<string, string>>({})
  const [editedBodies, setEditedBodies] = useState<Record<string, string>>({})
  const [recordingDraftId, setRecordingDraftId] = useState<string | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcribingDraftId, setTranscribingDraftId] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [pendingRes, sentRes] = await Promise.all([
        apiFetch<{ drafts: EmailDraft[] }>('/api/automation/drafts?status=pending'),
        apiFetch<{ drafts: EmailDraft[] }>('/api/automation/drafts?status=sent'),
      ])
      setDrafts(pendingRes.drafts || [])
      setSent(sentRes.drafts || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      const recorder = mediaRecorderRef.current
      if (recorder?.state === 'recording') recorder.stop()
      recorder?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function setBusy(id: string) {
    setBusyIds((prev) => new Set(prev).add(id))
  }
  function clearBusy(id: string) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleSend(draft: EmailDraft) {
    setBusy(draft.id)
    try {
      await apiFetch('/api/automation/send-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft_id: draft.id,
          mode: 'send',
          subject: editedSubjects[draft.id] ?? draft.subject ?? '',
          body_text: editedBodies[draft.id] ?? draft.body_text ?? '',
        }),
      })
      showToast(`Email inviata a ${draft.contact?.name || 'contatto'}`)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
      refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invio fallito')
    } finally {
      clearBusy(draft.id)
    }
  }

  async function handleDismiss(draft: EmailDraft) {
    setBusy(draft.id)
    try {
      await apiFetch('/api/automation/send-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft_id: draft.id, mode: 'dismiss' }),
      })
      showToast(`Bozza archiviata per ${draft.contact?.name || 'contatto'}`)
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Errore')
    } finally {
      clearBusy(draft.id)
    }
  }

  async function handleRegenerate(draft: EmailDraft, explicitNote?: string) {
    setBusy(draft.id)
    try {
      const note = explicitNote?.trim() || regenerateNotes[draft.id]?.trim() ||
        draft.note?.trim() || undefined
      const result = await apiFetch<{ draft: EmailDraft; regenerated: boolean }>(
        '/api/automation/regenerate-draft',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft_id: draft.id, note }),
        }
      )
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, ...result.draft } : d))
      )
      setEditedSubjects((prev) => ({ ...prev, [draft.id]: result.draft.subject || '' }))
      setEditedBodies((prev) => ({ ...prev, [draft.id]: result.draft.body_text || '' }))
      if (note) {
        setRegenerateNotes((prev) => ({ ...prev, [draft.id]: note }))
      }
      showToast(`Bozza rigenerata per ${draft.contact?.name || 'contatto'}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rigenerazione fallita')
    } finally {
      clearBusy(draft.id)
    }
  }

  async function transcribeAndRegenerate(draft: EmailDraft, audio: Blob, fileName: string) {
    if (!audio.size) {
      showToast('Il vocale registrato è vuoto')
      return
    }

    setTranscribingDraftId(draft.id)
    try {
      const formData = new FormData()
      formData.append('audio', audio, fileName)
      const result = await apiFetch<{ transcript: string }>('/api/ai/transcribe', {
        method: 'POST',
        body: formData,
      })
      const transcript = result.transcript.trim()
      setRegenerateNotes((prev) => ({ ...prev, [draft.id]: transcript }))
      await handleRegenerate(draft, transcript)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Trascrizione fallita')
    } finally {
      setTranscribingDraftId(null)
    }
  }

  async function startVoiceContext(draft: EmailDraft) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('La registrazione audio non è supportata da questo browser')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferredMimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream)

      audioChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        const mimeType = recorder.mimeType || preferredMimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
        setRecordingDraftId(null)
        setRecordingSeconds(0)
        void transcribeAndRegenerate(draft, blob, `contesto-vocale.${extension}`)
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      setRecordingDraftId(draft.id)
      setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => {
          if (seconds >= 179 && recorder.state === 'recording') recorder.stop()
          return seconds + 1
        })
      }, 1000)
    } catch (err) {
      showToast(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Consenti l’accesso al microfono per registrare il contesto'
          : 'Impossibile avviare la registrazione'
      )
    }
  }

  function stopVoiceContext() {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  function formatRecordingTime(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const remaining = seconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>✉️ Email</h1>
        </div>
        <p className="oggi-muted">Caricamento...</p>
      </div>
    )
  }

  const tabItems = drafts.filter((d) => d.status === 'pending')
  const tabSent = sent.filter((d) => d.status === 'sent')

  return (
    <div className="page-container" style={{ maxWidth: 1100 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>✉️ Email</h1>
          <p className="page-subtitle">
            Gestisci le bozze generate dall&apos;AI, invia o rigenera.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/impostazioni/email-ai" className="btn btn-ghost btn-sm">
            ⚙️ Configura AI
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{
            borderBottom: tab === 'pending' ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: 0,
            fontWeight: tab === 'pending' ? 600 : 400,
            color: tab === 'pending' ? 'var(--accent)' : 'var(--text2)',
            padding: '8px 16px',
          }}
          onClick={() => setTab('pending')}
        >
          📝 Da inviare ({tabItems.length})
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{
            borderBottom: tab === 'sent' ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: 0,
            fontWeight: tab === 'sent' ? 600 : 400,
            color: tab === 'sent' ? 'var(--accent)' : 'var(--text2)',
            padding: '8px 16px',
          }}
          onClick={() => setTab('sent')}
        >
          ✅ Inviate ({tabSent.length})
        </button>
      </div>

      {/* Pending tab */}
      {tab === 'pending' && (
        <>
          {tabItems.length === 0 ? (
            <div className="oggi-card" style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 48, marginBottom: 8 }}>📭</p>
              <p className="oggi-muted">
                Nessuna bozza in attesa. Le bozze vengono generate automaticamente ogni mattina
                per i contatti in scadenza, oppure puoi generarle manualmente dalla dashboard.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {tabItems.map((draft) => {
                const urgency = urgencyLabel(draft.contact?.next_followup_at)
                const badge = scoreBadge(draft.contact?.score)
                const isExpanded = expandedId === draft.id
                const isBusy = busyIds.has(draft.id)
                const isRecording = recordingDraftId === draft.id
                const isTranscribing = transcribingDraftId === draft.id

                return (
                  <div
                    key={draft.id}
                    className="oggi-card"
                    style={{ padding: 16 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          {badge && <span>{badge}</span>}
                          <strong style={{ fontSize: 15 }}>{draft.contact?.name || 'Sconosciuto'}</strong>
                          {draft.contact?.company && (
                            <span style={{ color: 'var(--text2)', fontSize: 13 }}>{draft.contact.company}</span>
                          )}
                          {urgency && (
                            <span className={`oggi-email-inbox-urgency ${urgency.className}`} style={{ fontSize: 11 }}>
                              {urgency.label}
                            </span>
                          )}
                          {draft.source === 'auto' && (
                            <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--surface2)', padding: '1px 6px', borderRadius: 4 }}>auto</span>
                          )}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                          {draft.subject || '(nessun oggetto)'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                          {draft.contact?.email} · {formatDate(draft.created_at)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                          title="Anteprima"
                        >
                          👁
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleRegenerate(draft)}
                          disabled={isBusy}
                          title="Rigenera con AI"
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDismiss(draft)}
                          disabled={isBusy}
                          title="Archivia"
                        >
                          ✕
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleSend(draft)}
                          disabled={isBusy}
                        >
                          {isBusy ? '...' : 'Invia'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                        <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>
                          Oggetto
                        </label>
                        <input
                          className="form-input"
                          value={editedSubjects[draft.id] ?? draft.subject ?? ''}
                          onChange={(event) =>
                            setEditedSubjects((prev) => ({ ...prev, [draft.id]: event.target.value }))
                          }
                          disabled={isBusy}
                          style={{ width: '100%', marginBottom: 12 }}
                        />
                        <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>
                          Testo email
                        </label>
                        <textarea
                          className="form-input"
                          value={editedBodies[draft.id] ?? draft.body_text ?? ''}
                          onChange={(event) =>
                            setEditedBodies((prev) => ({ ...prev, [draft.id]: event.target.value }))
                          }
                          disabled={isBusy}
                          rows={12}
                          style={{ width: '100%', marginBottom: 12, resize: 'vertical', lineHeight: 1.55 }}
                        />
                        <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>
                          Contesto per questa email
                        </label>
                        <p className="oggi-muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
                          Racconta dove hai conosciuto il contatto, cosa vi siete detti e quale
                          proposta vuoi fare. Il vocale viene trascritto e usato per rigenerare la
                          bozza, senza inviarla.
                        </p>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <textarea
                            className="form-input"
                            placeholder="Scrivi il contesto oppure registralo con il microfono..."
                            value={regenerateNotes[draft.id] ?? draft.note ?? ''}
                            onChange={(e) =>
                              setRegenerateNotes((prev) => ({ ...prev, [draft.id]: e.target.value }))
                            }
                            rows={3}
                            style={{ flex: '1 1 420px', fontSize: 13, resize: 'vertical' }}
                            disabled={isBusy || isRecording || isTranscribing}
                          />
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className={`btn ${isRecording ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                              onClick={() =>
                                isRecording ? stopVoiceContext() : startVoiceContext(draft)
                              }
                              disabled={
                                isBusy || isTranscribing ||
                                (recordingDraftId !== null && !isRecording)
                              }
                            >
                              {isRecording
                                ? `■ Stop ${formatRecordingTime(recordingSeconds)}`
                                : '🎙 Registra contesto'}
                            </button>
                            <label
                              className="btn btn-ghost btn-sm"
                              style={{
                                cursor: isBusy || isTranscribing ? 'not-allowed' : 'pointer',
                                opacity: isBusy || isTranscribing ? 0.55 : 1,
                              }}
                            >
                              Carica vocale
                              <input
                                type="file"
                                accept="audio/*"
                                hidden
                                disabled={isBusy || isTranscribing || recordingDraftId !== null}
                                onChange={(event) => {
                                  const file = event.target.files?.[0]
                                  event.target.value = ''
                                  if (file) void transcribeAndRegenerate(draft, file, file.name)
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleRegenerate(draft)}
                              disabled={isBusy || isRecording || isTranscribing}
                              style={{ flexShrink: 0 }}
                            >
                              {isTranscribing
                                ? 'Trascrivo e rigenero...'
                                : isBusy
                                  ? '⏳'
                                  : '🔄 Rigenera'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Sent tab */}
      {tab === 'sent' && (
        <>
          {tabSent.length === 0 ? (
            <div className="oggi-card" style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 48, marginBottom: 8 }}>📬</p>
              <p className="oggi-muted">Nessuna email inviata tramite questo sistema.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tabSent.slice(0, 50).map((draft) => {
                const isExpanded = expandedId === draft.id
                return (
                  <div
                    key={draft.id}
                    className="oggi-card"
                    style={{ padding: 12, opacity: 0.8 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>✅</span>
                          <strong style={{ fontSize: 14 }}>{draft.contact?.name || 'Sconosciuto'}</strong>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                            {formatDate(draft.sent_at)}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                          {draft.subject || '(nessun oggetto)'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      >
                        👁
                      </button>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                        <div
                          className="oggi-email-inbox-body"
                          style={{ maxHeight: 300, overflowY: 'auto', padding: 8, background: 'var(--surface2)', borderRadius: 6, fontSize: 13 }}
                          dangerouslySetInnerHTML={{
                            __html: draft.body_html || draft.body_text?.replace(/\n/g, '<br>') || '',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
