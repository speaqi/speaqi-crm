'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type Campaign = {
  id: string
  status: 'paused' | 'active' | 'completed'
  approval_status: 'analysis' | 'pending_legal' | 'approved' | 'rejected'
  approval_note?: string | null
  approved_at?: string | null
  daily_cap: number
  sender_email: string
  acumbamail_list_id?: string | null
}

type Dashboard = {
  campaign: Campaign
  steps: Array<{ id: string; step_number: number; day_offset: number; subject_template: string; only_without_engagement: boolean }>
  batches: Array<{ id: string; source_file: string; status: string; total_rows: number; eligible_rows: number; review_rows: number; excluded_rows: number; duplicate_rows: number; report?: Record<string, any>; created_at: string; completed_at?: string | null }>
  metrics: Record<string, number> & { stop_reasons: Record<string, number> }
  readiness: {
    technically_eligible: number
    legally_attested: number
    source_dated: number
    acumbamail_api: boolean
    acumbamail_webhook: boolean
    n8n_reachable: boolean
    send_enabled: boolean
    callback_url: string | null
  }
}

function Metric({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'good' | 'warn' }) {
  return (
    <div className={`hospitality-metric hospitality-metric-${tone}`}>
      <strong>{Number(value).toLocaleString('it-IT')}</strong>
      <span>{label}</span>
    </div>
  )
}

function CheckItem({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <li className={done ? 'is-done' : 'is-pending'}>
      <span className="hospitality-check-mark" aria-hidden="true">{done ? '✓' : '·'}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </li>
  )
}

export default function HospitalityCampaignPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<Dashboard>('/api/commercial/hospitality'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dati Hospitality non disponibili')
    }
  }, [])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  async function updateCampaign(updates: Record<string, unknown>) {
    setSaving(true)
    try {
      await apiFetch('/api/commercial/hospitality', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await load()
      showToast('Campagna Hospitality aggiornata')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Aggiornamento non riuscito')
    } finally {
      setSaving(false)
    }
  }

  const checks = useMemo(() => {
    if (!data) return []
    const ready = data.readiness
    return [
      { done: data.campaign.approval_status === 'approved', title: 'Decisione registrata', detail: 'Autorizzazione del titolare salvata nel CRM.' },
      { done: ready.technically_eligible > 0 && ready.legally_attested === ready.technically_eligible && ready.source_dated === ready.technically_eligible, title: 'Dati attestati', detail: `${ready.legally_attested.toLocaleString('it-IT')} di ${ready.technically_eligible.toLocaleString('it-IT')} contatti tecnicamente idonei.` },
      { done: ready.acumbamail_api && Boolean(data.campaign.acumbamail_list_id), title: 'Acumbamail collegato', detail: data.campaign.acumbamail_list_id ? `Lista di riferimento ${data.campaign.acumbamail_list_id}.` : 'Token valido; manca la lista di riferimento.' },
      { done: ready.acumbamail_webhook, title: 'Callback eventi disponibile', detail: 'Aperture, click, bounce, reclami e disiscrizioni possono rientrare nel CRM.' },
      { done: ready.n8n_reachable, title: 'n8n raggiungibile', detail: 'Scheduler online; il workflow resta in shadow mode durante i test.' },
      { done: !ready.send_enabled, title: 'Kill switch sotto controllo', detail: ready.send_enabled ? 'Invii abilitati: monitorare il cap.' : 'Invii reali disabilitati fino al pilot.' },
    ]
  }, [data])

  if (!isAdmin) return <main className="hospitality-page"><div className="card">La campagna Hospitality è visibile solo agli amministratori.</div></main>
  if (!data) return <main className="hospitality-page"><div className="card">{error || 'Caricamento Hospitality…'}</div></main>

  const batch = data.batches[0]
  const report = batch?.report || {}
  const eligibility = report.marketing_eligibility || {}
  const decisions = report.filter_decisions || {}
  const approved = data.campaign.approval_status === 'approved'
  const active = data.campaign.status === 'active'
  const completedChecks = checks.filter((item) => item.done).length
  const readiness = Math.round(completedChecks * 100 / Math.max(1, checks.length))
  const callbackUrl = data.readiness.callback_url

  async function copyCallback() {
    if (!callbackUrl) return
    await navigator.clipboard.writeText(callbackUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="hospitality-page">
      <header className="hospitality-hero">
        <div>
          <span className="hospitality-kicker">SPEAQI · COMMERCIAL CONTROL</span>
          <h1>Hospitality Italia</h1>
          <p>Import, autorizzazione, sequenza e risultati in un unico percorso verificabile.</p>
        </div>
        <div className="hospitality-hero-status">
          <span className={`status-badge ${active ? 'success' : 'warning'}`}>{active ? 'Campagna attiva' : 'Campagna in pausa'}</span>
          <strong>{readiness}% pronto</strong>
          <div className="hospitality-progress" aria-label={`Preparazione ${readiness}%`}><span style={{ width: `${readiness}%` }} /></div>
        </div>
      </header>

      {error ? <div className="hospitality-alert hospitality-alert-error">{error}</div> : null}

      <section className="hospitality-command-grid">
        <article className="hospitality-panel hospitality-approval-panel">
          <div className="hospitality-section-heading">
            <div><span className="hospitality-eyebrow">Gate operativo</span><h2>Approvazione e pilot</h2></div>
            <span className={`hospitality-state ${approved ? 'is-ready' : 'is-waiting'}`}>{approved ? 'Approvata' : 'Da registrare'}</span>
          </div>
          <p className="hospitality-muted">L’approvazione abilita la preparazione del campione. Gli invii reali restano separati e protetti dal kill switch.</p>
          <div className="hospitality-fields">
            <label className="fl"><span>Cap giornaliero</span><input className="fi" type="number" min={1} max={10000} value={data.campaign.daily_cap} disabled={saving} onChange={(event) => setData({ ...data, campaign: { ...data.campaign, daily_cap: Number(event.target.value) } })} onBlur={() => void updateCampaign({ daily_cap: data.campaign.daily_cap })} /></label>
            <label className="fl"><span>Mittente</span><input className="fi" value={data.campaign.sender_email} disabled={saving} onChange={(event) => setData({ ...data, campaign: { ...data.campaign, sender_email: event.target.value } })} onBlur={() => void updateCampaign({ sender_email: data.campaign.sender_email })} /></label>
          </div>
          <div className="hospitality-actions">
            {!approved ? <button className="btn primary" disabled={saving} onClick={() => void updateCampaign({ approval_status: 'approved', approval_note: 'Autorizzazione commerciale B2B dichiarata dal titolare', status: 'paused' })}>Registra decisione</button> : null}
            <button className={`btn ${active ? 'danger' : 'primary'}`} disabled={saving || !approved || !data.readiness.send_enabled} onClick={() => void updateCampaign({ status: active ? 'paused' : 'active', pilot_started_at: active ? undefined : new Date().toISOString() })}>{active ? 'Metti in pausa' : 'Avvia pilot'}</button>
          </div>
          {!data.readiness.send_enabled ? <div className="hospitality-safety-note"><span>●</span> Kill switch attivo: nessuna email può partire.</div> : null}
        </article>

        <article className="hospitality-panel hospitality-checklist-panel">
          <div className="hospitality-section-heading"><div><span className="hospitality-eyebrow">Checklist</span><h2>Passi di attivazione</h2></div><span className="hospitality-count">{completedChecks}/{checks.length}</span></div>
          <ol className="hospitality-checklist">{checks.map((item) => <CheckItem key={item.title} {...item} />)}</ol>
        </article>
      </section>

      <section className="hospitality-metrics" aria-label="Metriche Hospitality">
        <Metric label="Record importati" value={batch?.total_rows || report.total_rows || 0} />
        <Metric label="Idonei tecnicamente" value={batch?.eligible_rows || eligibility.eligible || 0} tone="good" />
        <Metric label="Autorizzati" value={data.readiness.legally_attested} tone={data.readiness.legally_attested ? 'good' : 'warn'} />
        <Metric label="Da revisionare" value={batch?.review_rows || eligibility.review || decisions.review || 0} tone="warn" />
        <Metric label="Esclusi" value={batch?.excluded_rows || eligibility.excluded || decisions.exclude || 0} />
        <Metric label="Email inviate" value={data.metrics.sent || 0} />
        <Metric label="Aperture" value={data.metrics.opened || 0} />
        <Metric label="Click" value={data.metrics.clicked || 0} />
        <Metric label="Risposte" value={data.metrics.replied || 0} />
        <Metric label="Hard bounce" value={data.metrics.hard_bounces || 0} />
        <Metric label="Disiscrizioni" value={data.metrics.unsubscribes || 0} />
        <Metric label="Reclami" value={data.metrics.complaints || 0} />
      </section>

      <section className="hospitality-bottom-grid">
        <article className="hospitality-panel">
          <div className="hospitality-section-heading"><div><span className="hospitality-eyebrow">Cadence</span><h2>Sequenza commerciale</h2></div><span className="hospitality-count">5 email</span></div>
          <div className="hospitality-sequence">
            {data.steps.map((step) => <div key={step.id} className="hospitality-step"><span>{step.step_number}</span><div><strong>Giorno {step.day_offset}</strong><p>{step.subject_template}</p>{step.only_without_engagement ? <small>Solo senza aperture o click</small> : null}</div></div>)}
          </div>
        </article>

        <div className="hospitality-side-stack">
          <article className="hospitality-panel">
            <div className="hospitality-section-heading"><div><span className="hospitality-eyebrow">Integrazione</span><h2>Webhook Acumbamail</h2></div></div>
            <p className="hospitality-muted">Lista di riferimento: <strong>{data.campaign.acumbamail_list_id || 'non impostata'}</strong></p>
            {data.readiness.callback_url ? <><div className="hospitality-callback">{data.readiness.callback_url.replace(/([?&]t=)[^&]+/, '$1••••••••')}</div><button className="btn secondary" onClick={() => void copyCallback()}>{copied ? 'Copiata' : 'Copia URL completa'}</button></> : <div className="hospitality-alert">Callback non disponibile.</div>}
          </article>
          <article className="hospitality-panel">
            <div className="hospitality-section-heading"><div><span className="hospitality-eyebrow">Provenienza</span><h2>Ultimo import</h2></div></div>
            {batch ? <><strong className="hospitality-file">{batch.source_file}</strong><p className="hospitality-muted">{batch.status} · checksum {String(report.checksum_sha256 || '').slice(0, 16)}…</p><p className="hospitality-muted">{new Date(batch.completed_at || batch.created_at).toLocaleString('it-IT')}</p></> : <p className="hospitality-muted">Nessun batch persistito.</p>}
          </article>
        </div>
      </section>
    </main>
  )
}
