'use client'

type BrandLockupProps = {
  subtitle?: string
  /** Scritta accanto al logo; `null` la toglie (pagine pubbliche non legate al CRM). */
  title?: string | null
  tone?: 'dark' | 'light'
  size?: 'sidebar' | 'hero'
  centered?: boolean
}

const LOGO_URL = 'https://speaqi.com/logo_speaqi_white.png'

export function BrandLockup({
  subtitle,
  title = 'CRM',
  tone = 'dark',
  size = 'sidebar',
  centered = false,
}: BrandLockupProps) {
  const classes = [
    'brand-lockup',
    `brand-lockup-${tone}`,
    `brand-lockup-${size}`,
    centered ? 'brand-lockup-centered' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="brand-logo-shell">
        <img className="brand-logo-image" src={LOGO_URL} alt={title ? `Logo ${title}` : 'Speaqi'} />
      </div>
      {title || subtitle ? (
        <div className="brand-copy">
          {title ? (
            <div className="brand-title-row">
              <span className="brand-title-accent">{title}</span>
            </div>
          ) : null}
          {subtitle ? <div className="brand-subtitle">{subtitle}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
