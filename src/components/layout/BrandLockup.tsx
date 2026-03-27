'use client'

type BrandLockupProps = {
  subtitle?: string
  tone?: 'dark' | 'light'
  size?: 'sidebar' | 'hero'
  centered?: boolean
}

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
      <div className="brand-logo-shell" aria-hidden="true">
        <div className="brand-mark" />
      </div>
      <div className="brand-copy">
        <div className="brand-title-row">
          <span className="brand-title-accent">CRM</span>
        </div>
        {subtitle ? <div className="brand-subtitle">{subtitle}</div> : null}
      </div>
    </div>
  )
}
