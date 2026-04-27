'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { createClient } from '@/lib/supabase'

export default function LandingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        router.replace('/dashboard')
      } else {
        setChecking(false)
      }
    })
  }, [router])

  if (checking) {
    return (
      <div className="loading-screen">
        <BrandLockup tone="dark" size="hero" centered />
        <div className="loading-text">Caricamento…</div>
      </div>
    )
  }

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <BrandLockup tone="light" size="hero" />
        <div className="landing-nav-links">
          <a href="/signup" className="landing-nav-btn-ghost">Registrati</a>
          <a href="/login" className="landing-nav-btn">Accedi</a>
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <p className="landing-kicker">AI Multilingual Video</p>
          <h1>Il tuo vino parla tutte le lingue.</h1>
          <p className="landing-sub">
            Da un singolo video sorgente, crea contenuti in 7+ lingue con lip-sync AI.
            QR code, analytics, e gestione clienti — tutto in un unico CRM.
          </p>
          <div className="landing-cta-row">
            <a href="#pricing" className="landing-cta-primary">Vedi i piani</a>
            <a href="/login" className="landing-cta-secondary">Accedi</a>
          </div>
        </div>
        <div className="landing-hero-visual">
          <div className="landing-hero-card">
            <div className="landing-hero-card-icon">🎬</div>
            <div className="landing-hero-card-text">
              <strong>Video originale</strong>
              <span>Italiano</span>
            </div>
            <div className="landing-hero-arrow">→</div>
            <div className="landing-hero-card-icon">🌍</div>
            <div className="landing-hero-card-text">
              <strong>7+ lingue</strong>
              <span>EN, FR, DE, ES, ZH, JA +</span>
            </div>
          </div>
        </div>
      </section>

      <section id="benefici" className="landing-benefits">
        <div className="landing-benefit-card">
          <div className="landing-benefit-icon">🎯</div>
          <h3>Lip-Sync AI</h3>
          <p>Motion e labbra sincronizzate in ogni lingua. Non un semplice doppiaggio — il video sembra girato nella lingua di destinazione.</p>
        </div>
        <div className="landing-benefit-card">
          <div className="landing-benefit-icon">📱</div>
          <h3>QR Code per ogni video</h3>
          <p>Ogni versione linguistica ha il suo QR code. Stampa sul packaging, inserisci nel menu digitale o in etichetta.</p>
        </div>
        <div className="landing-benefit-card">
          <div className="landing-benefit-icon">📊</div>
          <h3>Analytics in tempo reale</h3>
          <p>Tracci visualizzazioni, paesi di provenienza e coinvolgimento per ogni video. Sai qual è il mercato più reattivo.</p>
        </div>
      </section>

      <section className="landing-features">
        <div className="landing-features-inner">
          <h2>Tutto quello che serve per vendere all'estero</h2>
          <p className="landing-features-sub">CRM + AI Multilingual Video in un unico strumento.</p>
          <div className="landing-features-grid">
            <div className="landing-feature-card">
              <span className="landing-feature-icon">📧</span>
              <h3>Gmail integrato</h3>
              <p>Sincronizza thread, traccia aperture, scrivi bozze con AI. Tutto senza uscire dal CRM.</p>
            </div>
            <div className="landing-feature-card">
              <span className="landing-feature-icon">🎤</span>
              <h3>Comandi vocali</h3>
              <p>Registra promemoria e aggiornamenti a voce. L'AI trascrive e crea task automaticamente.</p>
            </div>
            <div className="landing-feature-card">
              <span className="landing-feature-icon">📊</span>
              <h3>Pipeline visuale</h3>
              <p>Kanban drag-and-drop, calendario settimanale, coda chiamate. Tutta la pipeline in un colpo d'occhio.</p>
            </div>
            <div className="landing-feature-card">
              <span className="landing-feature-icon">🤖</span>
              <h3>AI integrata</h3>
              <p>Lead scoring, classificazione automatica, memoria sintetica per ogni contatto e suggerimenti next-action.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="landing-pricing">
        <div className="landing-pricing-inner">
          <h2>Piani pensati per le cantine</h2>
          <p className="landing-pricing-sub">Da €349 — nessun vincolo, nessun canone nascosto.</p>
          <div className="landing-pricing-grid">
            <div className="landing-pricing-card">
              <div className="landing-pricing-name">START</div>
              <div className="landing-pricing-price">€349</div>
              <div className="landing-pricing-was">€699</div>
              <ul>
                <li>1 video multilingual</li>
                <li>Fino a 7 lingue</li>
                <li>QR code dedicato</li>
                <li>12 mesi accesso</li>
              </ul>
            </div>
            <div className="landing-pricing-card landing-pricing-featured">
              <div className="landing-pricing-name">EXPERIENCE</div>
              <div className="landing-pricing-price">€699</div>
              <div className="landing-pricing-was">€1.099</div>
              <ul>
                <li>3 video multilingual</li>
                <li>Fino a 7 lingue ciascuno</li>
                <li>QR code + analytics</li>
                <li>Supporto prioritario</li>
              </ul>
            </div>
            <div className="landing-pricing-card">
              <div className="landing-pricing-name">SIGNATURE</div>
              <div className="landing-pricing-price">€999</div>
              <div className="landing-pricing-was">€1.999</div>
              <ul>
                <li>6 video multilingual</li>
                <li>Fino a 7 lingue ciascuno</li>
                <li>Analytics avanzati</li>
                <li>Dedicated account manager</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta-section">
        <h2>Pronto a portare il tuo vino nel mondo?</h2>
        <p>Contatta il team Speaqi per un preventivo personalizzato per la tua cantina.</p>
        <a href="mailto:speaqi@thebestitaly.it" className="landing-cta-primary">Contattaci</a>
      </section>

      <footer className="landing-footer">
        Speaqi di TheBestItaly · P.IVA: 10831191217 · C.F.: 95125440636
      </footer>
    </div>
  )
}
