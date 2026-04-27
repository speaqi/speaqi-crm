'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <p className="login-brand-kicker">AI Multilingual Video</p>
        <h1 className="login-brand-title">
          Da un video sorgente a 7+ lingue con lip-sync AI.
        </h1>
        <p className="login-brand-sub">
          Gestisci contatti, preventivi e video multilingual per la tua cantina.
        </p>
      </div>

      <div className="login-box">
        <div className="login-logo">
          <BrandLockup subtitle="Accedi per continuare" tone="light" size="hero" centered />
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          <input
            className="login-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && document.getElementById('password-input')?.focus()}
            required
          />
          <input
            id="password-input"
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button
            type="submit"
            className="login-btn"
            disabled={loading}
          >
            {loading ? 'Accesso in corso…' : 'Accedi'}
          </button>
        </form>

        <div className="login-trust">
          Speaqi di TheBestItaly · P.IVA: 10831191217
        </div>

        <div className="signup-footer">
          Nuovo cliente? <a href="/signup" className="signup-link">Crea account</a>
        </div>
      </div>
    </div>
  )
}
