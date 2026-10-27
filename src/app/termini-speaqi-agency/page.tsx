import Link from 'next/link'
import { AGENCY_GENERAL_TERMS } from '@/lib/agency-contract'

export default function AgencyTermsPage() {
  return <main className="public-quote-page"><section className="public-quote-shell termini-speaqi-shell">
    <header className="public-quote-header"><h1>Condizioni generali Speaqi Agency</h1></header>
    <p><Link href="/contratti/SPEAQI-AGENCY-CGC-v1.0.txt" download>Scarica il documento integrale</Link></p>
    <div className="public-quote-card public-quote-contract-body termini-speaqi-body" style={{ whiteSpace: 'pre-wrap' }}>{AGENCY_GENERAL_TERMS}</div>
  </section></main>
}
