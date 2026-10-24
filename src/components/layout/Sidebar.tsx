'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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

// Menu a gruppi, dall'uso quotidiano a quello occasionale:
// - Lavoro: il core loop della giornata. "To Do" sta subito dopo "Oggi" perché
//   è la lista che si guarda per prima la mattina.
// - Vendite: preventivi, progetti commerciali (Wine Project, Hospitality e i
//   verticali che verranno stanno tutti dentro "Commerciale") e numeri.
// - Strumenti: pagine che si aprono ogni tanto.
// - Solo admin: le aree del proprietario (SUPER_ADMIN_PATHS). Si vede solo con
//   isAdmin, così un collaboratore non trova nemmeno l'intestazione.
// Speaqi Agency non sta nel gruppo: ha un pulsante tutto suo in testa, solo per
// l'admin (stesso controllo di SUPER_ADMIN_PATHS e di requireAgencyOwner). Le altre pagine (progetti, finanza,
// marketing, email, voice, ...) restano raggiungibili via URL.
type NavItem = {
  href: string
  label: string
  icon: string
  badgeKey?: keyof SidebarProps['counts']
  badgeRed?: boolean
}

const NAV_GROUPS: { label: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    label: 'Lavoro',
    items: [
      { href: '/dashboard', label: 'Oggi', icon: '🏠', badgeKey: 'oggi', badgeRed: true },
      { href: '/todo', label: 'To Do', icon: '✅', badgeKey: 'todo', badgeRed: true },
      { href: '/tourism-lavoro', label: 'Turismo · Il mio lavoro', icon: '◎' },
      { href: '/kanban', label: 'Pipeline', icon: '🔀', badgeKey: 'kanban' },
      { href: '/contacts', label: 'Contatti', icon: '👥', badgeKey: 'contacts' },
      { href: '/calendario', label: 'Follow-up', icon: '📅', badgeKey: 'tasks', badgeRed: true },
    ],
  },
  {
    label: 'Vendite',
    items: [
      { href: '/preventivi', label: 'Preventivi', icon: '💶' },
      { href: '/commerciale', label: 'Commerciale', icon: '📣' },
      { href: '/attivita', label: 'Analytics', icon: '📊' },
    ],
  },
  {
    label: 'Strumenti',
    items: [
      { href: '/navigazione', label: 'Navigazione', icon: '🚢' },
      { href: '/import', label: 'Importa', icon: '📥' },
    ],
  },
  {
    label: 'Solo admin',
    adminOnly: true,
    items: [
      { href: '/tourism', label: 'Tourism Intelligence', icon: '◎' },
      { href: '/acumbamail', label: 'Acumbamail', icon: '📧' },
      { href: '/ufficio', label: 'Ufficio', icon: '🏛️' },
      { href: '/fatture', label: 'Fatture e incassi', icon: '🧾' },
    ],
  },
]

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`))

export function Sidebar({ counts, allowedAreas, isAdmin }: SidebarProps) {
  const pathname = usePathname()
  const visible = (href: string) => canAccessPath(href, allowedAreas, isAdmin)

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <BrandLockup subtitle="relational" tone="dark" size="sidebar" />
      </div>

      {isAdmin && (
        <div className="sidebar-cta">
          <Link
            href="/agency"
            className={`sidebar-cta-button ${isActive(pathname, '/agency') ? 'active' : ''}`}
          >
            <span className="icon">✦</span>
            Speaqi Agency
          </Link>
        </div>
      )}

      <nav className="nav">
        {NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin).map((group) => {
          const items = group.items.filter((item) => visible(item.href))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="nav-group">
              <div className="nav-section">{group.label}</div>
              {items.map((item) => {
                const badgeCount = item.badgeKey ? counts[item.badgeKey] : null
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item ${isActive(pathname, item.href) ? 'active' : ''}`}
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
                )
              })}
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
    </aside>
  )
}
