'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../../layout'

type Campaign = {
  id: string
  vertical: string
  name: string
  slug: string | null
  list_name: string
  event_tag: string
  status: 'paused' | 'active' | 'completed'
  approval_status: string
  approval_note: string | null
  daily_cap: number
  daily_enrollment_cap: number
  sender_name: string
  sender_email: string
  reply_to: string | null
  acumbamail_list_id: string | null
  cadence_days: number[]
  brand_eyebrow: string | null
  landing_url: string | null
  import_exclude_keyword: string | null
  import_required_country: string | null
  require_marketing_attestation: boolean
  stop_on_open: boolean
  stop_on_click: boolean
}

type Step = {
  id: string
  step_number: number
  day_offset: number
  subject_template: string
  body_text_template: string
  only_without_engagement: boolean
}

type Detail = {
  campaign: Campaign
  steps: Step[]
  recent_messages: Array<{ id: string; step_number: number; status: string; recipient_email: string; scheduled_at: string; sent_at: string | null; error: string | null }>
  metrics: Record<string, number>
  readiness: { acumbamail_api: boolean; send_enabled: boolean }
}

const METRIC_LABELS: Array<[string, string]> = [
  ['pool', 'Contatti col tag'],
  ['enrollments', 'Iscritti'],
  ['active', 'In sequenza'],
  ['enrolled_today', 'Arruolati oggi'],
  ['sent', 'Email inviate'],
  ['opened', 'Aperture'],
  ['clicked', 'Click'],
  ['replied', 'Risposte'],
  ['hard_bounces', 'Hard bounce'],
  ['unsubscribes', 'Disiscrizioni'],
  ['complaints', 'Reclami'],
  ['stopped', 'Fermati'],
]

export default function CampagnaDetailPage() {
  const params = useParams<{ id: string }>()
  const { isAdmin, showToast } = useCRMContext()
  const [data, setData] = useState<Detail | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const detail = await apiFetch<Detail>(`/api/commercial/campaigns/${params.id}`)
      setData(detail)
      setSteps(detail.steps)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campagna non disponibile')
    }
  }, [params.id])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(updates: Record<string, unknown>) {
    setSaving(true)
    try {
      await apiFetch(`/api/commercial/campaigns/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await load()
      showToast('Campagna aggiornata')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Aggiornamento non riuscito')
    } finally {
      setSaving(false)
    }
  }

  async function saveSteps() {
    setSaving(true)
    try {
      await apiFetch(`/api/commercial/campaigns/${params.id}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps }),
      })
      await load()
      showToast('Email salvate')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  if (!data) return <main className="campaigns-page"><div className="card">{error || 'Caricamento…'}</div></main>

  const campaign = data.campaign
  const active = campaign.status === 'active'
  const approved = campaign.approval_status === 'approved'

  const field = (key: keyof Campaign, label: string, type: 'text' | 'number' = 'text') => (
    <label className="fl" key={key}>
      <span>{label}</span>
      <input
        className="fi"
        type={type}
        value={(campaign[key] as string | number | null) ?? ''}
        disabled={saving}
        onChange={(event) =>
          setData({ ...data, campaign: { ...campaign, [key]: type === 'number' ? Number(event.target.value) : event.target.value } })
        }
        onBlur={() => void patch({ [key]: campaign[key] })}
      />
    </label>
  )

  return (
    <main className="campaigns-page">
      <header className="campaigns-head">
        <div>
          <Link href="/campagne" className="campaigns-muted">← Campagne</Link>
          <h1>{campaign.name}</h1>
          <p className="campaigns-muted">
            {campaign.vertical} · tag <strong>{campaign.event_tag}</strong> · slug <strong>{campaign.slug}</strong> (non modificabile)
          </p>
        </div>
        <span className={`status-badge ${active ? 'success' : 'warning'}`}>{active ? 'Attiva' : 'In pausa'}</span>
      </header>

      {error ? <div className="card campaigns-error">{error}</div> : null}
      {!data.readiness.send_enabled ? (
        <div className="card">Kill switch attivo: nessuna email puo partire finche COMMERCIAL_OUTREACH_SEND_ENABLED non vale true.</div>
      ) : null}

      <section className="card">
        <h2 className="campaigns-section-title">Interruttori</h2>
        <div className="campaigns-actions">
          {!approved && isAdmin ? (
            <button
              className="btn"
              disabled={saving}
              onClick={() => void patch({ approval_status: 'approved', approval_note: 'Autorizzazione registrata dal titolare' })}
            >
              Registra approvazione
            </button>
          ) : null}
          <button
            className={`btn ${active ? 'danger' : 'primary'}`}
            disabled={saving || !isAdmin || (!approved && !active)}
            onClick={() => void patch({ status: active ? 'paused' : 'active' })}
          >
            {active ? 'Metti in pausa' : 'Attiva campagna'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="campaigns-section-title">Configurazione</h2>
        <div className="campaigns-grid">
          {field('name', 'Nome')}
          {field('list_name', 'Nome lista')}
          {field('sender_name', 'Mittente')}
          {field('sender_email', 'Email mittente')}
          {field('reply_to', 'Reply-to')}
          {field('brand_eyebrow', 'Intestazione email')}
          {field('landing_url', 'URL della CTA')}
          {field('acumbamail_list_id', 'Lista Acumbamail (id)')}
          {field('daily_enrollment_cap', 'Tetto arruolamenti / giorno', 'number')}
          {field('daily_cap', 'Tetto invii / giorno', 'number')}
          {field('import_exclude_keyword', 'Import · parola da escludere')}
          {field('import_required_country', 'Import · paese richiesto')}
        </div>
        <p className="campaigns-muted">
          I due filtri di import sono vuoti di default: senza valore nessun record viene scartato. Chi non supera il
          filtro paese entra col tag <strong>{campaign.event_tag}_en</strong> e senza iscrizione — parcheggiato, non perso.
        </p>
        <label className="fl">
          <span>Cadenza (giorni, separati da virgola)</span>
          <input
            className="fi"
            value={(campaign.cadence_days || []).join(', ')}
            disabled={saving}
            onChange={(event) =>
              setData({ ...data, campaign: { ...campaign, cadence_days: event.target.value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)) } })
            }
            onBlur={() => void patch({ cadence_days: campaign.cadence_days })}
          />
        </label>
        <div className="campaigns-actions">
          <label>
            <input type="checkbox" checked={campaign.stop_on_open} disabled={saving} onChange={(event) => void patch({ stop_on_open: event.target.checked })} /> Ferma all&apos;apertura
          </label>
          <label>
            <input type="checkbox" checked={campaign.stop_on_click} disabled={saving} onChange={(event) => void patch({ stop_on_click: event.target.checked })} /> Ferma al click
          </label>
          <label>
            <input type="checkbox" checked={campaign.require_marketing_attestation} disabled={saving} onChange={(event) => void patch({ require_marketing_attestation: event.target.checked })} /> Richiedi attestazione marketing
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="campaigns-section-title">Andamento</h2>
        <div className="campaigns-metrics">
          {METRIC_LABELS.map(([key, label]) => (
            <div key={key} className="campaigns-metric">
              <strong>{(data.metrics[key] || 0).toLocaleString('it-IT')}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="campaigns-section-title">Email della sequenza</h2>
        <p className="campaigns-muted">
          Segnaposto disponibili: <code>{'{{saluto}}'}</code>, <code>{'{{nome}}'}</code>, <code>{'{{azienda}}'}</code>,{' '}
          <code>{'{{landing_url}}'}</code>. Uno step gia inviato non e piu modificabile.
        </p>
        {steps.map((step, index) => (
          <div key={step.id || step.step_number} className="campaigns-step">
            <div className="campaigns-grid">
              <label className="fl">
                <span>Email {step.step_number} · giorno</span>
                <input
                  className="fi"
                  type="number"
                  min={0}
                  value={step.day_offset}
                  onChange={(event) =>
                    setSteps(steps.map((row, position) => (position === index ? { ...row, day_offset: Number(event.target.value) } : row)))
                  }
                />
              </label>
              <label className="fl">
                <span>Oggetto</span>
                <input
                  className="fi"
                  value={step.subject_template}
                  onChange={(event) =>
                    setSteps(steps.map((row, position) => (position === index ? { ...row, subject_template: event.target.value } : row)))
                  }
                />
              </label>
            </div>
            <textarea
              className="fi"
              rows={8}
              value={step.body_text_template}
              onChange={(event) =>
                setSteps(steps.map((row, position) => (position === index ? { ...row, body_text_template: event.target.value } : row)))
              }
            />
            <label>
              <input
                type="checkbox"
                checked={step.only_without_engagement}
                onChange={(event) =>
                  setSteps(steps.map((row, position) => (position === index ? { ...row, only_without_engagement: event.target.checked } : row)))
                }
              />{' '}
              Solo a chi non ha aperto ne cliccato
            </label>
          </div>
        ))}
        <button className="btn primary" disabled={saving || !isAdmin} onClick={() => void saveSteps()}>
          Salva le email
        </button>
      </section>

      <section className="card">
        <h2 className="campaigns-section-title">Ultimi invii</h2>
        {!data.recent_messages.length ? <p className="campaigns-muted">Nessun messaggio ancora.</p> : null}
        <div className="campaigns-table-wrap"><table className="campaigns-table">
          <tbody>
            {data.recent_messages.map((message) => (
              <tr key={message.id}>
                <td>{message.step_number}</td>
                <td>{message.recipient_email}</td>
                <td>{message.status}</td>
                <td className="campaigns-muted">{new Date(message.sent_at || message.scheduled_at).toLocaleString('it-IT')}</td>
                <td className="campaigns-muted">{message.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </main>
  )
}
