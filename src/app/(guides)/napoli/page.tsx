import Link from 'next/link'
import { getGuidesByCity } from '@/lib/guides-data'

export const metadata = {
  title: 'Speaqi Guides — Napoli',
  description: 'Videomappe e audiomappe per il team di Napoli',
}

export default function NapoliPage() {
  const guides = getGuidesByCity('napoli')
  const categories = Array.from(new Set(guides.map((g) => g.category)))

  return (
    <div className="guides-container guides-page">
      <div className="guides-hero">
        <div className="guides-hero-kicker">Napoli</div>
        <h1>Guide per il tuo team</h1>
        <p>
          Videomappe e audiomappe che accelerano l'onboarding e mantengono il
          team sempre aggiornato.
        </p>
      </div>

      {categories.map((category) => {
        const categoryGuides = guides.filter((g) => g.category === category)
        return (
          <div key={category} style={{ marginBottom: '56px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '24px',
                paddingBottom: '12px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <h2
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                {category}
              </h2>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  background: 'var(--accent-light)',
                  color: 'var(--accent)',
                  padding: '4px 10px',
                  borderRadius: '999px',
                }}
              >
                {categoryGuides.length}
              </span>
            </div>

            <div className="guides-grid">
              {categoryGuides.map((guide) => (
                <Link
                  key={guide.id}
                  href={`/guides/napoli/${guide.id}`}
                  className="guide-card"
                >
                  <div className="guide-card-thumb">{guide.icon}</div>
                  <div className="guide-card-content">
                    <div className="guide-card-type">
                      {guide.type === 'both'
                        ? '📹 + 🎧'
                        : guide.type === 'videomap'
                          ? '📹'
                          : '🎧'}
                    </div>
                    <h3 className="guide-card-title">{guide.title}</h3>
                    <p className="guide-card-desc">{guide.description}</p>
                    <div className="guide-card-meta">
                      <div className="guide-card-duration">
                        <span>⏱️</span>
                        <span>{guide.duration} min</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
