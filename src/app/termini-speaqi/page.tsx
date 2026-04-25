import Link from 'next/link'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { DEFAULT_CONTRACT_TERMS } from '@/lib/quote-defaults'

export const metadata = {
  title: 'Termini di servizio – Speaqi',
  description: 'Termini di servizio SaaS Speaqi (The Best Italy).',
}

export default function TerminiSpeaqiPage() {
  return (
    <main className="public-quote-page">
      <section className="public-quote-shell termini-speaqi-shell">
        <header className="public-quote-header termini-speaqi-header">
          <BrandLockup tone="light" size="hero" />
          <Link href="/" className="termini-speaqi-back">
            ← Torna al sito
          </Link>
        </header>
        <div className="public-quote-card termini-speaqi-card">
          <div className="public-quote-contract-body termini-speaqi-body">{DEFAULT_CONTRACT_TERMS}</div>
        </div>
      </section>
    </main>
  )
}
