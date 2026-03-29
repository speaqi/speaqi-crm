'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'

interface SidebarProps {
  counts: {
    kanban: number
    contacts: number
    speaqi: number
    oggi: number
    tasks: number
  }
  isRecording?: boolean
  onQuickRecord?: () => void
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠', section: 'Principale' },
  { href: '/kanban', label: 'Pipeline', icon: '🗂', badgeKey: 'kanban' as const },
  { href: '/contacts', label: 'Contatti', icon: '👥', section: 'CRM', badgeKey: 'contacts' as const },
  { href: '/gmail', label: 'Gmail', icon: '✉️' },
  { href: '/import', label: 'Import CSV', icon: '📥' },
  { href: '/attivita', label: 'Attività & Follow-up', icon: '⚙️', badgeKey: 'tasks' as const },
  { href: '/calendario', label: 'Calendario', icon: '📅', badgeKey: 'oggi' as const, badgeRed: true },
  { href: '/speaqi', label: 'Lead Inbound', icon: '⚡', section: 'Origini', badgeKey: 'speaqi' as const },
  { href: '/voice', label: 'Note Vocali', icon: '🎤' },
]

export function Sidebar({ counts, isRecording = false, onQuickRecord }: SidebarProps) {
  const pathname = usePathname()
  let currentSection: string | null = null

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <BrandLockup subtitle="relational" tone="dark" size="sidebar" />
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => {
          const showSection = item.section && item.section !== currentSection
          if (showSection) currentSection = item.section

          const badgeCount = item.badgeKey ? counts[item.badgeKey] : null

          return (
            <div key={item.href}>
              {showSection && <div className="nav-section">{item.section}</div>}
              <Link href={item.href} className={`nav-item ${pathname === item.href ? 'active' : ''}`}>
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
