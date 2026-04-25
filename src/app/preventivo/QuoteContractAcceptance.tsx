'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type QuoteContractAcceptanceProps = {
  token: string
  contractAcceptedAt: string | null
  defaultEmail: string
  contractSignerEmail: string | null
  acceptedAtLabel: string | null
}

function normalizeEmail(s: string) {
  return s.trim().toLowerCase()
}

function formatAcceptedDate() {
  return new Date().toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function QuoteContractAcceptance({
  token,
  contractAcceptedAt,
  defaultEmail,
  contractSignerEmail,
  acceptedAtLabel,
}: QuoteContractAcceptanceProps) {
  const router = useRouter()
  const [email, setEmail] = useState(defaultEmail)
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [signedAt, setSignedAt] = useState<string | null>(contractAcceptedAt)
  const [signer, setSigner] = useState<string | null>(contractSignerEmail)
  const [dateLabel, setDateLabel] = useState<string | null>(acceptedAtLabel)

  const isDone = Boolean(signedAt)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setWarning(null)
    if (!accepted) {
      setError('Devi spuntare la casella per accettare le condizioni contrattuali.')
      return
    }
    const em = normalizeEmail(email)
    if (em.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Inserisci un indirizzo email valido per la conferma.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/quotes/public/accept-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email: em }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Registrazione non riuscita')
      }
      if (typeof payload?.warning === 'string') {
        setWarning(payload.warning)
      }
      setSignedAt(new Date().toISOString())
      setSigner(typeof payload?.signer_email === 'string' ? payload.signer_email : em)
      setDateLabel(formatAcceptedDate())
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrazione non riuscita')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {isDone ? (
        <>
          <div className="public-quote-contract-badge">Contratto accettato</div>
          {signer && (
            <p className="public-quote-contract-email-note">
              Conferma inviata a <strong>{signer}</strong>
            </p>
          )}
        </>
      ) : (
        <form className="public-quote-contract-form" onSubmit={onSubmit} noValidate>
          <label className="public-quote-contract-label" htmlFor="quote-contract-email">
            Email per la conferma
          </label>
          <input
            id="quote-contract-email"
            name="email"
            type="email"
            autoComplete="email"
            className="public-quote-contract-input"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="nome@azienda.it"
            required
          />
          <label className="public-quote-contract-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(ev) => setAccepted(ev.target.checked)}
            />
            <span>
              Dichiaro di aver letto e accettato le condizioni contrattuali e i{' '}
              <Link href="/termini-speaqi" target="_blank" rel="noopener noreferrer">
                Termini di servizio Speaqi
              </Link>{' '}
              per questa offerta.
            </span>
          </label>
          <button type="submit" className="public-quote-contract-submit" disabled={loading}>
            {loading ? 'Registrazione…' : 'Conferma accettazione contratto'}
          </button>
        </form>
      )}

      <p className="public-quote-contract-summary">
        Con la presente offerta, l’accettazione del pagamento da parte del Cliente — inclusi acconto, saldo o
        importo totale, effettuati tramite bonifico — comporta anche l’accettazione integrale delle
        condizioni contrattuali stabilite nei{' '}
        <Link href="/termini-speaqi" target="_blank" rel="noopener noreferrer">
          Termini di servizio Speaqi
        </Link>
        .
      </p>
      {isDone && dateLabel && (
        <p className="public-quote-muted">
          Accettazione registrata il {dateLabel}
          {signer ? ` · ${signer}` : ''}
        </p>
      )}
      {error && <div className="public-quote-error">{error}</div>}
      {warning && <p className="public-quote-contract-warning">{warning}</p>}
    </div>
  )
}
