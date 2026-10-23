'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { apiFetch } from '@/lib/api'
import { officeSceneSnapshot, type OfficeSceneSnapshot } from '@/lib/office-scene'
import type { OfficeOverview } from '@/lib/office'

export default function UfficioPage() {
  const router = useRouter()
  const frame = useRef<HTMLIFrameElement>(null)
  const snapshot = useRef<OfficeSceneSnapshot | null>(null)
  const refreshController = useRef<AbortController | null>(null)
  const dataError = useRef('')
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sceneFailed, setSceneFailed] = useState(false)

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
    const interval = setInterval(() => { if (!document.hidden) void refresh(controller.signal) }, 30_000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [refresh, attempt])

  useEffect(() => {
    function message(event: MessageEvent) {
      // L’iframe sandbox ha origine opaca: l’identità è la finestra, mai il payload.
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'office:ready') {
        if (snapshot.current) send({ type: 'office:snapshot', snapshot: snapshot.current })
        if (dataError.current) send({ type: 'office:error', message: dataError.current })
      } else if (event.data?.type === 'office:refresh') void refresh()
      else if (event.data?.type === 'office:failed') setSceneFailed(true)
      else if (event.data?.type === 'office:navigate') {
        const id = event.data.outputId
        const agentId = event.data.agentId
        const hash = typeof id === 'string' ? `#uscita-${encodeURIComponent(id)}`
          : typeof agentId === 'string' ? `#agente-${encodeURIComponent(agentId)}` : ''
        router.push(`/ufficio/agenti${hash}`)
      }
    }
    window.addEventListener('message', message)
    return () => window.removeEventListener('message', message)
  }, [refresh, router, send])

  return <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#101b26', position: 'relative' }}>
    {(error || sceneFailed) && <div role="alert" style={{ padding: '10px 16px', color: '#fff2cb', background: '#3e3025', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <span>{error || 'Il 3D non è disponibile in questo browser.'}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); if (!html || sceneFailed) { setHtml(null); setAttempt((n) => n + 1) } else void refresh() }}>Riprova</button>
      <Link href="/ufficio/agenti" style={{ color: 'inherit' }}>Apri agenti e bozze →</Link>
    </div>}
    {html ? <iframe ref={frame} title="Ufficio Speaqi" srcDoc={html} sandbox="allow-scripts"
      style={{ flex: 1, border: 0, width: '100%', minHeight: 0 }} />
      : !error && <p style={{ margin: 'auto', color: '#b9c8d0' }}>Apro l’ufficio…</p>}
  </div>
}
