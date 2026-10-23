'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

/**
 * L'ufficio degli agenti in 3D. La scena è una pagina HTML a sé (three.js da CDN),
 * servita solo al titolare da /api/ufficio/scena e montata in un iframe: così il suo
 * CSS e il suo WebGL non toccano il resto del CRM.
 */
export default function UfficioPage() {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await createClient().auth.getSession()
        const response = await fetch('/api/ufficio/scena', {
          headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
          cache: 'no-store',
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Impossibile aprire l’ufficio')
        }
        const text = await response.text()
        if (!cancelled) setHtml(text)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Impossibile aprire l’ufficio')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <div className="inline-error" style={{ margin: 16 }}>{error}</div>
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', background: '#0a0f24' }}>
      {html ? (
        <iframe title="Ufficio Speaqi" srcDoc={html} style={{ flex: 1, border: 0, width: '100%', height: '100%' }} allow="fullscreen" />
      ) : (
        <p style={{ margin: 'auto', color: '#a3acc8', fontSize: 13 }}>Apro l’ufficio…</p>
      )}
    </div>
  )
}
