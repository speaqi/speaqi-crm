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
  daily_send_cap: number
  daily_enrollment_cap: number
  first_followup_days: number
  second_followup_days: number
  third_followup_days: number
  fourth_followup_days: number
  fifth_followup_days: number
  sequence_templates: WineProjectSequenceTemplate[]
}

type WineProjectSequenceTemplate = {
  sequence: number
  label: string
  condition: 'all' | 'unopened'
  subject: string
  body: string
}

type WineProjectStats = {
  contacts: number
  enrolled: number
  not_enrolled: number
  sent: number
  scheduled: number
  queued: number
  stopped: number
  replies: number
  opens: number
  clicks: number
  forms: number
  demos: number
  interested_replies: number
  calls: number
}

const EMPTY_SETTINGS: WineProjectSettings = {
  enabled: true,
  campaign_name: 'Wine Project — Vinitaly',
  acumbamail_list_id: '1465520',
  acumbamail_campaign_id: null,
  daily_send_cap: 100,
  daily_enrollment_cap: 30,
  first_followup_days: 1,
  second_followup_days: 4,
  third_followup_days: 9,
  fourth_followup_days: 16,
  fifth_followup_days: 28,
  sequence_templates: [],
}

type WineProjectSend = {
  sent_at: string
  sequence: number | null
  company: string | null
  email: string | null
}

const EMPTY_STATS: WineProjectStats = { contacts: 0, enrolled: 0, not_enrolled: 0, sent: 0, scheduled: 0, queued: 0, stopped: 0, replies: 0, opens: 0, clicks: 0, forms: 0, demos: 0, interested_replies: 0, calls: 0 }

export default function WineProjectSettingsPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [settings, setSettings] = useState<WineProjectSettings>(EMPTY_SETTINGS)
  const [stats, setStats] = useState<WineProjectStats>(EMPTY_STATS)
  const [recentSends, setRecentSends] = useState<WineProjectSend[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    apiFetch<{ settings: WineProjectSettings; stats: WineProjectStats; recent_sends: WineProjectSend[] }>('/api/wine-project/automation')
      .then((result) => {
        setSettings(result.settings)
        setStats(result.stats)
        setRecentSends(result.recent_sends || [])
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Caricamento non riuscito'))
      .finally(() => setLoading(false))
  }, [isAdmin])

  function setDays(field: 'first_followup_days' | 'second_followup_days' | 'third_followup_days' | 'fourth_followup_days' | 'fifth_followup_days', value: string) {
    const number = Math.max(1, Math.floor(Number(value) || 1))
    setSettings((current) => ({ ...current, [field]: number }))
  }

  function setDailySendCap(value: string) {
    const number = Math.min(5000, Math.max(1, Math.floor(Number(value) || 1)))
    setSettings((current) => ({ ...current, daily_send_cap: number }))
  }

  function setDailyEnrollmentCap(value: string) {
    const number = Math.min(5000, Math.max(1, Math.floor(Number(value) || 1)))
    setSettings((current) => ({ ...current, daily_enrollment_cap: number }))
  }

  function updateTemplate(sequence: number, field: 'subject' | 'body', value: string) {
    setSettings((current) => ({
      ...current,
      sequence_templates: current.sequence_templates.map((template) =>
        template.sequence === sequence ? { ...template, [field]: value } : template
      ),
    }))
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
          <p>Quando una cantina completa Wine Project, viene registrata con sito, vini, email e telefono. Il CRM ferma subito la sequenza e crea una chiamata prioritaria; aperture e click senza form restano invece nella sequenza.</p>
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
        <p className="wine-project-pause-note">In pausa nessun nuovo arruolamento né invio parte, nemmeno per chi è già in coda; riattivando riprende esattamente da dove si era fermata, senza perdite né duplicati.</p>
      </section>

      <section className="wine-project-stat-grid" aria-label="Stato Wine Project">
        <div><strong>{stats.contacts}</strong><span>cantine nel flusso</span></div>
        <div><strong>{stats.enrolled}</strong><span>già arruolate</span></div>
        <div><strong>{stats.not_enrolled}</strong><span>in attesa di partire</span></div>
        <div><strong>{stats.sent}</strong><span>email inviate</span></div>
        <div><strong>{stats.opens}</strong><span>aperture email</span></div>
        <div><strong>{stats.clicks}</strong><span>click landing</span></div>
        <div><strong>{stats.forms}</strong><span>form completati</span></div>
        <div><strong>{stats.demos}</strong><span>demo pronte</span></div>
        <div><strong>{stats.interested_replies}</strong><span>risposte interessate</span></div>
        <div><strong>{stats.calls}</strong><span>chiamate da fare</span></div>
        <div><strong>{stats.scheduled}</strong><span>azioni programmate</span></div>
        <div><strong>{stats.queued}</strong><span>azioni già in coda</span></div>
        <div><strong>{stats.stopped}</strong><span>azioni fermate</span></div>
      </section>

      <section className="wine-project-settings-card">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">TRACCIABILITÀ</p>
            <h2>Ultimi invii</h2>
            <p>Le ultime {recentSends.length} email realmente uscite, cantina per cantina. Vuota finché nessun invio è partito.</p>
          </div>
        </div>
        {recentSends.length === 0 ? (
          <p className="wine-project-empty-state">Nessuna email inviata finora.</p>
        ) : (
          <table className="wine-project-sends-table">
            <thead>
              <tr>
                <th>Cantina</th>
                <th>Email</th>
                <th>Sequenza</th>
                <th>Inviata il</th>
              </tr>
            </thead>
            <tbody>
              {recentSends.map((send, index) => (
                <tr key={index}>
                  <td>{send.company || '—'}</td>
                  <td>{send.email || '—'}</td>
                  <td>{send.sequence ? `Email ${send.sequence}/5` : '—'}</td>
                  <td>{new Date(send.sent_at).toLocaleString('it-IT')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="wine-project-settings-card">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">CADENZA</p>
            <h2>Quando il CRM deve riportare la cantina in coda</h2>
            <p>Ogni contatto riceve fino a cinque messaggi. Aperture e click senza form non generano chiamate e non interrompono i rilanci; una risposta, una demo completata, disiscrizione o chiusura fermano tutta la sequenza.</p>
          </div>
        </div>
        <div className="wine-project-cadence-grid">
          <label htmlFor="wine-followup-1">
            <span>Email 1</span>
            <input id="wine-followup-1" type="number" min="1" max="14" inputMode="numeric" value={settings.first_followup_days} onChange={(event) => setDays('first_followup_days', event.target.value)} />
            <small>Primo messaggio</small>
          </label>
          <label htmlFor="wine-followup-2">
            <span>Email 2</span>
            <input id="wine-followup-2" type="number" min="2" max="30" inputMode="numeric" value={settings.second_followup_days} onChange={(event) => setDays('second_followup_days', event.target.value)} />
            <small>Promemoria per completare la demo</small>
          </label>
          <label htmlFor="wine-followup-3">
            <span>Email 3</span>
            <input id="wine-followup-3" type="number" min="3" max="60" inputMode="numeric" value={settings.third_followup_days} onChange={(event) => setDays('third_followup_days', event.target.value)} />
            <small>Se non c&apos;è risposta</small>
          </label>
          <label htmlFor="wine-followup-4">
            <span>Email 4</span>
            <input id="wine-followup-4" type="number" min="4" max="75" inputMode="numeric" value={settings.fourth_followup_days} onChange={(event) => setDays('fourth_followup_days', event.target.value)} />
            <small>Se non c&apos;è risposta</small>
          </label>
          <label htmlFor="wine-followup-5">
            <span>Email 5</span>
            <input id="wine-followup-5" type="number" min="5" max="90" inputMode="numeric" value={settings.fifth_followup_days} onChange={(event) => setDays('fifth_followup_days', event.target.value)} />
            <small>Chiusura gentile</small>
          </label>
        </div>
        <p className="wine-project-sequence-summary">
          Cadenza: giorno <strong>{settings.first_followup_days}</strong>, <strong>{settings.second_followup_days}</strong>, <strong>{settings.third_followup_days}</strong>, <strong>{settings.fourth_followup_days}</strong> e <strong>{settings.fifth_followup_days}</strong> dopo l&apos;ingresso nel flusso.
        </p>
      </section>

      <section className="wine-project-settings-card">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">CONTENUTO EMAIL</p>
            <h2>I cinque messaggi della sequenza</h2>
            <p>Qui sta il testo operativo. Viene usato come brief vincolante quando il CRM prepara la bozza; per il grassetto scrivi <strong>**testo**</strong>. La firma testuale viene aggiunta dal mittente configurato.</p>
          </div>
        </div>
        <div className="wine-project-template-list">
          {settings.sequence_templates.map((template) => (
            <article className="wine-project-template-card" key={template.sequence}>
              <div className="wine-project-template-heading">
                <div>
                  <strong>Email {template.sequence}/5 — {template.label}</strong>
                  <span>Invia se non arriva una risposta né viene completata la demo</span>
                </div>
              </div>
              <label htmlFor={`wine-email-subject-${template.sequence}`}>
                <span>Oggetto</span>
                <input id={`wine-email-subject-${template.sequence}`} value={template.subject} onChange={(event) => updateTemplate(template.sequence, 'subject', event.target.value)} />
              </label>
              <label htmlFor={`wine-email-body-${template.sequence}`}>
                <span>Testo</span>
                <textarea id={`wine-email-body-${template.sequence}`} rows={9} value={template.body} onChange={(event) => updateTemplate(template.sequence, 'body', event.target.value)} />
              </label>
            </article>
          ))}
        </div>
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
          <label htmlFor="wine-daily-enrollment-cap"><span>Nuovi contatti al giorno</span><input id="wine-daily-enrollment-cap" type="number" min="1" max="5000" inputMode="numeric" value={settings.daily_enrollment_cap} onChange={(event) => setDailyEnrollmentCap(event.target.value)} onBlur={(event) => setDailyEnrollmentCap(event.target.value)} /><small>Quante cantine entrano ogni giorno in sequenza, pescate dai contatti con tag wine-project.</small></label>
          <label htmlFor="wine-daily-send-cap"><span>Invii massimi al giorno</span><input id="wine-daily-send-cap" type="number" min="1" max="5000" inputMode="numeric" value={settings.daily_send_cap} onChange={(event) => setDailySendCap(event.target.value)} onBlur={(event) => setDailySendCap(event.target.value)} /><small>Tetto sulle email totali, follow-up inclusi.</small></label>
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
