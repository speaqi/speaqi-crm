'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SidebarProps {
  counts: {
    kanban: number
    contacts: number
    speaqi: number
    oggi: number
  }
  isRecording?: boolean
  onQuickRecord?: () => void
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', section: 'Principale' },
  { href: '/kanban', label: 'Kanban', icon: '🗂', section: null, badgeKey: 'kanban' },
  { href: '/contacts', label: 'Tutti i Contatti', icon: '👥', section: 'Contatti', badgeKey: 'contacts' },
  { href: '/speaqi', label: 'Rete SPEAQI', icon: '⚡', section: null, badgeKey: 'speaqi' },
  { href: '/projects', label: 'Progetti', icon: '📁', section: 'Contenuti' },
  { href: '/news', label: 'News', icon: '📰', section: null },
  { href: '/calendario', label: 'Calendario Chiamate', icon: '📅', section: 'Strumenti', badgeKey: 'oggi', badgeRed: true },
  { href: '/voice', label: 'Note Vocali', icon: '🎤', section: null },
]

export function Sidebar({ counts, isRecording = false, onQuickRecord }: SidebarProps) {
  const pathname = usePathname()

  let currentSection: string | null = null

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">⚡</div>
        <div>
          <div className="logo-text">SPEAQI CRM</div>
          <div className="logo-sub">v2.0</div>
        </div>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => {
          const showSection = item.section && item.section !== currentSection
          if (showSection) currentSection = item.section

          const isActive = pathname === item.href
          const badgeCount = item.badgeKey ? counts[item.badgeKey as keyof typeof counts] : null

          return (
            <div key={item.href}>
              {showSection && (
                <div className="nav-section">{item.section}</div>
              )}
              <Link
                href={item.href}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="icon">{item.icon}</span>
                {item.label}
                {badgeCount !== null && badgeCount !== undefined && (
                  <span
                    className="badge"
                    style={item.badgeRed && badgeCount > 0 ? { background: '#ef4444' } : undefined}
                  >
                    {badgeCount}
                  </span>
                )}
              </Link>
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          className={`btn-voice-sidebar ${isRecording ? 'recording' : ''}`}
          onClick={onQuickRecord}
        >
          <span>{isRecording ? '⏹' : '🎙'}</span>
          <span>{isRecording ? 'Stop Registrazione' : 'Registra Nota'}</span>
        </button>
      </div>
    </aside>
  )
}
