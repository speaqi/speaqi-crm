'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import '../guides.css'

function TimeDisplay() {
  const [time, setTime] = React.useState<string>('--:--')

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      const napoliTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Europe/Rome' })
      )
      const hours = String(napoliTime.getHours()).padStart(2, '0')
      const minutes = String(napoliTime.getMinutes()).padStart(2, '0')
      setTime(`${hours}:${minutes}`)
    }

    updateTime()
    const interval = setInterval(updateTime, 60000)
    return () => clearInterval(interval)
  }, [])

  return <span>{time}</span>
}

function CitySelector() {
  const pathname = usePathname()
  const isNapoli = pathname.includes('/napoli')
  const isRoma = pathname.includes('/roma')

  return (
    <nav className="city-nav">
      <Link
        href="/guides/napoli"
        className={`city-link ${isNapoli ? 'active' : ''}`}
      >
        <span className="city-dot active"></span>
        Napoli
      </Link>
      <Link
        href="/guides/roma"
        className={`city-link coming-soon ${isRoma ? 'active' : ''}`}
      >
        <span className="city-dot"></span>
        Roma
        <span className="badge-soon">Coming Soon</span>
      </Link>
    </nav>
  )
}

import React from 'react'

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="guides-layout">
      <header className="guides-header">
        <div className="guides-header-top">
          <span className="guides-branding">Speaqi Guides</span>
          <div className="cities-status">
            <div className="city-item">
              <div className="city-dot-live"></div>
              <span>Napoli</span>
              <TimeDisplay />
            </div>
            <div className="city-item coming-soon">
              <div className="city-dot-live"></div>
              <span>Roma</span>
              <span style={{ fontSize: '10px' }}>Coming soon</span>
            </div>
          </div>
        </div>

        <div className="guides-header-nav">
          <Link href="/guides" className="guides-logo">
            <span className="logo-icon">📹</span>
            <span>Guides</span>
          </Link>
          <CitySelector />
          <button className="btn-cta-header">Accedi</button>
        </div>
      </header>

      <main className="guides-main">{children}</main>
    </div>
  )
}
