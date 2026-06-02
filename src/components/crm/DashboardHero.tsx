'use client'

interface Props {
  overdueCount: number
  todayCount: number
  hotCount: number
  briefing?: string | null
}

function greetingForHour(hour: number) {
  if (hour < 6) return 'Buonanotte'
  if (hour < 13) return 'Buongiorno'
  if (hour < 19) return 'Buon pomeriggio'
  return 'Buonasera'
}

function formatItalianDate(date: Date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function DashboardHero({ overdueCount, todayCount, hotCount, briefing }: Props) {
  const now = new Date()
  const greeting = greetingForHour(now.getHours())
  const dayLabel = formatItalianDate(now)

  return (
    <header className="oggi-hero">
      <div>
        <h1>{greeting}.</h1>
        <p className="oggi-date">{dayLabel}</p>
        {briefing && (
          <p className="oggi-briefing">{briefing}</p>
        )}
      </div>
      <div className="oggi-hero-stats">
        <div className="oggi-stat" style={{ color: '#ef4444' }}>
          <strong>{overdueCount}</strong>
          <span>scaduti</span>
        </div>
        <div className="oggi-stat">
          <strong>{todayCount}</strong>
          <span>oggi</span>
        </div>
        <div className="oggi-stat" style={{ color: '#f59e0b' }}>
          <strong>{hotCount}</strong>
          <span>lead caldi</span>
        </div>
      </div>
      <div className="oggi-hero-actions">
        <a href="/contacts?new=1" className="btn btn-primary">
          + Nuovo contatto
        </a>
        <a href="/import" className="btn btn-ghost">
          📥 Importa CSV
        </a>
      </div>
    </header>
  )
}
