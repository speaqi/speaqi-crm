'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import styles from './ufficio.module.css'

type LockState = { enabled: boolean; locked: boolean }

/**
 * Il lucchetto dell'Ufficio (`UFFICIO_PASSWORD`): finché la password non è stata data su questo
 * browser non si monta niente, né la scena né il pannello. Senza la variabile si entra come prima.
 */
export function OfficeLockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LockState | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiFetch<LockState>('/api/ufficio/sblocca')
      .then(setState)
      .catch((err) => setError(err instanceof Error ? err.message : 'Impossibile aprire l’ufficio'))
  }, [])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    if (!password.trim() || busy) return
    setBusy(true)
    try {
      await apiFetch('/api/ufficio/sblocca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      setPassword('')
      setError('')
      setState((current) => ({ enabled: current?.enabled ?? true, locked: false }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password non accettata')
    } finally { setBusy(false) }
  }

  async function lock() {
    try {
      await apiFetch('/api/ufficio/sblocca', { method: 'DELETE' })
      setState({ enabled: true, locked: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Non sono riuscito a chiudere l’ufficio')
    }
  }

  if (!state) return <div className={styles.lock}>{error ? <p className={styles.error}>{error}</p> : <p className={styles.muted}>Apro l’ufficio…</p>}</div>
  if (state.locked) {
    return <div className={styles.lock}>
      <form className={styles.lockCard} onSubmit={unlock}>
        <h1>🔒 Ufficio</h1>
        <p className={styles.muted}>Scrivi la password dell’Ufficio. Su questo browser resta aperto per 30 giorni.</p>
        <input type="password" autoComplete="current-password" autoFocus value={password} aria-label="Password dell’Ufficio"
          onChange={(event) => setPassword(event.target.value)} placeholder="Password" />
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="submit" disabled={busy || !password.trim()}>{busy ? 'Controllo…' : 'Entra'}</button>
      </form>
    </div>
  }
  return <>
    {children}
    {state.enabled ? <button type="button" className={styles.lockButton} onClick={lock} title="Su questo browser servirà di nuovo la password">🔒 Chiudi l’Ufficio</button> : null}
  </>
}
