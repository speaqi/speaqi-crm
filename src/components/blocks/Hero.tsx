'use client'

interface HeroProps {
  title: string
  excerpt?: string
  cover_image?: string
  client?: string
  year?: number
}

export function Hero({ title, excerpt, cover_image, client, year }: HeroProps) {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      marginBottom: 28,
      background: 'var(--surface)',
      boxShadow: 'var(--shadow-md)',
    }}>
      {cover_image && (
        <div style={{
          width: '100%',
          height: 320,
          backgroundImage: `url(${cover_image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.6) 100%)',
          }} />
        </div>
      )}
      <div style={{
        padding: cover_image ? '28px 32px 28px' : '32px 32px 28px',
        marginTop: cover_image ? -80 : 0,
        position: 'relative',
        zIndex: 1,
      }}>
        <h1 style={{
          fontSize: 28,
          fontWeight: 800,
          lineHeight: 1.2,
          color: cover_image ? 'white' : 'var(--text)',
          marginBottom: excerpt ? 10 : 0,
          textShadow: cover_image ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
        }}>
          {title}
        </h1>
        {excerpt && (
          <p style={{
            fontSize: 16,
            color: cover_image ? 'rgba(255,255,255,0.85)' : 'var(--text2)',
            lineHeight: 1.6,
            marginBottom: (client || year) ? 16 : 0,
            textShadow: cover_image ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
          }}>
            {excerpt}
          </p>
        )}
        {(client || year) && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: excerpt ? 0 : 12 }}>
            {client && (
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--accent)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: 20,
              }}>
                👤 {client}
              </span>
            )}
            {year && (
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--surface2)',
                color: 'var(--text2)',
                padding: '4px 12px',
                borderRadius: 20,
                border: '1px solid var(--border)',
              }}>
                📅 {year}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
