'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '@/app/(app)/layout'

type WineProjectSettings = {
  enabled: boolean
  campaign_name: string
  acumbamail_list_id: string | null
  acumbamail_campaign_id: string | null
  first_followup_days: number
  second_followup_days: number
  third_followup_days: number
}

type WineProjectStats = {
  contacts: number
  scheduled: number
  queued: number
  stopped: number
  replies: number
}

const EMPTY_SETTINGS: WineProjectSettings = {
  enabled: true,
  campaign_name: 'Wine Project — Vinitaly',
  acumbamail_list_id: '1465520',
  acumbamail_campaign_id: null,
  first_followup_days: 1,
  second_followup_days: 5,
  third_followup_days: 12,
}

const EMPTY_STATS: WineProjectStats = { contacts: 0, scheduled: 0, queued: 0, stopped: 0, replies: 0 }

function daysLabel(days: number) {
  return days === 1 ? '1 giorno' : `${days} giorni`
}

export default function WineProjectSettingsPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [settings, setSettings] = useState<WineProjectSettings>(EMPTY_SETTINGS)
  const [stats, setStats] = useState<WineProjectStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    apiFetch<{ settings: WineProjectSettings; stats: WineProjectStats }>('/api/wine-project/automation')
      .then((result) => {
        setSettings(result.settings)
        setStats(result.stats)
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Caricamento non riuscito'))
      .finally(() => setLoading(false))
  }, [isAdmin])

  function setDays(field: 'first_followup_days' | 'second_followup_days' | 'third_followup_days', value: string) {
    const number = Math.max(1, Math.floor(Number(value) || 1))
    setSettings((current) => ({ ...current, [field]: number }))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const result = await apiFetch<{ settings: WineProjectSettings }>('/api/wine-project/automation', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSettings(result.settings)
      showToast('Automazione Wine Project salvata')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) return <div className="inline-error">L&apos;automazione Wine Project è riservata agli amministratori.</div>
  if (loading) return <div className="page-container"><p>Caricamento automazione Wine Project…</p></div>

  return (
    <div className="page-container wine-project-settings-page">
      <div className="page-header">
        <div className="wine-project-settings-title">
          <Link href="/impostazioni" className="btn btn-ghost btn-sm">← Impostazioni</Link>
          <div>
            <h1>Wine Project</h1>
            <p className="page-subtitle">La regia CRM della campagna: contatti, risposte e promemoria nella stessa coda.</p>
          </div>
        </div>
      </div>

      <section className="wine-project-settings-card wine-project-settings-intro">
        <div>
          <p className="wine-project-eyebrow">SEQUENZA CONTROLLATA</p>
          <h2>Ogni demo entra nel CRM, senza fogli o passaggi manuali.</h2>
          <p>Quando una cantina completa Wine Project, viene registrata con sito, vini, email e telefono. Il CRM prepara le azioni successive e ferma la sequenza se riceve una risposta, una disiscrizione o una chiusura della trattativa.</p>
        </div>
        <label className="wine-project-toggle" htmlFor="wine-project-enabled">
          <input
            id="wine-project-enabled"
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span aria-hidden="true" />
          <strong>{settings.enabled ? 'Sequenza attiva' : 'Sequenza in pausa'}</strong>
        </label>
      </section>

      <section className="wine-project-stat-grid" aria-label="Stato Wine Project">
        <div><strong>{stats.contacts}</strong><span>demo nel CRM</span></div>
        <div><strong>{stats.scheduled}</strong><span>azioni programmate</span></div>
        <div><strong>{stats.queued}</strong><span>azioni già in coda</span></div>
        <div><strong>{stats.replies}</strong><span>risposte Gmail rilevate</span></div>
        <div><strong>{stats.stopped}</strong><span>azioni fermate</span></div>
      </section>

      <section className="wine-project-settings-card">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">CADENZA</p>
            <h2>Quando il CRM deve riportare la cantina in coda</h2>
            <p>Le azioni compaiono nel CRM alla data indicata. La bozza può essere preparata dall&apos;automazione; l&apos;invio promozionale resta una campagna Acumbamail, non SMTP.</p>
          </div>
        </div>
        <div className="wine-project-cadence-grid">
          <label htmlFor="wine-followup-1">
            <span>Primo contatto</span>
            <input id="wine-followup-1" type="number" min="1" max="14" inputMode="numeric" value={settings.first_followup_days} onChange={(event) => setDays('first_followup_days', event.target.value)} />
            <small>Dopo la richiesta della demo</small>
          </label>
          <label htmlFor="wine-followup-2">
            <span>Secondo messaggio</span>
            <input id="wine-followup-2" type="number" min="2" max="30" inputMode="numeric" value={settings.second_followup_days} onChange={(event) => setDays('second_followup_days', event.target.value)} />
            <small>Se non c&apos;è risposta</small>
          </label>
          <label htmlFor="wine-followup-3">
            <span>Ultimo messaggio</span>
            <input id="wine-followup-3" type="number" min="3" max="60" inputMode="numeric" value={settings.third_followup_days} onChange={(event) => setDays('third_followup_days', event.target.value)} />
            <small>Se non c&apos;è risposta</small>
          </label>
        </div>
        <p className="wine-project-sequence-summary">
          In pratica: primo contatto dopo <strong>{daysLabel(settings.first_followup_days)}</strong>, secondo messaggio dopo <strong>{daysLabel(settings.second_followup_days)}</strong>, ultimo messaggio dopo <strong>{daysLabel(settings.third_followup_days)}</strong>.
        </p>
      </section>

      <section className="wine-project-settings-card">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">ACUMBAMAIL</p>
            <h2>Collega questa sequenza alla campagna reale</h2>
            <p>Il CRM usa questi riferimenti per distinguere la campagna Wine Project dalle altre e riconciliare aperture, click, disiscrizioni e bounce.</p>
          </div>
          <Link href="/acumbamail" className="btn btn-ghost btn-sm">Apri Acumbamail →</Link>
        </div>
        <div className="wine-project-fields-grid">
          <label htmlFor="wine-campaign-name"><span>Nome campagna nel CRM</span><input id="wine-campaign-name" value={settings.campaign_name} onChange={(event) => setSettings((current) => ({ ...current, campaign_name: event.target.value }))} /></label>
          <label htmlFor="wine-list-id"><span>ID lista Acumbamail</span><input id="wine-list-id" inputMode="numeric" value={settings.acumbamail_list_id || ''} onChange={(event) => setSettings((current) => ({ ...current, acumbamail_list_id: event.target.value.replace(/\D/g, '') || null }))} placeholder="1465520" /></label>
          <label htmlFor="wine-campaign-id"><span>ID campagna Acumbamail</span><input id="wine-campaign-id" inputMode="numeric" value={settings.acumbamail_campaign_id || ''} onChange={(event) => setSettings((current) => ({ ...current, acumbamail_campaign_id: event.target.value.replace(/\D/g, '') || null }))} placeholder="Lo inserisci dopo l'invio" /></label>
        </div>
      </section>

      {error && <div className="inline-error">{error}</div>}
      <div className="wine-project-save-bar">
        <p>Le modifiche valgono per le nuove demo Wine Project; i contatti già in coda mantengono la data già pianificata.</p>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Salvataggio…' : 'Salva automazione'}
        </button>
      </div>
    </div>
  )
}
