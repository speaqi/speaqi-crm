'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'

interface SidebarProps {
  counts: {
    kanban: number
    contacts: number
    personal: number
    partner: number
    vinitaly: number
    speaqi: number
    marketing: number
    oggi: number
    tasks: number
  }
}

// Menu ridotto al core loop quotidiano. Le altre pagine (progetti, finanza,
// marketing, acumbamail, email, voice, ...) restano raggiungibili via URL:
// partner e personali vivono come tab dentro /contacts.
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Oggi', icon: '🏠', badgeKey: 'oggi' as const, badgeRed: true },
  { href: '/kanban', label: 'Pipeline', icon: '🔀', badgeKey: 'kanban' as const },
  { href: '/contacts', label: 'Contatti', icon: '👥', badgeKey: 'contacts' as const },
  { href: '/calendario', label: 'Follow-up', icon: '📅', badgeKey: 'tasks' as const, badgeRed: true },
  { href: '/preventivi', label: 'Preventivi', icon: '💶' },
  { href: '/attivita', label: 'Analytics', icon: '📊' },
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

      <div className="sidebar-footer">
        <Link href="/import" className="nav-item sidebar-footer-item">
          <span className="icon">📥</span>
          Importa
        </Link>
      </div>
    </aside>
  )
}
