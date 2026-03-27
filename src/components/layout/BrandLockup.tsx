'use client'

type BrandLockupProps = {
  subtitle?: string
  tone?: 'dark' | 'light'
  size?: 'sidebar' | 'hero'
  centered?: boolean
}

const LOGO_URL = 'https://speaqi.com/logo_speaqi_white.png'

export function BrandLockup({
  subtitle,
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
        <img className="brand-logo-image" src={LOGO_URL} alt="SPEAQI" />
      </div>
      <div className="brand-copy">
        <div className="brand-title-row">
          <span className="brand-title">SPEAQI</span>
          <span className="brand-title-accent">CRM</span>
        </div>
        {subtitle ? <div className="brand-subtitle">{subtitle}</div> : null}
      </div>
    </div>
  )
}
