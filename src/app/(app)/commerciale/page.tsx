'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type CampaignRow = {
  id: string
  vertical: string
  name: string
  slug: string | null
  event_tag: string
  status: 'paused' | 'active' | 'completed'
  approval_status: string
  daily_cap: number
  daily_enrollment_cap: number
  acumbamail_list_id: string | null
  progress: { enrollments: number; active: number; sent: number; replied: number }
  legacy_page: string | null
}

/**
 * Progetto commerciale che gira su tabelle proprie (oggi solo Wine Project).
 * Compare nell'elenco coi suoi numeri, ma si apre sulla sua pagina.
 */
type ExternalProject = {
  key: string
  vertical: string
  name: string
  href: string
  status: string
  note: string
  progress: { enrollments: number; active: number; sent: number; pool: number }
}

const EMPTY_FORM = { name: '', vertical: '', event_tag: '', sender_name: '', sender_email: '' }

export default function CommercialePage() {
  const { isAdmin, showToast } = useCRMContext()
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null)
  const [externals, setExternals] = useState<ExternalProject[]>([])
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ campaigns: CampaignRow[]; external_projects?: ExternalProject[] }>('/api/commercial/campaigns')
      setCampaigns(data.campaigns)
      setExternals(data.external_projects || [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Progetti commerciali non disponibili')
      setCampaigns([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const byVertical = useMemo(() => {
    const map = new Map<string, CampaignRow[]>()
    for (const campaign of campaigns || []) {
      map.set(campaign.vertical, [...(map.get(campaign.vertical) || []), campaign])
    }
    return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0]))
  }, [campaigns])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setCreating(true)
    try {
      const created = await apiFetch<{ campaign: CampaignRow }>('/api/commercial/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      showToast(`Campagna "${created.campaign.name}" creata in pausa`)
      setForm(EMPTY_FORM)
      setShowForm(false)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Creazione non riuscita')
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="campaigns-page">
      <header className="campaigns-head">
        <div>
          <h1>Commerciale</h1>
          <p className="campaigns-muted">
            Tutti i progetti commerciali in un posto solo: Wine Project, Hospitality e i verticali che verranno.
            Aggiungerne uno e configurare una campagna — nome, tag contatti, mittente e testi — e nasce sempre in pausa.
          </p>
        </div>
        {isAdmin ? (
          <button className="btn primary" onClick={() => setShowForm((open) => !open)}>
            {showForm ? 'Annulla' : 'Nuova campagna'}
          </button>
        ) : null}
      </header>

      {error ? <div className="card campaigns-error">{error}</div> : null}

      {showForm ? (
        <form className="card" onSubmit={create}>
          <div className="campaigns-grid">
            <label className="fl">
              <span>Nome</span>
              <input className="fi" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="fl">
              <span>Verticale</span>
              <input
                className="fi"
                required
                placeholder="consorzi, gal, comuni, snai…"
                value={form.vertical}
                onChange={(event) => setForm({ ...form, vertical: event.target.value })}
              />
            </label>
            <label className="fl">
              <span>Tag contatti</span>
              <input
                className="fi"
                required
                placeholder="consorzi-2026"
                value={form.event_tag}
                onChange={(event) => setForm({ ...form, event_tag: event.target.value })}
              />
            </label>
            <label className="fl">
              <span>Mittente</span>
              <input className="fi" value={form.sender_name} placeholder="Massimo Morgante" onChange={(event) => setForm({ ...form, sender_name: event.target.value })} />
            </label>
            <label className="fl">
              <span>Email mittente</span>
              <input className="fi" type="email" value={form.sender_email} placeholder="info@speaqi.com" onChange={(event) => setForm({ ...form, sender_email: event.target.value })} />
            </label>
          </div>
          <p className="campaigns-muted">Tutto il resto — testi, cadenza, lista sorgente, filtri e tetti — si configura dopo, sulla pagina della campagna.</p>
          <button className="btn primary" type="submit" disabled={creating}>
            {creating ? 'Creazione…' : 'Crea campagna'}
          </button>
        </form>
      ) : null}

      {campaigns === null ? <div className="card">Caricamento…</div> : null}
      {campaigns !== null && !campaigns.length && !externals.length ? (
        <div className="card">Nessun progetto. Creane uno per iniziare.</div>
      ) : null}

      {externals.length ? (
        <section className="card">
          <h2 className="campaigns-section-title">Progetti su motore proprio</h2>
          <div className="campaigns-table-wrap">
            <table className="campaigns-table">
              <thead>
                <tr>
                  <th>Progetto</th>
                  <th>Stato</th>
                  <th>Bacino</th>
                  <th>In sequenza</th>
                  <th>In coda</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {externals.map((project) => (
                  <tr key={project.key}>
                    <td>
                      <Link href={project.href}>{project.name}</Link>
                    </td>
                    <td>
                      <span className={`status-badge ${project.status === 'active' ? 'success' : 'warning'}`}>
                        {project.status === 'active' ? 'Attivo' : 'In pausa'}
                      </span>
                    </td>
                    <td>{project.progress.pool}</td>
                    <td>{project.progress.active}</td>
                    <td>{project.progress.sent}</td>
                    <td className="campaigns-muted">{project.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {byVertical.map(([vertical, rows]) => (
        <section key={vertical} className="card">
          <h2 className="campaigns-section-title">{vertical}</h2>
          <div className="campaigns-table-wrap"><table className="campaigns-table">
            <thead>
              <tr>
                <th>Campagna</th>
                <th>Stato</th>
                <th>Tag</th>
                <th>Iscritti</th>
                <th>In corso</th>
                <th>Inviate</th>
                <th>Risposte</th>
                <th>Tetti</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <Link href={`/commerciale/${campaign.id}`}>{campaign.name}</Link>
                    {campaign.legacy_page ? (
                      <>
                        {' '}
                        <Link href={campaign.legacy_page} className="campaigns-muted">
                          (scheda dedicata)
                        </Link>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`status-badge ${campaign.status === 'active' ? 'success' : 'warning'}`}>
                      {campaign.status === 'active' ? 'Attiva' : campaign.status === 'completed' ? 'Conclusa' : 'In pausa'}
                    </span>
                  </td>
                  <td>{campaign.event_tag}</td>
                  <td>{campaign.progress.enrollments}</td>
                  <td>{campaign.progress.active}</td>
                  <td>{campaign.progress.sent}</td>
                  <td>{campaign.progress.replied}</td>
                  <td className="campaigns-muted">
                    {campaign.daily_enrollment_cap}/g arruolati · {campaign.daily_cap}/g invii
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      ))}
    </main>
  )
}
