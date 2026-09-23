'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { SignaturePad, type SignaturePadHandle } from './SignaturePad'

type QuoteSignatureFormProps = {
  token: string
  acceptanceToken: string
  defaultSignerName?: string | null
  isSubscription: boolean
}

/**
 * Firma disegnata: nome e cognome, firma nel riquadro, accettazione dei
 * termini e — per l'abbonamento — approvazione specifica del rinnovo
 * automatico (artt. 1341-1342 c.c.). Dopo la firma la pagina si ricarica e
 * compare il pagamento con carta.
 */
export function QuoteSignatureForm({ token, acceptanceToken, defaultSignerName, isSubscription }: QuoteSignatureFormProps) {
  const router = useRouter()
  const padRef = useRef<SignaturePadHandle | null>(null)
  const [signerName, setSignerName] = useState(defaultSignerName || '')
  const [accepted, setAccepted] = useState(false)
  const [renewalAccepted, setRenewalAccepted] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (signerName.trim().length < 3) return setError('Scrivi nome e cognome di chi firma.')
    const signature = padRef.current?.toDataUrl()
    if (!signature) return setError('Firma nel riquadro prima di confermare.')
    if (!accepted) return setError('Devi accettare le condizioni contrattuali.')
    if (isSubscription && !renewalAccepted) return setError('Devi approvare il rinnovo automatico annuale.')

    setLoading(true)
    try {
      const response = await fetch('/api/quotes/public/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          acceptance_token: acceptanceToken,
          signer_name: signerName,
          signature_png: signature,
          accepted,
          renewal_accepted: renewalAccepted,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Firma non registrata')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Firma non registrata')
      setLoading(false)
    }
  }

  return (
    <form className="public-quote-contract-form" onSubmit={onSubmit} noValidate>
      <label className="public-quote-contract-label" htmlFor="quote-signer-name">
        Nome e cognome di chi firma
      </label>
      <input
        id="quote-signer-name"
        className="public-quote-contract-input"
        value={signerName}
        onChange={(event) => setSignerName(event.target.value)}
        autoComplete="name"
        maxLength={200}
      />

      <span className="public-quote-contract-label">Firma</span>
      <SignaturePad ref={padRef} onChange={setHasInk} disabled={loading} />

      <label className="public-quote-contract-check">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>
          Dichiaro di aver letto e accettato le condizioni contrattuali e i{' '}
          <Link href="/termini-speaqi" target="_blank" rel="noopener noreferrer">
            Termini di servizio Speaqi
          </Link>{' '}
          per questa offerta.
        </span>
      </label>
      {isSubscription && (
        <label className="public-quote-contract-check">
          <input
            type="checkbox"
            checked={renewalAccepted}
            onChange={(event) => setRenewalAccepted(event.target.checked)}
          />
          <span>
            Approvo specificamente, ai sensi degli artt. 1341 e 1342 c.c., il rinnovo automatico annuale e le
            clausole su durata, disdetta e limitazione di responsabilità.
          </span>
        </label>
      )}

      <button
        type="submit"
        className="public-quote-contract-submit"
        disabled={loading || !hasInk || !accepted || (isSubscription && !renewalAccepted)}
      >
        {loading ? 'Registrazione firma…' : isSubscription ? 'Firma e vai al pagamento' : 'Firma il contratto'}
      </button>
      {error && <div className="public-quote-error">{error}</div>}
    </form>
  )
}
