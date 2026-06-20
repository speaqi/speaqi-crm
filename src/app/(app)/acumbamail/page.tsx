'use client'

import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type Campaign = {
  id: string
  campaign_key: string
  name: string
  list_name: string
  min_opens: number
  responsible: string | null
  tracked: number
  qualified: number
  webhook_url: string | null
}

export default function AcumbamailPage() {
  const { isAdmin, teamMembers, refresh, showToast } = useCRMContext()
  const fileRef = useRef<HTMLInputElement>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [name, setName] = useState('')
  const [listName, setListName] = useState('Comuni')
  const [minOpens, setMinOpens] = useState(5)
  const [responsible, setResponsible] = useState('')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadCampaigns() {
    try {
      const response = await apiFetch<{ campaigns: Campaign[] }>('/api/integrations/acumbamail/campaigns')
      setCampaigns(response.campaigns)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Caricamento non riuscito')
    }
  }

  useEffect(() => {
    if (isAdmin) void loadCampaigns()
  }, [isAdmin])

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    const reader = new FileReader()
    reader.onload = () => setCsvText(String(reader.result || ''))
    reader.onerror = () => setError('Impossibile leggere il CSV')
    reader.readAsText(file)
  }

  async function importCampaign() {
    if (!name.trim() || !csvText.trim()) return
    setLoading(true)
    setError('')
    try {
      const result = await apiFetch<{ parsed: number; qualified: number }>('/api/integrations/acumbamail/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          list_name: listName,
          min_opens: minOpens,
          responsible: responsible || null,
          csv_text: csvText,
        }),
      })
      showToast(`${result.qualified} contatti con almeno ${minOpens} aperture inseriti in “${listName}”`)
      setCsvText('')
      setFileName('')
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      await Promise.all([loadCampaigns(), refresh()])
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import non riuscito')
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) return <div className="inline-error">L’area Acumbamail è riservata agli amministratori.</div>

  return (
    <div className="acumbamail-page">
      <header className="page-header">
        <h1>Acumbamail</h1>
        <p>Una campagna, un CSV storico e un webhook. Entrano nella lista solo i contatti che raggiungono la soglia.</p>
      </header>

      <section className="acumbamail-card">
        <div className="acumbamail-card-head">
          <div>
            <h2>Nuova campagna</h2>
            <p>Il CSV deve contenere almeno la colonna email. Se è presente una colonna aperture/open count, viene usata come storico.</p>
          </div>
          <span className="acumbamail-threshold">≥ {minOpens} aperture</span>
        </div>

        <div className="acumbamail-form-grid">
          <label><span>Nome campagna</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Comuni giugno 2026" /></label>
          <label><span>Lista di destinazione</span><input value={listName} onChange={(event) => setListName(event.target.value)} /></label>
          <label><span>Aperture minime</span><input type="number" min="1" value={minOpens} onChange={(event) => setMinOpens(Math.max(1, Number(event.target.value) || 1))} /></label>
          <label>
            <span>Responsabile</span>
            <select value={responsible} onChange={(event) => setResponsible(event.target.value)}>
              <option value="">Nessuno</option>
              {teamMembers.map((member) => <option key={member.id} value={member.name}>{member.name}</option>)}
            </select>
          </label>
        </div>

        <button type="button" className="acumbamail-upload" onClick={() => fileRef.current?.click()}>
          <strong>{fileName || 'Carica il CSV Acumbamail'}</strong>
          <span>{fileName ? 'File pronto per l’import' : 'Seleziona il report esportato dalla campagna'}</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={readFile} hidden />
        {error && <div className="import-error">{error}</div>}
        <div className="acumbamail-actions">
          <button type="button" className="btn btn-primary" disabled={loading || !name.trim() || !csvText.trim()} onClick={importCampaign}>
            {loading ? 'Importazione…' : 'Crea campagna e importa'}
          </button>
        </div>
      </section>

      <section className="acumbamail-campaigns">
        <h2>Campagne configurate</h2>
        {campaigns.length === 0 ? <p className="import-muted">Nessuna campagna configurata.</p> : campaigns.map((campaign) => (
          <article key={campaign.id} className="acumbamail-campaign-row">
            <div className="acumbamail-campaign-main">
              <h3>{campaign.name}</h3>
              <p>Lista “{campaign.list_name}” · soglia {campaign.min_opens} aperture{campaign.responsible ? ` · ${campaign.responsible}` : ''}</p>
            </div>
            <div className="acumbamail-stats"><strong>{campaign.qualified}</strong><span>qualificati / {campaign.tracked} monitorati</span></div>
            <div className="acumbamail-webhook">
              {campaign.webhook_url ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                  await navigator.clipboard.writeText(campaign.webhook_url || '')
                  showToast('URL webhook copiato')
                }}>Copia webhook</button>
              ) : <span className="inline-hint inline-hint-warn">Configura ACUMBAMAIL_WEBHOOK_TOKEN</span>}
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
