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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 680 }}>
        <div className="form-group">
          <label className="form-label">Contesto Speaqi</label>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>
            Descrivi cos'è Speaqi, cosa vendete, il valore principale. L'AI usa questo per tutte le email.
          </p>
          <textarea
            className="form-input"
            rows={6}
            placeholder="Speaqi è una piattaforma CRM per agenti commerciali nel settore vino e bevande. Aiutiamo i venditori a gestire i follow-up, tracciare le trattative e chiudere più contratti..."
            value={settings.speaqi_context ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, speaqi_context: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Tono email (questo utente)</label>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>
            Come vuoi che l'AI scriva le tue email? Es: "professionale ma diretto", "cordiale e informale", "conciso, max 5 righe".
          </p>
          <textarea
            className="form-input"
            rows={3}
            placeholder="Professionale, diretto, senza giri di parole. Max 5 righe di corpo. Usa il tu."
            value={settings.email_tone ?? ''}
            onChange={(e) => setSettings((prev) => ({ ...prev, email_tone: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Firma email (questo utente)</label>
          <textarea
            className="form-input"
            rows={4}
            placeholder="Massimo Morganti&#10;Speaqi CRM&#10;+39 333 000 0000&#10;massimo@speaqi.com"
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
