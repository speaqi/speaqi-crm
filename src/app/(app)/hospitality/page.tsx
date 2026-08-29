'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type Dashboard = {
  campaign: { id: string; status: string; approval_status: string; approval_note?: string | null; daily_cap: number; sender_email: string; reply_to?: string | null; cadence_days: number[] }
  steps: Array<{ id: string; step_number: number; day_offset: number; subject_template: string; only_without_engagement: boolean }>
  batches: Array<{ id: string; source_file: string; status: string; dry_run: boolean; total_rows: number; eligible_rows: number; review_rows: number; excluded_rows: number; duplicate_rows: number; report?: Record<string, any>; created_at: string }>
  metrics: Record<string, number> & { stop_reasons: Record<string, number> }
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--surface)' }}><strong style={{ display: 'block', fontSize: 26 }}>{value}</strong><span style={{ color: 'var(--text2)', fontSize: 12 }}>{label}</span></div>
}

export default function HospitalityCampaignPage() {
  const { isAdmin, showToast } = useCRMContext()
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setData(await apiFetch<Dashboard>('/api/commercial/hospitality')); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Dati Hospitality non disponibili') }
  }, [])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  async function updateCampaign(updates: Record<string, unknown>) {
    setSaving(true)
    try {
      await apiFetch('/api/commercial/hospitality', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
      await load(); showToast('Campagna Hospitality aggiornata')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Aggiornamento non riuscito') }
    finally { setSaving(false) }
  }

  if (!isAdmin) return <main className="page"><div className="card">La campagna Hospitality è visibile solo agli amministratori.</div></main>
  if (!data) return <main className="page"><div className="card">{error || 'Caricamento Hospitality…'}</div></main>
  const batch = data.batches[0]
  const report = batch?.report || {}
  const eligibility = report.marketing_eligibility || {}
  const decisions = report.filter_decisions || {}
  const approved = data.campaign.approval_status === 'approved'
  const active = data.campaign.status === 'active'

  return (
    <main className="page">
      <div className="page-header">
        <div><h1>Hospitality</h1><p>Import, sequenza commerciale e risultati separati dal motore Wine.</p></div>
        <span className={`status-badge ${active ? 'success' : 'warning'}`}>{active ? 'Attiva' : 'In pausa'}</span>
      </div>
      {error ? <div className="card" style={{ color: 'var(--red)', marginBottom: 16 }}>{error}</div> : null}
      <section className="card" style={{ marginBottom: 18 }}>
        <h2>Sicurezza e approvazione</h2>
        <p style={{ color: 'var(--text2)' }}>Gli invii restano bloccati finché la base legale non è approvata. Il workflow n8n può girare senza oltrepassare questo gate.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, marginTop: 16 }}>
          <label className="fl"><span>Stato approvazione</span><select className="fi" value={data.campaign.approval_status} disabled={saving} onChange={(event) => void updateCampaign({ approval_status: event.target.value, status: event.target.value === 'approved' ? data.campaign.status : 'paused' })}><option value="analysis">Analisi</option><option value="pending_legal">In verifica legale</option><option value="approved">Approvata</option><option value="rejected">Respinta</option></select></label>
          <label className="fl"><span>Cap giornaliero</span><input className="fi" type="number" min={1} max={10000} value={data.campaign.daily_cap} disabled={saving} onChange={(event) => setData({ ...data, campaign: { ...data.campaign, daily_cap: Number(event.target.value) } })} onBlur={() => void updateCampaign({ daily_cap: data.campaign.daily_cap })} /></label>
          <label className="fl"><span>Mittente</span><input className="fi" value={data.campaign.sender_email} disabled={saving} onChange={(event) => setData({ ...data, campaign: { ...data.campaign, sender_email: event.target.value } })} onBlur={() => void updateCampaign({ sender_email: data.campaign.sender_email })} /></label>
        </div>
        <button className="btn primary" style={{ marginTop: 16 }} disabled={saving || !approved} onClick={() => void updateCampaign({ status: active ? 'paused' : 'active', pilot_started_at: active ? undefined : new Date().toISOString() })}>{active ? 'Metti in pausa' : 'Attiva campagna approvata'}</button>
        {!approved ? <p style={{ color: 'var(--red)', fontSize: 12 }}>Attivazione non disponibile: manca l’approvazione legale.</p> : null}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 18 }}>
        <Metric label="Record file" value={batch?.total_rows || report.total_rows || 0} />
        <Metric label="Eleggibili" value={batch?.eligible_rows || eligibility.eligible || 0} />
        <Metric label="Da revisionare" value={batch?.review_rows || eligibility.review || decisions.review || 0} />
        <Metric label="Esclusi" value={batch?.excluded_rows || eligibility.excluded || decisions.exclude || 0} />
        <Metric label="Duplicati" value={batch?.duplicate_rows || report.duplicate_structure_rows || 0} />
        <Metric label="Email inviate" value={data.metrics.sent || 0} />
        <Metric label="Aperture" value={data.metrics.opened || 0} />
        <Metric label="Click" value={data.metrics.clicked || 0} />
        <Metric label="Risposte" value={data.metrics.replied || 0} />
        <Metric label="Hard bounce" value={data.metrics.hard_bounces || 0} />
        <Metric label="Disiscrizioni" value={data.metrics.unsubscribes || 0} />
        <Metric label="Reclami" value={data.metrics.complaints || 0} />
      </section>

      <section className="card" style={{ marginBottom: 18 }}>
        <h2>Sequenza</h2>
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          {data.steps.map((step) => <div key={step.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}><strong>Email {step.step_number} · giorno {step.day_offset}</strong><div style={{ color: 'var(--text2)', marginTop: 4 }}>{step.subject_template}</div>{step.only_without_engagement ? <small>Solo senza aperture o click</small> : null}</div>)}
        </div>
      </section>

      <section className="card">
        <h2>Ultimo import</h2>
        {batch ? <p style={{ color: 'var(--text2)' }}>{batch.source_file} · {batch.status} · checksum {String(report.checksum_sha256 || '').slice(0, 16)}… · {new Date(batch.created_at).toLocaleString('it-IT')}</p> : <p style={{ color: 'var(--text2)' }}>Nessun batch persistito. Esegui prima il dry-run da CLI e applica solo dopo la revisione.</p>}
      </section>
    </main>
  )
}
