'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { createClient } from '@/lib/supabase'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Errore registrazione')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })

    if (loginError) {
      setError('Account creato. Procedi al login.')
      setTimeout(() => router.push('/login'), 2000)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">
          <BrandLockup subtitle="Crea il tuo account" tone="light" size="hero" centered />
        </div>

        <form className="login-form" onSubmit={handleSignup}>
          <input
            className="login-input"
            type="text"
            placeholder="Nome e cognome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="login-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="login-input"
            type="password"
            placeholder="Password (min 6 caratteri)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Registrazione in corso…' : 'Crea account'}
          </button>
        </form>

        <div className="signup-footer">
          Hai già un account?{' '}
          <a href="/login" className="signup-link">Accedi</a>
        </div>
      </div>
    </div>
  )
}
