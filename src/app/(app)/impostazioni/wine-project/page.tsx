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
  campaign_send_enabled: boolean
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
  campaign_send_enabled: false,
  first_followup_days: 1,
  second_followup_days: 4,
  third_followup_days: 9,
  fourth_followup_days: 16,
  fifth_followup_days: 28,
  sequence_templates: [],
}

type WineProjectEngagement =
  | 'all'
  | 'opened'
  | 'clicked'
  | 'landing'
  | 'form'
  | 'demo'
  | 'interested'
  | 'replied'
  | 'unsubscribed'
  | 'excluded'
  | 'silent'

type WineProjectJourneyStep = { key: string; label: string; at: string; detail?: string | null }

type WineProjectContact = {
  id: string
  name: string | null
  company: string | null
  email: string | null
  status: string | null
  email_open_count: number | null
  email_click_count: number | null
  last_email_open_at: string | null
  last_email_click_at: string | null
  last_contact_at: string | null
  email_unsubscribed_at: string | null
  email_unsubscribe_source: string | null
  first_open_at: string | null
  last_open_at: string | null
  first_click_at: string | null
  landing_at: string | null
  form_at: string | null
  demo_at: string | null
  demo_url: string | null
  interested_at: string | null
  reply_at: string | null
  sent_count: number
  last_sequence: number | null
  last_sent_at: string | null
  next_sequence: number | null
  next_due_at: string | null
  excluded_reason: string | null
  journey: WineProjectJourneyStep[]
}

const ENGAGEMENT_TABS: { id: WineProjectEngagement; label: string; hint: string }[] = [
  { id: 'opened', label: 'Ha aperto', hint: 'Cantine che hanno aperto almeno una email della sequenza: per ognuna, quando l’ha aperta la prima volta e quante volte è tornata.' },
  { id: 'clicked', label: 'Ha cliccato', hint: 'Cantine che hanno cliccato un link: la coda più calda.' },
  { id: 'landing', label: 'Arrivata sulla landing', hint: 'Ha aperto la demo personalizzata dal pulsante dell’email: sa già di cosa parliamo.' },
  { id: 'form', label: 'Ha compilato il form', hint: 'Ha lasciato sito, email e telefono sulla landing: da chiamare, non da rilanciare.' },
  { id: 'demo', label: 'Demo pronta', hint: 'Demo generata e sequenza fermata: la chiamata è il passo successivo.' },
  { id: 'interested', label: 'Risposta interessata', hint: 'Risposte classificate come interessate dall’AI.' },
  { id: 'replied', label: 'Ha risposto', hint: 'Ha scritto in casella: la sequenza è ferma su questo indirizzo.' },
  { id: 'unsubscribed', label: 'Disiscritte', hint: 'Si sono cancellate dalla lista: non ricevono più nulla, per nessuna campagna.' },
  { id: 'excluded', label: 'Escluse dalla sequenza', hint: 'Fuori dal giro con un motivo: disiscritte, trattativa chiusa o già rispondenti.' },
  { id: 'silent', label: 'Nessuna reazione', hint: 'Nessuna apertura e nessun click tracciati.' },
  { id: 'all', label: 'Tutte', hint: 'Tutte le cantine con tag wine-project.' },
]

/** Le date in tabella: giorno, mese e ora. «Ieri alle 18» decide una telefonata, «08/09» no. */
function formatMoment(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type WineProjectSend = {
  sent_at: string
  sequence: number | null
  company: string | null
  email: string | null
}

const EMPTY_STATS: WineProjectStats = { contacts: 0, enrolled: 0, not_enrolled: 0, sent: 0, scheduled: 0, queued: 0, stopped: 0, replies: 0, opens: 0, clicks: 0, forms: 0, demos: 0, interested_replies: 0, calls: 0 }


/**
 * I riquadri sono la porta d'ingresso alla lista: un numero che non si può
 * aprire non è lavorabile — «12 form compilati» serve solo se dice anche quali.
 * I riquadri senza `engagement` restano numeri di stato del motore.
 */
const STAT_TILES: { key: keyof WineProjectStats; label: string; engagement?: WineProjectEngagement }[] = [
  { key: 'contacts', label: 'cantine nel flusso', engagement: 'all' },
  { key: 'enrolled', label: 'già arruolate' },
  { key: 'not_enrolled', label: 'in attesa di partire' },
  { key: 'sent', label: 'email inviate' },
  { key: 'opens', label: 'aperture email', engagement: 'opened' },
  { key: 'clicks', label: 'click landing', engagement: 'clicked' },
  { key: 'forms', label: 'form completati', engagement: 'form' },
  { key: 'demos', label: 'demo pronte', engagement: 'demo' },
  { key: 'interested_replies', label: 'risposte interessate', engagement: 'interested' },
  { key: 'replies', label: 'risposte ricevute', engagement: 'replied' },
  { key: 'calls', label: 'chiamate da fare' },
  { key: 'scheduled', label: 'azioni programmate' },
  { key: 'queued', label: 'azioni già in coda' },
  { key: 'stopped', label: 'azioni fermate' },
]

export default function WineProjectSettingsPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [settings, setSettings] = useState<WineProjectSettings>(EMPTY_SETTINGS)
  const [stats, setStats] = useState<WineProjectStats>(EMPTY_STATS)
  const [recentSends, setRecentSends] = useState<WineProjectSend[]>([])
  const [engagement, setEngagement] = useState<WineProjectEngagement>('opened')
  const [engagementContacts, setEngagementContacts] = useState<WineProjectContact[]>([])
  const [engagementTotal, setEngagementTotal] = useState(0)
  const [engagementLoading, setEngagementLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingTemplate, setSavingTemplate] = useState<number | null>(null)
  const [savedTemplate, setSavedTemplate] = useState<number | null>(null)
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

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setEngagementLoading(true)
    apiFetch<{ contacts: WineProjectContact[]; total: number }>(`/api/wine-project/contacts?engagement=${engagement}`)
      .then((result) => {
        if (cancelled) return
        setEngagementContacts(result.contacts || [])
        setEngagementTotal(result.total || 0)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Caricamento cantine non riuscito')
      })
      .finally(() => {
        if (!cancelled) setEngagementLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, engagement])

  /** Dal numero alla lista: filtra e porta l'occhio dove è comparso l'elenco. */
  function openEngagement(next: WineProjectEngagement) {
    setEngagement(next)
    if (typeof document !== 'undefined') {
      document.getElementById('wine-project-engagement')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

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
    setSavedTemplate((current) => (current === sequence ? null : current))
    setSettings((current) => ({
      ...current,
      sequence_templates: current.sequence_templates.map((template) =>
        template.sequence === sequence ? { ...template, [field]: value } : template
      ),
    }))
  }

  // Salva solo la card su cui si sta lavorando: il salvataggio completo in
  // fondo alla pagina resta, ma non e' piu' l'unico modo per fissare un testo.
  async function saveTemplate(sequence: number) {
    const template = settings.sequence_templates.find((item) => item.sequence === sequence)
    if (!template) return
    setSavingTemplate(sequence)
    setSavedTemplate(null)
    setError('')
    try {
      const result = await apiFetch<{ template: WineProjectSequenceTemplate }>('/api/wine-project/automation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence, subject: template.subject, body: template.body }),
      })
      if (result.template) {
        setSettings((current) => ({
          ...current,
          sequence_templates: current.sequence_templates.map((item) =>
            item.sequence === sequence ? result.template : item
          ),
        }))
      }
      setSavedTemplate(sequence)
      showToast(`Email ${sequence}/5 salvata`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Salvataggio non riuscito')
    } finally {
      setSavingTemplate(null)
    }
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
        <div className="wine-project-intro-copy">
          <p className="wine-project-eyebrow">SEQUENZA CONTROLLATA</p>
          <h2>Ogni demo entra nel CRM, senza fogli o passaggi manuali.</h2>
          <p>Quando una cantina completa Wine Project, viene registrata con sito, vini, email e telefono. Il CRM ferma subito la sequenza e crea una chiamata prioritaria; aperture e click senza form restano invece nella sequenza.</p>
        </div>
        <div className="wine-project-intro-controls">
          <div className="wine-project-control-row">
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
          </div>
          <div className="wine-project-control-row">
            <label className="wine-project-toggle wine-project-toggle-danger" htmlFor="wine-project-campaign-send-enabled">
              <input
                id="wine-project-campaign-send-enabled"
                type="checkbox"
                checked={settings.campaign_send_enabled}
                onChange={(event) => setSettings((current) => ({ ...current, campaign_send_enabled: event.target.checked }))}
              />
              <span aria-hidden="true" />
              <strong>{settings.campaign_send_enabled ? 'Invio email reali ATTIVO' : 'Invio email reali disattivato'}</strong>
            </label>
            <p className="wine-project-pause-note wine-project-danger-note">Interruttore separato dalla pausa qui sopra: governa solo se il passo di invio può davvero spedire via Acumbamail. Da qui, non serve più Railway.</p>
          </div>
        </div>
      </section>

      <section className="wine-project-stat-grid" aria-label="Stato Wine Project">
        {STAT_TILES.map((tile) => {
          const value = stats[tile.key]
          if (!tile.engagement) {
            return (
              <div key={tile.key}>
                <strong>{value}</strong>
                <span>{tile.label}</span>
              </div>
            )
          }
          return (
            <button
              key={tile.key}
              type="button"
              className={`wine-project-stat-tile${engagement === tile.engagement ? ' is-active' : ''}`}
              onClick={() => openEngagement(tile.engagement as WineProjectEngagement)}
              aria-label={`${value} ${tile.label}: mostra le cantine`}
            >
              <strong>{value}</strong>
              <span>{tile.label}</span>
              <em>vedi chi →</em>
            </button>
          )
        })}
      </section>

      <section className="wine-project-settings-card" id="wine-project-engagement">
        <div className="wine-project-card-heading">
          <div>
            <p className="wine-project-eyebrow">CHI HA REAGITO</p>
            <h2>Le cantine dietro i numeri</h2>
            <p>{ENGAGEMENT_TABS.find((tab) => tab.id === engagement)?.hint}</p>
          </div>
        </div>
        <div className="wine-project-engagement-tabs" role="group" aria-label="Filtro reazione email">
          {ENGAGEMENT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`wine-project-engagement-tab${engagement === tab.id ? ' is-active' : ''}`}
              onClick={() => setEngagement(tab.id)}
              aria-pressed={engagement === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {engagementLoading ? (
          <p className="wine-project-empty-state">Caricamento cantine…</p>
        ) : engagementContacts.length === 0 ? (
          <p className="wine-project-empty-state">Nessuna cantina in questo gruppo.</p>
        ) : (
          <>
            <p className="wine-project-engagement-count">
              <strong>{engagementTotal}</strong> cantine{engagementContacts.length < engagementTotal ? ` · ne vedi le prime ${engagementContacts.length}` : ''}
            </p>
            <table className="wine-project-sends-table wine-project-journey-table">
              <thead>
                <tr>
                  <th>Cantina</th>
                  <th>Ultima email inviata</th>
                  <th>Che cosa ha fatto, e quando</th>
                  <th>Prossimo passo</th>
                </tr>
              </thead>
              <tbody>
                {engagementContacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <Link href={`/contacts/${contact.id}`}>{contact.company || contact.name || '—'}</Link>
                      <span className="wine-project-journey-sub">{contact.email || 'senza email'}</span>
                      <span className="wine-project-journey-sub">
                        {contact.email_open_count || 0} aperture · {contact.email_click_count || 0} click
                      </span>
                    </td>
                    <td>
                      {contact.last_sent_at ? (
                        <>
                          <strong>Email {contact.last_sequence}/5</strong>
                          <span className="wine-project-journey-sub">{formatMoment(contact.last_sent_at)}</span>
                          <span className="wine-project-journey-sub">{contact.sent_count} email uscite in tutto</span>
                        </>
                      ) : (
                        <span className="wine-project-journey-sub">Nessun invio registrato</span>
                      )}
                    </td>
                    <td>
                      {contact.journey.length === 0 ? (
                        <span className="wine-project-journey-sub">Nessuna reazione tracciata.</span>
                      ) : (
                        <ol className="wine-project-journey">
                          {contact.journey.map((step) => (
                            <li key={step.key}>
                              <time>{formatMoment(step.at)}</time>
                              <span>{step.label}</span>
                              {step.detail ? (
                                step.detail.startsWith('http') ? (
                                  <a href={step.detail} target="_blank" rel="noreferrer">apri la demo ↗</a>
                                ) : (
                                  <em>{step.detail}</em>
                                )
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                    <td>
                      {contact.excluded_reason ? (
                        <span className="wine-project-journey-stop">{contact.excluded_reason}</span>
                      ) : contact.form_at || contact.demo_at ? (
                        <span className="wine-project-journey-hot">Da chiamare</span>
                      ) : contact.next_due_at ? (
                        <>
                          <strong>Email {contact.next_sequence}/5</strong>
                          <span className="wine-project-journey-sub">{formatMoment(contact.next_due_at)}</span>
                        </>
                      ) : (
                        <span className="wine-project-journey-sub">Sequenza conclusa</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
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
            <p>Qui sta il testo operativo. Viene usato come brief vincolante quando il CRM prepara la bozza; per il grassetto scrivi <strong>**testo**</strong>. Ogni email si salva da sola con il pulsante in fondo alla sua card; la firma testuale viene aggiunta dal mittente configurato.</p>
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
              <div className="wine-project-template-actions">
                {savedTemplate === template.sequence && <span className="wine-project-template-saved">Salvata ✓</span>}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => saveTemplate(template.sequence)}
                  disabled={savingTemplate === template.sequence}
                >
                  {savingTemplate === template.sequence ? 'Salvataggio…' : `Salva email ${template.sequence}`}
                </button>
              </div>
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
