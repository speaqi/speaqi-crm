'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/app/(app)/layout'

type UserSettings = {
  speaqi_context: string | null
  email_tone: string | null
  email_signature: string | null
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text1)',
  fontSize: 14,
  lineHeight: 1.5,
  resize: 'vertical',
  fontFamily: 'inherit',
}

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text3)',
  marginBottom: 8,
  lineHeight: 1.5,
}

export default function EmailAIPage() {
  const { showToast } = useCRMContext()
  const [settings, setSettings] = useState<UserSettings>({
    speaqi_context: '',
    email_tone: '',
    email_signature: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<{ settings: UserSettings }>('/api/user-settings')
      .then(({ settings: s }) => {
        setSettings({
          speaqi_context: s.speaqi_context ?? '',
          email_tone: s.email_tone ?? '',
          email_signature: s.email_signature ?? '',
        })
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      await apiFetch('/api/user-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      showToast('Impostazioni salvate')
    } catch {
      showToast('Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page-container"><p>Caricamento...</p></div>

  return (
    <div className="page-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/impostazioni" className="btn btn-ghost btn-sm">← Impostazioni</Link>
          <h1>Email AI</h1>
        </div>
        <p className="page-subtitle">
          Configura il contesto che l'AI usa per generare bozze email personalizzate.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 640 }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="form-label" style={{ fontWeight: 600 }}>Contesto Speaqi</label>
          <p style={hintStyle}>
            Descrivi cos'è Speaqi, cosa vendete, il valore principale. L'AI usa questo in tutte le email generate.
          </p>
          <textarea
            style={{ ...fieldStyle, minHeight: 140 }}
            rows={6}
            placeholder={'Speaqi è una piattaforma CRM per agenti commerciali nel settore vino e bevande. Aiutiamo i venditori a gestire i follow-up, tracciare le trattative e chiudere più contratti...'}
            value={settings.speaqi_context ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, speaqi_context: e.target.value }))}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="form-label" style={{ fontWeight: 600 }}>Tono email</label>
          <p style={hintStyle}>
            Come scrive le email questo utente? Es: "professionale ma diretto, max 5 righe, usa il tu".
          </p>
          <textarea
            style={{ ...fieldStyle, minHeight: 80 }}
            rows={3}
            placeholder="Professionale, diretto, senza giri di parole. Max 5 righe di corpo. Usa il tu."
            value={settings.email_tone ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, email_tone: e.target.value }))}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="form-label" style={{ fontWeight: 600 }}>Firma email</label>
          <textarea
            style={{ ...fieldStyle, minHeight: 96 }}
            rows={4}
            placeholder={'Massimo Morganti\nSpeaqi CRM\n+39 333 000 0000\nmassimo@speaqi.com'}
            value={settings.email_signature ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, email_signature: e.target.value }))}
          />
        </div>

        <div>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Salvataggio...' : 'Salva impostazioni'}
          </button>
        </div>

      </div>
    </div>
  )
}
