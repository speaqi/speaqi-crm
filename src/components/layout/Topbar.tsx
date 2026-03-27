'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '🏠 Dashboard',
  '/kanban': '🗂 Pipeline',
  '/contacts': '👥 Contatti',
  '/import': '📥 Import CSV',
  '/attivita': '⚙️ Attività & Follow-up',
  '/calendario': '📅 Calendario',
  '/speaqi': '⚡ Lead Speaqi',
  '/voice': '🎤 Note Vocali',
}

export function Topbar({ pathname }: { pathname: string }) {
  const router = useRouter()
  const title = PAGE_TITLES[pathname] || 'SPEAQI CRM'

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
