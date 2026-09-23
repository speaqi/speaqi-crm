import type { Metadata } from 'next'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { SPEAQI_PACKAGES, SPEAQI_PACKAGE_KEYS } from '@/lib/speaqi-quote-packages'
import { resolveSalesLink } from '@/lib/server/sales-links'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { SalesQuoteForm, type SalesPackageOption } from './SalesQuoteForm'

export const dynamic = 'force-dynamic'

// Il token sta nel percorso: niente indicizzazione e niente referrer verso i siti esterni.
export const metadata: Metadata = {
  title: 'Nuovo abbonamento — Speaqi',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

type VenditaPageProps = {
  params: Promise<{ token: string }>
}

function InvalidLink() {
  return (
    <main className="public-quote-page">
      <section className="public-quote-shell public-quote-missing">
        <BrandLockup tone="light" size="hero" centered />
        <h1>Link non valido</h1>
        <p>Il link vendita non esiste più oppure è stato revocato. Chiedi un nuovo link all’amministratore.</p>
      </section>
    </main>
  )
}

/**
 * Area del commerciale, senza login: il link personale identifica chi vende.
 * Si compilano i dati dell'attivita' davanti al cliente e si passa subito
 * alla pagina di firma e pagamento.
 */
export default async function VenditaPage({ params }: VenditaPageProps) {
  const { token } = await params
  let memberName: string | null = null
  try {
    const link = await resolveSalesLink(createServiceRoleClient(), token)
    memberName = link?.member.name || null
  } catch {
    memberName = null
  }
  if (!memberName) return <InvalidLink />

  // Prima i pacchetti in abbonamento: e' quello che si vende sul campo.
  const packages: SalesPackageOption[] = [...SPEAQI_PACKAGE_KEYS]
    .sort((a, b) => Number(SPEAQI_PACKAGES[b].billing === 'yearly') - Number(SPEAQI_PACKAGES[a].billing === 'yearly'))
    .map((key) => {
      const p = SPEAQI_PACKAGES[key]
      return {
        key,
        label: p.label,
        subtitle: p.subtitle,
        unitPrice: p.unit_price,
        listUnitPrice: p.list_unit_price,
        yearly: p.billing === 'yearly',
      }
    })

  return (
    <main className="public-quote-page">
      <section className="public-quote-shell">
        <header className="public-quote-header">
          <BrandLockup tone="light" size="hero" />
          <div className="public-quote-number">
            <span>Venditore</span>
            <strong>{memberName}</strong>
          </div>
        </header>
        <div className="public-quote-hero">
          <div>
            <p className="public-quote-kicker">Nuovo cliente</p>
            <h1 className="public-quote-customer-title">Dati dell’attività</h1>
            <p className="public-quote-customer">
              Compila con il cliente: al passo successivo firma il contratto e paga con carta.
            </p>
          </div>
        </div>
        <section className="public-quote-card">
          <SalesQuoteForm token={token} packages={packages} />
        </section>
      </section>
    </main>
  )
}
