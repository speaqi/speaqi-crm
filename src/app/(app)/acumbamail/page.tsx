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
  const opensFileRef = useRef<HTMLInputElement>(null)
  const clicksFileRef = useRef<HTMLInputElement>(null)
  const unsubscribesFileRef = useRef<HTMLInputElement>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [name, setName] = useState('')
  const [listName, setListName] = useState('Comuni')
  const [minOpens, setMinOpens] = useState(5)
  const [responsible, setResponsible] = useState('')
  const [opensCsvText, setOpensCsvText] = useState('')
  const [clicksCsvText, setClicksCsvText] = useState('')
  const [unsubscribesCsvText, setUnsubscribesCsvText] = useState('')
  const [opensFileName, setOpensFileName] = useState('')
  const [clicksFileName, setClicksFileName] = useState('')
  const [unsubscribesFileName, setUnsubscribesFileName] = useState('')
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

  function readFile(event: ChangeEvent<HTMLInputElement>, kind: 'opens' | 'clicks' | 'unsubscribes') {
    const file = event.target.files?.[0]
    if (!file) return
    if (kind === 'opens') setOpensFileName(file.name)
    if (kind === 'clicks') setClicksFileName(file.name)
    if (kind === 'unsubscribes') setUnsubscribesFileName(file.name)
    if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      if (kind === 'opens') setOpensCsvText(text)
      if (kind === 'clicks') setClicksCsvText(text)
      if (kind === 'unsubscribes') setUnsubscribesCsvText(text)
    }
    reader.onerror = () => setError('Impossibile leggere il CSV')
    reader.readAsText(file)
  }

  async function importCampaign() {
    if (!name.trim() || (!opensCsvText.trim() && !clicksCsvText.trim())) return
    setLoading(true)
    setError('')
    try {
      const result = await apiFetch<{ parsed: number; qualified: number; clickers: number; excluded_unsubscribed: number }>('/api/integrations/acumbamail/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          list_name: listName,
          min_opens: minOpens,
          responsible: responsible || null,
          opens_csv_text: opensCsvText,
          clicks_csv_text: clicksCsvText,
          unsubscribes_csv_text: unsubscribesCsvText,
        }),
      })
      showToast(`${result.qualified} qualificati · ${result.clickers} clicker · ${result.excluded_unsubscribed} cancellati esclusi`)
      setOpensCsvText('')
      setClicksCsvText('')
      setUnsubscribesCsvText('')
      setOpensFileName('')
      setClicksFileName('')
      setUnsubscribesFileName('')
      setName('')
      if (opensFileRef.current) opensFileRef.current.value = ''
      if (clicksFileRef.current) clicksFileRef.current.value = ''
      if (unsubscribesFileRef.current) unsubscribesFileRef.current.value = ''
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
        <p>Unisce aperture e click per email. I click qualificano subito; i cancellati vengono sempre esclusi.</p>
      </header>

      <section className="acumbamail-card">
        <div className="acumbamail-card-head">
          <div>
            <h2>Nuova campagna</h2>
            <p>Carica i due report separati di Acumbamail. Lo stesso contatto presente in entrambi viene contato una sola volta.</p>
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

        <div className="acumbamail-upload-grid">
          <button type="button" className="acumbamail-upload" onClick={() => opensFileRef.current?.click()}>
            <strong>{opensFileName || 'CSV aperture'}</strong>
            <span>{opensFileName ? 'File pronto' : `Qualifica da ${minOpens} aperture`}</span>
          </button>
          <button type="button" className="acumbamail-upload acumbamail-upload-clicks" onClick={() => clicksFileRef.current?.click()}>
            <strong>{clicksFileName || 'CSV click'}</strong>
            <span>{clicksFileName ? 'File pronto' : 'Un click qualifica immediatamente'}</span>
          </button>
          <button type="button" className="acumbamail-upload acumbamail-upload-unsubscribes" onClick={() => unsubscribesFileRef.current?.click()}>
            <strong>{unsubscribesFileName || 'CSV cancellati (opzionale)'}</strong>
            <span>{unsubscribesFileName ? 'File pronto' : 'Ha precedenza ed esclude i contatti'}</span>
          </button>
        </div>
        <input ref={opensFileRef} type="file" accept=".csv,text/csv" onChange={(event) => readFile(event, 'opens')} hidden />
        <input ref={clicksFileRef} type="file" accept=".csv,text/csv" onChange={(event) => readFile(event, 'clicks')} hidden />
        <input ref={unsubscribesFileRef} type="file" accept=".csv,text/csv" onChange={(event) => readFile(event, 'unsubscribes')} hidden />
        {error && <div className="import-error">{error}</div>}
        <div className="acumbamail-actions">
          <button type="button" className="btn btn-primary" disabled={loading || !name.trim() || (!opensCsvText.trim() && !clicksCsvText.trim())} onClick={importCampaign}>
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
