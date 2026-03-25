'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '🏠 Dashboard',
  '/kanban': '🗂 Kanban Board',
  '/contacts': '👥 Tutti i Contatti',
  '/speaqi': '⚡ Rete SPEAQI',
  '/calendario': '📅 Calendario Chiamate',
  '/voice': '🎤 Note Vocali',
}

interface TopbarProps {
  pathname: string
  onNewCard?: () => void
  onExportCSV?: () => void
}

export function Topbar({ pathname, onNewCard, onExportCSV }: TopbarProps) {
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
        {onExportCSV && (
          <button className="btn btn-ghost btn-sm" onClick={onExportCSV}>
            📥 Esporta CSV
          </button>
        )}
        {onNewCard && (
          <button className="btn btn-primary btn-sm" onClick={onNewCard}>
            ＋ Nuova Card
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleLogout}
          title="Esci"
          style={{ marginLeft: 4 }}
        >
          🚪
        </button>
      </div>
    </div>
  )
}
