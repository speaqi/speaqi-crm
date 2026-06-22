'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useCRMContext } from '../layout'

type Campaign = {
  id: string
  campaign_key: string
  campaign_id: string | null
  name: string
  list_name: string
  min_opens: number
  responsible: string | null
  tracked: number
  qualified: number
  webhook_url: string | null
  last_synced_at: string | null
  last_sync_error: string | null
}

type CampaignDetailRow = {
  email: string
  name: string | null
  open_count: number
  click_count: number
  last_open_at: string | null
  qualified: boolean
}

type CampaignDetail = {
  rows: CampaignDetailRow[]
  summary: {
    tracked: number
    openers: number
    clickers: number
    clickers_under_threshold: number
    qualified: number
  }
  fetched_at: string
}

type DetailFilter = 'all' | 'qualified' | 'clickers' | 'openers'
const DETAIL_PAGE_SIZE = 100

function formatUpdateTime(value: string) {
  return new Date(value).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function AcumbamailPage() {
  const { isAdmin, teamMembers, refresh, showToast } = useCRMContext()
  const opensFileRef = useRef<HTMLInputElement>(null)
  const clicksFileRef = useRef<HTMLInputElement>(null)
  const unsubscribesFileRef = useRef<HTMLInputElement>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [name, setName] = useState('')
  const [campaignId, setCampaignId] = useState('')
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
  const [expandedCampaignKey, setExpandedCampaignKey] = useState<string | null>(null)
  const [detailsByCampaign, setDetailsByCampaign] = useState<Record<string, CampaignDetail>>({})
  const [detailLoadingKey, setDetailLoadingKey] = useState<string | null>(null)
  const [detailFilter, setDetailFilter] = useState<DetailFilter>('all')
  const [detailSearch, setDetailSearch] = useState('')
  const [detailPage, setDetailPage] = useState(1)
  const [syncingCampaignKey, setSyncingCampaignKey] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    try {
      const response = await apiFetch<{ campaigns: Campaign[] }>('/api/integrations/acumbamail/campaigns')
      setCampaigns(response.campaigns)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Caricamento non riuscito')
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void loadCampaigns()
  }, [isAdmin, loadCampaigns])

  const loadCampaignDetails = useCallback(async (campaignKey: string, silent = false) => {
    if (!silent) setDetailLoadingKey(campaignKey)
    try {
      const response = await apiFetch<CampaignDetail>(
        `/api/integrations/acumbamail/campaigns/${encodeURIComponent(campaignKey)}`
      )
      setDetailsByCampaign((previous) => ({ ...previous, [campaignKey]: response }))
    } catch (detailError) {
      if (!silent) setError(detailError instanceof Error ? detailError.message : 'Dettaglio campagna non disponibile')
    } finally {
      if (!silent) setDetailLoadingKey(null)
    }
  }, [])

  const syncCampaign = useCallback(async (campaign: Campaign, silent = false) => {
    if (!campaign.campaign_id) return
    if (!silent) setSyncingCampaignKey(campaign.campaign_key)
    try {
      await apiFetch('/api/integrations/acumbamail/sync-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaign.campaign_id,
          campaign_key: campaign.campaign_key,
          event_tag: campaign.campaign_key,
          list_name: campaign.list_name,
          min_opens: campaign.min_opens,
          responsible: campaign.responsible,
          contact_scope: 'holding',
          source: 'acumbamail',
          create_missing: true,
        }),
      })
      await Promise.all([loadCampaigns(), loadCampaignDetails(campaign.campaign_key, true)])
      if (!silent) showToast('Dati Acumbamail sincronizzati')
    } catch (syncError) {
      if (!silent) setError(syncError instanceof Error ? syncError.message : 'Sincronizzazione non riuscita')
    } finally {
      if (!silent) setSyncingCampaignKey(null)
    }
  }, [loadCampaignDetails, loadCampaigns, showToast])

  useEffect(() => {
    if (!expandedCampaignKey) return
    const intervalId = window.setInterval(() => {
      void loadCampaignDetails(expandedCampaignKey, true)
    }, 30_000)
    return () => window.clearInterval(intervalId)
  }, [expandedCampaignKey, loadCampaignDetails])

  useEffect(() => {
    if (!expandedCampaignKey) return
    const campaign = campaigns.find((item) => item.campaign_key === expandedCampaignKey)
    if (!campaign?.campaign_id) return
    const intervalId = window.setInterval(() => {
      void syncCampaign(campaign, true)
    }, 120_000)
    return () => window.clearInterval(intervalId)
  }, [campaigns, expandedCampaignKey, syncCampaign])

  const visibleDetailRows = useMemo(() => {
    if (!expandedCampaignKey) return []
    const rows = detailsByCampaign[expandedCampaignKey]?.rows || []
    const search = detailSearch.trim().toLowerCase()
    return rows.filter((row) => {
      if (detailFilter === 'qualified' && !row.qualified) return false
      if (detailFilter === 'clickers' && row.click_count < 1) return false
      if (detailFilter === 'openers' && row.open_count < 1) return false
      if (search && !`${row.name || ''} ${row.email}`.toLowerCase().includes(search)) return false
      return true
    })
  }, [detailsByCampaign, detailFilter, detailSearch, expandedCampaignKey])

  function readFile(event: ChangeEvent<HTMLInputElement>, kind: 'opens' | 'clicks' | 'unsubscribes') {
    const file = event.target.files?.[0]
    if (!file) return
    if (kind === 'opens') setOpensFileName(file.name)
    if (kind === 'clicks') setClicksFileName(file.name)
    if (kind === 'unsubscribes') setUnsubscribesFileName(file.name)
    const detectedCampaignId = file.name.match(/(\d{5,})/)?.[1]
    if (detectedCampaignId && !campaignId) setCampaignId(detectedCampaignId)
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
          campaign_id: campaignId || null,
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
      setCampaignId('')
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
          <label><span>ID campagna Acumbamail</span><input value={campaignId} onChange={(event) => setCampaignId(event.target.value.replace(/\D/g, ''))} placeholder="Es. 3796370" /></label>
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
        {campaigns.length === 0 ? <p className="import-muted">Nessuna campagna configurata.</p> : campaigns.map((campaign) => {
          const isExpanded = expandedCampaignKey === campaign.campaign_key
          const detail = detailsByCampaign[campaign.campaign_key]
          const totalPages = Math.max(1, Math.ceil(visibleDetailRows.length / DETAIL_PAGE_SIZE))
          const page = Math.min(detailPage, totalPages)
          const pageRows = isExpanded
            ? visibleDetailRows.slice((page - 1) * DETAIL_PAGE_SIZE, page * DETAIL_PAGE_SIZE)
            : []
          return (
            <article key={campaign.id} className={`acumbamail-campaign-item ${isExpanded ? 'is-expanded' : ''}`}>
              <div className="acumbamail-campaign-row">
                <div className="acumbamail-campaign-main">
                  <h3>{campaign.name}</h3>
                  <p>Lista “{campaign.list_name}” · ID {campaign.campaign_id || 'non configurato'} · soglia {campaign.min_opens} aperture{campaign.responsible ? ` · ${campaign.responsible}` : ''}</p>
                  {campaign.last_synced_at && <p>Ultima sync API: {new Date(campaign.last_synced_at).toLocaleString('it-IT')}</p>}
                  {campaign.last_sync_error && <p className="acumbamail-sync-error">{campaign.last_sync_error}</p>}
                </div>
                <div className="acumbamail-stats"><strong>{campaign.qualified}</strong><span>qualificati / {campaign.tracked} monitorati</span></div>
                <div className="acumbamail-webhook">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!campaign.campaign_id || syncingCampaignKey === campaign.campaign_key} onClick={() => void syncCampaign(campaign)}>
                    {syncingCampaignKey === campaign.campaign_key ? 'Sincronizzo…' : 'Sincronizza ora'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                    const nextKey = isExpanded ? null : campaign.campaign_key
                    setExpandedCampaignKey(nextKey)
                    setDetailFilter('all')
                    setDetailSearch('')
                    setDetailPage(1)
                    if (nextKey) void loadCampaignDetails(nextKey)
                  }}>{isExpanded ? 'Chiudi lista' : 'Vedi lista'}</button>
                  {campaign.webhook_url ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                      await navigator.clipboard.writeText(campaign.webhook_url || '')
                      showToast('URL webhook copiato')
                    }}>Copia webhook</button>
                  ) : <span className="inline-hint inline-hint-warn">Configura ACUMBAMAIL_WEBHOOK_TOKEN</span>}
                </div>
              </div>

              {isExpanded && (
                <div className="acumbamail-detail">
                  {detailLoadingKey === campaign.campaign_key && !detail ? (
                    <div className="import-muted">Caricamento lista…</div>
                  ) : detail ? (
                    <>
                      <div className="acumbamail-detail-summary">
                        <div><strong>{detail.summary.openers}</strong><span>hanno aperto</span></div>
                        <div><strong>{detail.summary.clickers}</strong><span>hanno cliccato</span></div>
                        <div><strong>{detail.summary.clickers_under_threshold}</strong><span>click con meno di {campaign.min_opens} aperture</span></div>
                        <div><strong>{detail.summary.qualified}</strong><span>qualificati</span></div>
                      </div>
                      <div className="acumbamail-detail-toolbar">
                        <input value={detailSearch} onChange={(event) => { setDetailSearch(event.target.value); setDetailPage(1) }} placeholder="Cerca nome o email" />
                        <select value={detailFilter} onChange={(event) => { setDetailFilter(event.target.value as DetailFilter); setDetailPage(1) }}>
                          <option value="all">Tutti monitorati</option>
                          <option value="qualified">Solo qualificati</option>
                          <option value="clickers">Solo click</option>
                          <option value="openers">Solo aperture</option>
                        </select>
                        <span>Aggiornato alle {formatUpdateTime(detail.fetched_at)} · auto 30s</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadCampaignDetails(campaign.campaign_key)}>Aggiorna ora</button>
                      </div>
                      <div className="acumbamail-detail-table-wrap">
                        <table className="acumbamail-detail-table">
                          <thead><tr><th>Contatto</th><th>Email</th><th>Aperture</th><th>Click</th><th>Esito</th></tr></thead>
                          <tbody>
                            {pageRows.map((row) => (
                              <tr key={row.email}>
                                <td>{row.name || '—'}</td>
                                <td>{row.email}</td>
                                <td><strong>{row.open_count}</strong></td>
                                <td>{row.click_count > 0 ? <span className="acumbamail-click-badge">✓ Ha cliccato</span> : '—'}</td>
                                <td>{row.qualified ? <span className="acumbamail-qualified-badge">Qualificato</span> : <span className="import-muted">In monitoraggio</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="acumbamail-detail-pagination">
                        <span>{visibleDetailRows.length} risultati · pagina {page} di {totalPages}</span>
                        <div>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setDetailPage(page - 1)}>Precedente</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setDetailPage(page + 1)}>Successiva</button>
                        </div>
                      </div>
                    </>
                  ) : <div className="import-error">Impossibile caricare la lista.</div>}
                </div>
              )}
            </article>
          )
        })}
      </section>
    </div>
  )
}
