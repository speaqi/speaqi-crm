'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '🏠 Dashboard',
  '/kanban': '🗂 Pipeline',
  '/quick-capture': '⚡ Quick Capture',
  '/contacts': '👥 Contatti',
  '/gmail': '✉️ Gmail',
  '/import': '📥 Import CSV',
  '/attivita': '⚙️ Attività & Follow-up',
  '/calendario': '📅 Calendario',
  '/vinitaly': '🍷 Vinitaly',
  '/speaqi': '⚡ Lead Inbound',
  '/voice': '🎤 Note Vocali',
}

export function Topbar({ pathname }: { pathname: string }) {
  const router = useRouter()
  const title = PAGE_TITLES[pathname] || 'CRM'

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">
        <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Esci">
          🚪 Esci
        </button>
      </div>
    </div>
  )
}
