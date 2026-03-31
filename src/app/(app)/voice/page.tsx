'use client'

import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '@/lib/api'
import { formatDateTime } from '@/lib/data'
import { useCRMContext } from '../layout'

// Type for SpeechRecognition (available in browsers but not in TS lib by default)
type SpeechRecognitionAPI = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionEvent = {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionAPI
  webkitSpeechRecognition?: new () => SpeechRecognitionAPI
}

type VoiceCommandResult = {
  executed: boolean
  reply: string
  confidence?: number
  contact?: {
    id: string
    name: string
  }
  scheduled_for?: string
}

export default function VoicePage() {
  const { vNotes, addVoiceNote, deleteVoiceNote, showToast, refresh } = useCRMContext()
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showBtns, setShowBtns] = useState(false)
  const [processingCommand, setProcessingCommand] = useState(false)
  const [commandResult, setCommandResult] = useState<VoiceCommandResult | null>(null)

  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentBlobRef = useRef<Blob | null>(null)
  const recognitionRef = useRef<SpeechRecognitionAPI | null>(null)
  const currentTranscriptRef = useRef('')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = window as WindowWithSpeech
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition
      if (SR) {
        const recognition = new SR()
        recognition.lang = 'it-IT'
        recognition.continuous = true
        recognition.interimResults = true
        recognitionRef.current = recognition
      }
    }
    return () => {
      if (recIntervalRef.current) clearInterval(recIntervalRef.current)
    }
  }, [])

  function formatTime(s: number) {
    const m = String(Math.floor(s / 60)).padStart(2, '0')
    const sec = String(s % 60).padStart(2, '0')
    return `${m}:${sec}`
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      audioChunksRef.current = []
      currentTranscriptRef.current = ''

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        currentBlobRef.current = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      }

      rec.start(100)
      mediaRecRef.current = rec
      setIsRecording(true)
      setRecSeconds(0)
      setTranscript('')
      setCommandResult(null)
      setShowTranscript(false)
      setShowBtns(true)

      recIntervalRef.current = setInterval(() => {
        setRecSeconds(s => s + 1)
      }, 1000)

      if (recognitionRef.current) {
        recognitionRef.current.onresult = e => {
          let t = ''
          for (let i = e.resultIndex; i < e.results.length; i++) {
            t += e.results[i][0].transcript
          }
          currentTranscriptRef.current = t
          setCommandResult(null)
          setTranscript(t)
        }
        recognitionRef.current.start()
      }
    } catch {
      showToast('Microfono non disponibile')
    }
  }

  function stopRecording() {
    if (!isRecording) return
    mediaRecRef.current?.stop()
    mediaRecRef.current?.stream?.getTracks().forEach(t => t.stop())
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    if (recIntervalRef.current) clearInterval(recIntervalRef.current)
    setIsRecording(false)
  }

  function stopAndSave() {
    stopRecording()
    setTimeout(() => {
      setShowTranscript(true)
      setShowBtns(false)
      const note = {
        ts: new Date().toLocaleString('it'),
        dur: recSeconds,
        transcript: currentTranscriptRef.current || '',
      }
      addVoiceNote(note)
      showToast('Registrazione salvata!')
    }, 300)
  }

  function discardRecording() {
    stopRecording()
    setShowBtns(false)
    setRecSeconds(0)
  }

  async function runVoiceCommand() {
    const command = transcript.trim()
    if (!command) {
      showToast('Inserisci o registra un comando prima di eseguirlo')
      return
    }

    try {
      setProcessingCommand(true)
      const result = await apiFetch<VoiceCommandResult>('/api/voice/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: command }),
      })

      setCommandResult(result)
      if (result.executed) {
        await refresh()
        showToast('Comando eseguito nel CRM')
      } else {
        showToast(result.reply || 'Comando non eseguito')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Comando vocale non eseguito')
    } finally {
      setProcessingCommand(false)
    }
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript)
      showToast('Copiato negli appunti')
    } catch {
      showToast('Copiato!')
    }
  }

  function downloadRecording() {
    if (!currentBlobRef.current) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(currentBlobRef.current)
    a.download = 'nota-vocale-' + Date.now() + '.webm'
    a.click()
  }

  function toggleRecord() {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return (
    <div className="voice-content">
      <div className="voice-hero">
        <h2>🎤 Note Vocali</h2>
        <p>
          Registra un comando come “domani ricordami di chiamare Comune di Roma” o “richiamami Acme”.
          La pagina ora puo interpretare il testo e pianificare il follow-up direttamente nel CRM.
        </p>

        <div className={`wave ${isRecording ? '' : 'hidden'}`}>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
          <div className="wave-bar"></div>
        </div>

        <button
          className={`rec-btn ${isRecording ? 'recording' : ''}`}
          onClick={toggleRecord}
        >
          {isRecording ? '⏹' : '🎙'}
        </button>

        <div className={`rec-status ${isRecording ? 'active' : ''}`}>
          {isRecording ? '● Registrazione in corso…' : showBtns ? 'Registrazione completata' : 'Premi per registrare'}
        </div>

        <div className="rec-timer">{formatTime(recSeconds)}</div>

        {showBtns && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={stopAndSave}>⏹ Stop &amp; Salva</button>
            <button className="btn btn-ghost" onClick={discardRecording}>✕ Annulla</button>
          </div>
        )}
      </div>

      <div className="dash-card" style={{ maxWidth: 760, width: '100%' }}>
        <div className="dash-card-title">Comando CRM</div>
        <div className="fg">
          <label className="fl">Trascrizione o comando</label>
          <textarea
            className="fi"
            rows={4}
            value={transcript}
            onChange={(event) => {
              setCommandResult(null)
              setTranscript(event.target.value)
            }}
            placeholder="Es. domani ricordami di chiamare Mario Rossi o Acme"
            style={{ resize: 'vertical' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={runVoiceCommand} disabled={processingCommand}>
            {processingCommand ? 'Analisi in corso...' : 'Esegui nel CRM'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setCommandResult(null)
              setTranscript('')
            }}
            disabled={processingCommand}
          >
            Pulisci
          </button>
        </div>

        {commandResult && (
          <div className="meta-card" style={{ marginTop: 16 }}>
            <strong>{commandResult.executed ? 'Comando eseguito' : 'Verifica richiesta'}</strong>
            <span>{commandResult.reply}</span>
            {commandResult.contact && (
              <span>
                Contatto: <Link href={`/contacts/${commandResult.contact.id}`}>{commandResult.contact.name}</Link>
              </span>
            )}
            {commandResult.scheduled_for && (
              <span>Follow-up: {formatDateTime(commandResult.scheduled_for)}</span>
            )}
          </div>
        )}
      </div>

      {showTranscript && (
        <div className="voice-transcript">
          <h3>📝 Trascrizione</h3>
          <textarea
            className="transcript-text"
            value={transcript}
            onChange={e => {
              setCommandResult(null)
              setTranscript(e.target.value)
            }}
          />
          <div className="transcript-actions">
            <button className="btn btn-primary btn-sm" onClick={copyTranscript}>
              📋 Copia testo
            </button>
            <button className="btn btn-primary btn-sm" onClick={runVoiceCommand} disabled={processingCommand}>
              ⚡ Esegui nel CRM
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => showToast('Trascrizione aggiunta come nota')}>
              ➕ Aggiungi come nota
            </button>
            <button className="btn btn-ghost btn-sm" onClick={downloadRecording}>
              💾 Scarica audio
            </button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 600, width: '100%' }}>
        <div className="section-header">Registrazioni salvate</div>
        <div className="recordings-list">
          {vNotes.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>
              Nessuna registrazione salvata.
            </p>
          ) : (
            vNotes.slice(0, 20).map(v => {
              const dur = v.dur || v.duration || 0
              return (
                <div key={v._u} className="recording-item">
                  <div className="rec-play-btn">🎙</div>
                  <div className="rec-info">
                    <div className="rec-title">Nota del {v.ts || v.created_at || ''}</div>
                    <div className="rec-meta">
                      ⏱ {Math.floor(dur / 60)}:{String(dur % 60).padStart(2, '0')} min
                    </div>
                    {v.transcript && (
                      <div className="rec-transcript-preview">{v.transcript}</div>
                    )}
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => deleteVoiceNote(v._u!)}
                    style={{ flexShrink: 0 }}
                  >
                    🗑
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
