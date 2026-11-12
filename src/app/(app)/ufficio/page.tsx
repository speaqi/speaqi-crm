'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'
import { officeSceneSnapshot, type OfficeSceneCommand, type OfficeSceneSnapshot, type OfficeSceneSystem } from '@/lib/office-scene'
import { isProductionAction, isProductionSlug, isRequestId, normalizeProductionJob, type ProductionOverview } from '@/lib/office/production'
import type { OfficeOverview } from '@/lib/office'
import { OfficePanel, type PanelTab } from './OfficePanel'
import { ProductionBoard } from '@/components/office/ProductionBoard'
import styles from './ufficio.module.css'

/**
 * L'Ufficio in una pagina: il campus 3D a sinistra, a destra il pannello da cui si fa tutto
 * (Direttore, proposte da decidere, agenti, piano di oggi). Lo schermo intero tiene entrambi.
 */
export default function UfficioPage() {
  const room = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const snapshot = useRef<OfficeSceneSnapshot | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const dataError = useRef('')
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [overview, setOverview] = useState<OfficeOverview | null>(null)
  const [tab, setTab] = useState<PanelTab>('waiting')
  const [department, setDepartment] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [openCity, setOpenCity] = useState<string | null>(null)
  // Quello che il campus mostra oltre agli agenti: città, comando in corso in StudioMap, pianificatore e backup.
  const overviewRef = useRef<OfficeOverview | null>(null)
  const extras = useRef<{ production: ProductionOverview | null; command: OfficeSceneCommand | null; system: OfficeSceneSystem | null }>({ production: null, command: null, system: null })
  // La vista di partenza è la sala di controllo delle città; il campus 3D (800 KB) si carica solo se lo si sceglie.
  const [view, setView] = useState<'production' | 'campus'>('production')
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('vista')
    let saved: string | null = null
    try { saved = window.localStorage.getItem('speaqi.ufficio.vista') } catch { /* senza storage vale la vista di partenza */ }
    if (asked === 'campus' || (asked !== 'citta' && saved === 'campus')) setView('campus')
  }, [])
  const pickView = useCallback((next: 'production' | 'campus') => {
    setView(next)
    try { window.localStorage.setItem('speaqi.ufficio.vista', next) } catch { /* preferenza non salvata */ }
  }, [])
  // «Aspetta te» in prima pagina porta qui con ?uscita=<id>: si apre la proposta nel pannello.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('uscita')
    if (id) { setTab('waiting'); setHighlight(id) }
  }, [])

  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(message, '*'), [])
  const publish = useCallback(() => {
    if (!overviewRef.current) return
    snapshot.current = officeSceneSnapshot(overviewRef.current, new Date().toISOString(), extras.current)
    send({ type: 'office:snapshot', snapshot: snapshot.current })
  }, [send])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    const abort = () => controller.abort()
    if (signal?.aborted) return
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const data = await apiFetch<OfficeOverview>('/api/office', { signal: controller.signal })
      if (controller.signal.aborted) return
      setOverview(data)
      overviewRef.current = data
      publish()
      dataError.current = ''
      setError('')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Dati dell’ufficio non disponibili'
      setError(message)
      dataError.current = message
      send({ type: 'office:error', message })
    } finally { signal?.removeEventListener('abort', abort) }
  }, [send, publish])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (view !== 'campus' || html) return
    const controller = new AbortController()
    setSceneFailed(false)
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession()
        const response = await fetch('/api/ufficio/scena', {
          headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
          signal: controller.signal,
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Impossibile aprire l’ufficio')
        }
        const text = await response.text()
        if (!controller.signal.aborted) setHtml(text)
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossibile aprire l’ufficio')
      }
    })()
    return () => controller.abort()
  }, [view, html, attempt])

  // Solo con il campus aperto: le città (una lettura al minuto, in cache sul server), lo stato del sistema
  // e il comando lanciato dalla riga di una città, che qui si segue anche se la sala «Città» è chiusa.
  useEffect(() => {
    if (view !== 'campus') return
    let stopped = false
    const cities = async () => {
      try { extras.current.production = await apiFetch<ProductionOverview>('/api/office/production') }
      catch (err) { extras.current.production = { available: false, reason: err instanceof Error ? err.message : 'città non lette' } }
      if (!stopped) publish()
    }
    const system = async () => {
      try { extras.current.system = await apiFetch<OfficeSceneSystem>('/api/office/system'); if (!stopped) publish() } catch { /* l'orologio resta «non letto» */ }
    }
    const command = async () => {
      let saved: { slug?: unknown; name?: unknown; action?: unknown; request_id?: unknown } | null = null
      try { saved = JSON.parse(window.localStorage.getItem('speaqi.ufficio.comando') || 'null') } catch { /* niente da seguire */ }
      const current = extras.current.command
      if (!saved || !isProductionSlug(saved.slug) || !isProductionAction(saved.action) || !isRequestId(saved.request_id)) return
      if (current?.done && current.slug === saved.slug && current.action === saved.action) return
      const base = { slug: saved.slug, name: typeof saved.name === 'string' ? saved.name.slice(0, 80) : saved.slug, action: saved.action }
      try {
        const result = await apiFetch<{ job?: unknown }>('/api/office/production/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: saved.slug, action: saved.action, request_id: saved.request_id }) })
        const job = normalizeProductionJob(result.job)
        if (stopped || !job) return
        extras.current.command = { ...base, phase: job.phase || '', last: job.last || '', done: job.done, error: job.error || null }
        publish()
        if (job.done) void cities()
      } catch { /* un errore di rete non è l'esito del lavoro: si rilegge al giro dopo */ }
    }
    void cities(); void system(); void command()
    const timers = [setInterval(() => { if (!document.hidden) void cities() }, 60_000), setInterval(() => { if (!document.hidden) void system() }, 300_000),
      setInterval(() => { if (!document.hidden) void command() }, 4_000)]
    return () => { stopped = true; timers.forEach(clearInterval) }
  }, [view, publish])

  const activeWork = overview?.works?.some((work) => ['ready', 'running'].includes(work.status)) || overview?.runs.some((run) => run.status === 'running')
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, activeWork ? 5_000 : 30_000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [activeWork, refresh])
  useEffect(() => () => refreshController.current?.abort(), [])

  useEffect(() => {
    function message(event: MessageEvent) {
      // L’iframe sandbox ha origine opaca: l’identità è la finestra, mai il payload.
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'office:ready') {
        // Barra e pannello li disegna la pagina: alla scena resta il campus.
        send({ type: 'office:embed', panel: false })
        if (snapshot.current) send({ type: 'office:snapshot', snapshot: snapshot.current })
        if (dataError.current) send({ type: 'office:error', message: dataError.current })
      } else if (event.data?.type === 'office:refresh') void refresh()
      else if (event.data?.type === 'office:failed') setSceneFailed(true)
      else if (event.data?.type === 'office:escape') { if (!document.fullscreenElement) setFull(false) }
      else if (event.data?.type === 'office:focus') {
        const id = event.data.department
        setDepartment(typeof id === 'string' ? id : null)
        const agentId = event.data.agentId
        const agent = snapshot.current?.departments.flatMap((sector) => sector.agents).find((item) => item.id === agentId)
        setSelectedAgentId(agent?.id || null)
        if (typeof id === 'string') { setTab('team'); setDrawer(true) }
      } else if (event.data?.type === 'office:cities') {
        // Dal plastico: si apre la sala «Città», sulla riga scelta.
        setOpenCity(isProductionSlug(event.data.slug) ? event.data.slug : null); pickView('production')
      } else if (event.data?.type === 'office:navigate') {
        // Dal 3D non si cambia pagina: il totem «Aspetta te» e le schede aprono il pannello.
        const id = event.data.outputId
        setDrawer(true)
        if (typeof event.data.agentId === 'string') {
          const sector = snapshot.current?.departments.find((item) => item.agents.some((agent) => agent.id === event.data.agentId))
          if (sector) { setSelectedAgentId(event.data.agentId); setDepartment(sector.id); setTab('team') }
          return
        }
        setSelectedAgentId(null)
        setTab('waiting'); setHighlight(typeof id === 'string' ? id : null)
      }
    }
    window.addEventListener('message', message)
    return () => window.removeEventListener('message', message)
  }, [refresh, send, pickView])

  const reload = useCallback(() => refresh(), [refresh])
  const pickDepartment = useCallback((id: string | null) => { setDepartment(id); setSelectedAgentId(null); send({ type: 'office:focus', department: id }) }, [send])
  const selectAgent = useCallback((id: string | null) => {
    const sector = snapshot.current?.departments.find((item) => item.agents.some((agent) => agent.id === id))
    setSelectedAgentId(sector ? id : null)
    if (sector) setDepartment(sector.id)
    send({ type: 'office:focus', department: sector?.id || department, agentId: sector ? id : null })
  }, [send, department])

  // Schermo intero vero dove il browser lo permette; altrimenti la stanza copre la finestra.
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === room.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  async function toggleFull() {
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return }
    if (full) { setFull(false); return }
    try { await room.current?.requestFullscreen() } catch { setFull(true) }
  }
  useEffect(() => {
    // Si entra a schermo intero con il cassetto chiuso: prima si guarda il campus.
    setDrawer(false)
    if (!full) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [full])
  useEffect(() => {
    if (!full || document.fullscreenElement) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [full])

  return <div ref={room} className={`${styles.room} ${full ? styles.full : ''} ${full && drawer ? styles.drawerOpen : ''}`}>
    <div className={styles.stage}>
    <div className={styles.viewSwitch} role="tablist" aria-label="Vista dell’Ufficio">
      <button type="button" role="tab" aria-selected={view === 'production'} onClick={() => pickView('production')}>Città</button>
      <button type="button" role="tab" aria-selected={view === 'campus'} onClick={() => pickView('campus')}>Campus 3D</button>
      <button type="button" onClick={() => { void toggleFull() }} aria-pressed={full}
        aria-label={full ? 'Esci da schermo intero' : 'Schermo intero'} title={full ? 'Esci da schermo intero' : 'Schermo intero'}>{full ? '✕' : '⛶'}</button>
      {full && <button type="button" onClick={() => setDrawer((open) => !open)} aria-pressed={drawer}>{drawer ? 'Chiudi pannello' : 'Pannello'}</button>}
    </div>
    {(error || (view === 'campus' && sceneFailed)) && <div role="alert" style={{ padding: '10px 16px', color: '#fff2cb', background: '#3e3025', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{error || 'Il 3D non è disponibile in questo browser.'}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); if (view === 'campus' && (!html || sceneFailed)) { setHtml(null); setAttempt((n) => n + 1) } else void refresh() }}>Riprova</button>
      <Link href="/ufficio/agenti" style={{ color: 'inherit' }}>Apri agenti e bozze →</Link>
    </div>}
    {view === 'production' ? <ProductionBoard onOrdered={reload} openSlug={openCity} />
      : html ? <iframe ref={frame} title="Ufficio Speaqi" srcDoc={html} sandbox="allow-scripts"
        style={{ flex: 1, border: 0, width: '100%', minHeight: 0 }} />
      : !error && <p style={{ margin: 'auto', color: '#b9c8d0' }}>Apro il campus…</p>}
    </div>
    <div className={styles.side}><OfficePanel data={overview} reload={reload} tab={tab} setTab={setTab}
      department={department} setDepartment={pickDepartment} highlight={highlight} selectedAgentId={selectedAgentId} selectAgent={selectAgent} /></div>
  </div>
}
