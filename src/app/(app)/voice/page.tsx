'use client'

import { useState, useRef, useEffect } from 'react'
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

export default function VoicePage() {
  const { vNotes, addVoiceNote, deleteVoiceNote, showToast } = useCRMContext()
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [showBtns, setShowBtns] = useState(false)

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

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript)
      showToast('Copiato! Incollalo in chat con Claude 🎉')
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
          Registra una nota vocale per spiegare a Claude cosa vuoi fare, aggiungere contesti alle card,
          o semplicemente tenere un memo. La trascrizione avviene automaticamente in italiano.
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

      {showTranscript && (
        <div className="voice-transcript">
          <h3>📝 Trascrizione</h3>
          <div
            className="transcript-text"
            contentEditable
            suppressContentEditableWarning
            onInput={e => setTranscript((e.target as HTMLDivElement).textContent || '')}
          >
            {transcript || '(Nessuna trascrizione automatica disponibile – aggiungi il testo manualmente)'}
          </div>
          <div className="transcript-actions">
            <button className="btn btn-primary btn-sm" onClick={copyTranscript}>
              📋 Copia per Claude
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
