'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/app/(app)/layout'

type UserSettings = {
  speaqi_context: string | null
  email_tone: string | null
  email_signature: string | null
  email_target_audience: string | null
  email_value_proposition: string | null
  email_offer_details: string | null
  email_proof_points: string | null
  email_objection_notes: string | null
  email_call_to_action: string | null
}

type SettingsField = {
  key: keyof UserSettings
  label: string
  hint: string
  placeholder: string
  rows: number
  wide?: boolean
}

const SETTINGS_FIELDS: SettingsField[] = [
  {
    key: 'speaqi_context',
    label: 'Contesto Speaqi',
    hint: "Descrivi cos'e Speaqi, cosa vendete, il valore principale e quando ha senso proporlo.",
    placeholder: 'Speaqi e una piattaforma CRM per agenti commerciali nel settore vino e bevande...',
    rows: 8,
    wide: true,
  },
  {
    key: 'email_target_audience',
    label: 'Target ideale',
    hint: 'A chi stiamo scrivendo e quali segnali rendono il contatto interessante.',
    placeholder: 'Cantine, distributori, importatori, hospitality manager; priorita a chi gestisce molti follow-up...',
    rows: 5,
  },
  {
    key: 'email_value_proposition',
    label: 'Valore da comunicare',
    hint: 'I benefici concreti da far emergere nelle email.',
    placeholder: 'Riduce follow-up persi, centralizza storico contatti, aiuta il team a chiamare al momento giusto...',
    rows: 5,
  },
  {
    key: 'email_offer_details',
    label: 'Offerta / proposta',
    hint: 'Cosa proporre: demo, call, prova, materiale, listino, presentazione.',
    placeholder: 'Proporre una demo di 20 minuti oppure inviare una panoramica mirata se il contatto non e pronto...',
    rows: 5,
  },
  {
    key: 'email_proof_points',
    label: 'Prove e credibilita',
    hint: 'Esempi, casi d’uso, numeri o elementi di fiducia utilizzabili senza inventare.',
    placeholder: 'Usare solo prove reali: eventi seguiti, mercati coperti, workflow gia implementati, esempi autorizzati...',
    rows: 5,
  },
  {
    key: 'email_objection_notes',
    label: 'Obiezioni e limiti',
    hint: 'Dubbi frequenti, parole da evitare, promesse da non fare.',
    placeholder: 'Non promettere risultati garantiti. Se emerge il prezzo, proporre prima una call di qualifica...',
    rows: 5,
  },
  {
    key: 'email_call_to_action',
    label: 'CTA preferita',
    hint: 'La prossima azione da chiedere più spesso.',
    placeholder: 'Chiedere disponibilita per una call breve questa settimana, con due slot solo se presenti nel contesto...',
    rows: 4,
  },
  {
    key: 'email_tone',
    label: 'Tono email',
    hint: 'Come scrive questo utente: lunghezza, formalita, tu/lei, livello di pressione commerciale.',
    placeholder: 'Professionale, diretto, senza giri di parole. Max 8-10 righe. Usa il tu.',
    rows: 4,
  },
  {
    key: 'email_signature',
    label: 'Firma manuale di fallback',
    hint: 'Se Gmail e autorizzato, il CRM usa la firma gia presente in Gmail. Questo campo resta come fallback.',
    placeholder: 'Massimo Morganti\nSpeaqi CRM\n+39 333 000 0000\nmassimo@speaqi.com',
    rows: 5,
    wide: true,
  },
]

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
    email_target_audience: '',
    email_value_proposition: '',
    email_offer_details: '',
    email_proof_points: '',
    email_objection_notes: '',
    email_call_to_action: '',
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
          email_target_audience: s.email_target_audience ?? '',
          email_value_proposition: s.email_value_proposition ?? '',
          email_offer_details: s.email_offer_details ?? '',
          email_proof_points: s.email_proof_points ?? '',
          email_objection_notes: s.email_objection_notes ?? '',
          email_call_to_action: s.email_call_to_action ?? '',
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1040 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          {SETTINGS_FIELDS.map((field) => (
            <div
              key={field.key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                gridColumn: field.wide ? '1 / -1' : undefined,
              }}
            >
              <label className="form-label" style={{ fontWeight: 600 }}>{field.label}</label>
              <p style={hintStyle}>{field.hint}</p>
              <textarea
                style={{ ...fieldStyle, minHeight: Math.max(96, field.rows * 26) }}
                rows={field.rows}
                placeholder={field.placeholder}
                value={settings[field.key] ?? ''}
                onChange={(e) => setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </div>
          ))}
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
