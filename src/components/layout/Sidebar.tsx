'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'

interface SidebarProps {
  counts: {
    kanban: number
    contacts: number
    personal: number
    vinitaly: number
    speaqi: number
    marketing: number
    oggi: number
    tasks: number
  }
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Oggi', icon: '🏠', badgeKey: 'oggi' as const, badgeRed: true },
  { href: '/contacts', label: 'Contatti', icon: '👥', badgeKey: 'contacts' as const },
  { href: '/marketing', label: 'Marketing', icon: '✉️', badgeKey: 'marketing' as const },
  { href: '/personali', label: 'Personali', icon: '🗂️', badgeKey: 'personal' as const },
  { href: '/kanban', label: 'Pipeline', icon: '🔀', badgeKey: 'kanban' as const },
  { href: '/preventivi', label: 'Preventivi', icon: '💶' },
  { href: '/calendario', label: 'Calendario', icon: '📅' },
  { href: '/attivita', label: 'Attività', icon: '📊' },
  { href: '/import', label: 'Importa', icon: '📥' },
  { href: '/impostazioni', label: 'Impostazioni', icon: '⚙️' },
]

export function Sidebar({ counts }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <BrandLockup subtitle="relational" tone="dark" size="sidebar" />
      </div>

      <nav className="nav">
        {NAV_ITEMS.map((item) => {
          const badgeCount = 'badgeKey' in item && item.badgeKey ? counts[item.badgeKey] : null
          const badgeRed = 'badgeRed' in item ? item.badgeRed : false

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href ? 'active' : ''}`}
            >
              <span className="icon">{item.icon}</span>
              {item.label}
              {badgeCount !== null && badgeCount !== undefined && (
                <span
                  className="badge"
                  style={badgeRed && badgeCount > 0 ? { background: '#ef4444' } : undefined}
                >
                  {badgeCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
