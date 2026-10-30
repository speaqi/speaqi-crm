'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { canAccessPath, type AreaKey } from '@/lib/areas'

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
    todo: number
    tasks: number
  }
  allowedAreas: AreaKey[] | null
  isAdmin: boolean
}

type NavItem = {
  href: string
  label: string
  icon: string
  badgeKey?: keyof SidebarProps['counts']
  badgeRed?: boolean
}

const NAV_GROUPS: { label: string; icon: string; items: NavItem[] }[] = [
  {
    label: 'Lavoro', icon: '🏠',
    items: [
      { href: '/dashboard', label: 'Oggi', icon: '🏠', badgeKey: 'oggi', badgeRed: true },
      { href: '/todo', label: 'To Do', icon: '✅', badgeKey: 'todo', badgeRed: true },
      { href: '/calendario', label: 'Follow-up', icon: '📅', badgeKey: 'tasks', badgeRed: true },
      { href: '/tourism-lavoro', label: 'Turismo · Il mio lavoro', icon: '◎' },
    ],
  },
  {
    label: 'Contatti', icon: '👥',
    items: [
      { href: '/contacts', label: 'Tutti i contatti', icon: '👥', badgeKey: 'contacts' },
      { href: '/import', label: 'Importa', icon: '📥' },
    ],
  },
  {
    label: 'Vendite', icon: '📈',
    items: [
      { href: '/kanban', label: 'Pipeline', icon: '🔀', badgeKey: 'kanban' },
      { href: '/preventivi', label: 'Preventivi', icon: '💶' },
      { href: '/commerciale', label: 'Commerciale', icon: '📣' },
      { href: '/attivita', label: 'Analytics', icon: '📊' },
      { href: '/fatture', label: 'Fatture e incassi', icon: '🧾' },
    ],
  },
  {
    label: 'Strumenti', icon: '🧰',
    items: [
      { href: '/navigazione', label: 'Navigazione', icon: '🚢' },
      { href: '/acumbamail', label: 'Acumbamail', icon: '📧' },
      { href: '/ufficio', label: 'Ufficio', icon: '🏛️' },
    ],
  },
]

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`))

export function Sidebar({ counts, allowedAreas, isAdmin }: SidebarProps) {
  const pathname = usePathname()
  const visible = (href: string) => canAccessPath(href, allowedAreas, isAdmin)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => isActive(pathname, item.href)))
    setOpenGroup(activeGroup && !(isAdmin && isActive(pathname, '/navigazione')) ? activeGroup.label : null)
  }, [pathname, isAdmin])

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <BrandLockup subtitle="relational" tone="dark" size="sidebar" />
      </div>

      <nav className="nav">
        {visible('/tourism') && (
          <Link href="/tourism" className={`nav-item ${isActive(pathname, '/tourism') || isActive(pathname, '/navigazione') ? 'active' : ''}`}>
            <span className="icon">◎</span>
            Tourism Intelligence
          </Link>
        )}
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => visible(item.href) && !(isAdmin && item.href === '/navigazione'))
          if (items.length === 0) return null
          const open = openGroup === group.label
          const active = items.some((item) => isActive(pathname, item.href))
          return (
            <div key={group.label} className="nav-group">
              <button
                type="button"
                className={`nav-item nav-group-toggle ${active ? 'has-active' : ''}`}
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : group.label)}
              >
                <span className="icon">{group.icon}</span>
                {group.label}
                <span className="nav-group-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
              </button>
              {open && <div className="nav-group-items">
                {items.map((item) => {
                  const badgeCount = item.badgeKey ? counts[item.badgeKey] : null
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-item nav-item-nested ${isActive(pathname, item.href) ? 'active' : ''}`}
                    >
                      <span className="icon">{item.icon}</span>
                      {item.label}
                      {badgeCount !== null && badgeCount !== undefined && (
                        <span className="badge" style={item.badgeRed && badgeCount > 0 ? { background: '#ef4444' } : undefined}>
                          {badgeCount}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>}
            </div>
          )
        })}
      </nav>

      {visible('/impostazioni') && (
        <div className="sidebar-footer sidebar-settings">
          <Link
            href="/impostazioni"
            className={`nav-item ${isActive(pathname, '/impostazioni') ? 'active' : ''}`}
          >
            <span className="icon">⚙️</span>
            Impostazioni
          </Link>
        </div>
      )}
      {isAdmin && (
        <div className="sidebar-cta">
          <Link href="/agency" className={`sidebar-cta-button ${isActive(pathname, '/agency') ? 'active' : ''}`}>
            <span className="icon">✦</span>
            Speaqi Agency
          </Link>
        </div>
      )}
    </aside>
  )
}
