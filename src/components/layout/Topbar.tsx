'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '🏠 Oggi',
  '/contacts': '👥 Contatti',
  '/marketing': '✉️ Marketing',
  '/personali': '🗂️ Personali',
  '/kanban': '🔀 Pipeline',
  '/preventivi': '💶 Preventivi',
  '/import': '📥 Importa',
  '/impostazioni': '⚙️ Impostazioni',
  '/impostazioni/team': '👥 Team',
  '/quick-capture': '⚡ Cattura rapida',
  '/gmail': '✉️ Gmail',
  '/attivita': '⚙️ Attività & Follow-up',
  '/calendario': '📅 Calendario',
  '/vinitaly': '🗃️ Vinitaly (legacy)',
  '/speaqi': '⚡ Lead inbound (legacy)',
  '/voice': '🎤 Note vocali',
}

export function Topbar({
  pathname,
  authEmail = null,
  isAdmin = true,
  viewerMemberName = null,
  loading = false,
}: {
  pathname: string
  authEmail?: string | null
  isAdmin?: boolean
  viewerMemberName?: string | null
  loading?: boolean
}) {
  const router = useRouter()
  const title = PAGE_TITLES[pathname] || 'CRM'

  const userLabel = !authEmail
    ? null
    : isAdmin
      ? viewerMemberName
        ? `${viewerMemberName} · admin`
        : `${authEmail} · admin`
      : viewerMemberName
        ? `${viewerMemberName} · collaboratore`
        : `${authEmail} · collaboratore`

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="topbar">
      <div className="topbar-title">{title}</div>
      {!loading && userLabel && (
        <div className="topbar-user" title={authEmail || undefined}>
          <span className="topbar-user-icon" aria-hidden>
            {isAdmin ? '●' : '◆'}
          </span>
          <span className="topbar-user-text">{userLabel}</span>
        </div>
      )}
      <div className="topbar-actions">
        <Link
          href="/contacts?new=1"
          className="btn btn-primary btn-sm"
          title="Aggiungi un contatto rapidamente"
        >
          ＋ Nuovo
        </Link>
        <Link href="/import" className="btn btn-ghost btn-sm" title="Importa CSV">
          📥 Importa
        </Link>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout} title="Esci">
          🚪 Esci
        </button>
      </div>
    </div>
  )
}
