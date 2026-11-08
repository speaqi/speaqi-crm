'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCRMContext } from '@/components/layout/CRMContext'

/** Le due schede dell'area Marketing: la coda delle email e le idee per le guide. */
export function MarketingNav() {
  const pathname = usePathname()
  const { isAdmin } = useCRMContext()
  const onIdeas = pathname.startsWith('/marketing/idee')

  return (
    <nav className="marketing-switch" aria-label="Area Marketing">
      <Link href="/marketing" className={onIdeas ? '' : 'active'} aria-current={onIdeas ? undefined : 'page'}>
        ✉️ Coda email
      </Link>
      {/* Le idee sono un piano interno: solo il titolare (il resto lo blocca il layout e l'API). */}
      {isAdmin && (
        <Link href="/marketing/idee" className={onIdeas ? 'active' : ''} aria-current={onIdeas ? 'page' : undefined}>
          💡 Idee per le guide
        </Link>
      )}
    </nav>
  )
}
