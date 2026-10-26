'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'
import { officeSceneSnapshot, type OfficeSceneSnapshot } from '@/lib/office-scene'
import type { OfficeOverview } from '@/lib/office'
import { OfficePanel, type PanelTab } from './OfficePanel'
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
  // «Aspetta te» in prima pagina porta qui con ?uscita=<id>: si apre la proposta nel pannello.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('uscita')
    if (id) { setTab('waiting'); setHighlight(id) }
  }, [])

  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(message, '*'), [])
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
      snapshot.current = officeSceneSnapshot(data)
      send({ type: 'office:snapshot', snapshot: snapshot.current })
      dataError.current = ''
      setError('')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Dati dell’ufficio non disponibili'
      setError(message)
      dataError.current = message
      send({ type: 'office:error', message })
    } finally { signal?.removeEventListener('abort', abort) }
  }, [send])

  useEffect(() => {
    const controller = new AbortController()
    setSceneFailed(false)
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession()
        const response = await fetch('/api/ufficio/scena', {
          headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
          cache: 'no-store', signal: controller.signal,
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
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh, attempt])

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
        if (typeof id === 'string') setTab('team')
      } else if (event.data?.type === 'office:navigate') {
        // Dal 3D non si cambia pagina: il totem «Aspetta te» e le schede aprono il pannello.
        const id = event.data.outputId
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
  }, [refresh, send])

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
    if (!full || document.fullscreenElement) return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [full])

  return <div ref={room} className={`${styles.room} ${full ? styles.full : ''}`}>
    <div className={styles.stage}>
    {(error || sceneFailed) && <div role="alert" style={{ padding: '10px 16px', color: '#fff2cb', background: '#3e3025', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{error || 'Il 3D non è disponibile in questo browser.'}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); if (!html || sceneFailed) { setHtml(null); setAttempt((n) => n + 1) } else void refresh() }}>Riprova</button>
      <Link href="/ufficio/agenti" style={{ color: 'inherit' }}>Apri agenti e bozze →</Link>
    </div>}
    {html ? <iframe ref={frame} title="Ufficio Speaqi" srcDoc={html} sandbox="allow-scripts"
      style={{ flex: 1, border: 0, width: '100%', minHeight: 0 }} />
      : !error && <p style={{ margin: 'auto', color: '#b9c8d0' }}>Apro l’ufficio…</p>}
      <button type="button" className={styles.fullButton} onClick={() => { void toggleFull() }}
        aria-pressed={full}>{full ? '✕ Esci da schermo intero' : '⛶ Schermo intero'}</button>
    </div>
    <OfficePanel data={overview} reload={reload} tab={tab} setTab={setTab}
      department={department} setDepartment={pickDepartment} highlight={highlight} selectedAgentId={selectedAgentId} selectAgent={selectAgent} />
  </div>
}
