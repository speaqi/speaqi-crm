import Link from 'next/link'
import { VIDEO_MAP_CONTRACT_FILE, VIDEO_MAP_GENERAL_TERMS } from '@/lib/video-map-contract'

export const metadata = { title: 'Contratto Video nella mappa — Speaqi', robots: { index: false, follow: false } }

export default function VideoMapTermsPage() {
  return <main className="public-quote-page"><section className="public-quote-shell termini-speaqi-shell">
    <header className="public-quote-header"><h1>Contratto di servizio “Video nella mappa”</h1></header>
    <p><Link href={VIDEO_MAP_CONTRACT_FILE} download>Scarica il documento integrale</Link></p>
    <div className="public-quote-card public-quote-contract-body termini-speaqi-body" style={{ whiteSpace: 'pre-wrap' }}>{VIDEO_MAP_GENERAL_TERMS}</div>
  </section></main>
}
