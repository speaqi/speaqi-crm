import Link from 'next/link'

export const metadata = {
  title: 'Speaqi Guides — Roma (Coming Soon)',
  description: 'Guide per il team di Roma - Disponibile a breve',
}

export default function RomaPage() {
  return (
    <div className="guides-container guides-page">
      <div className="coming-soon-hero">
        <div className="coming-soon-icon">🚀</div>
        <h1 className="coming-soon-title">Guides Roma — Coming Soon</h1>
        <p className="coming-soon-subtitle">
          Stiamo preparando una raccolta di guide specifiche per il team di Roma.
          Tutte le videomappe e audiomappe saranno disponibili a breve.
        </p>
        <Link
          href="/guides/napoli"
          className="coming-soon-cta"
        >
          Guarda le guide di Napoli
        </Link>
      </div>
    </div>
  )
}
