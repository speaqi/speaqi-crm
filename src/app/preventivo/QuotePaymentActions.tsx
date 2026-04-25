'use client'

import { useState } from 'react'

interface QuotePaymentActionsProps {
  token: string
  canUseStripe: boolean
  hasBankTransfer: boolean
  depositLabel: string
  totalLabel: string
}

export function QuotePaymentActions({
  token,
  canUseStripe,
  hasBankTransfer,
  depositLabel,
  totalLabel,
}: QuotePaymentActionsProps) {
  const [loading, setLoading] = useState<'deposit' | 'total' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(amount: 'deposit' | 'total') {
    setLoading(amount)
    setError(null)
    try {
      const response = await fetch('/api/quotes/public/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, amount }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Pagamento non disponibile')
      }
      window.location.href = payload.url
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Pagamento non disponibile')
    } finally {
      setLoading(null)
    }
  }

  if (!canUseStripe && !hasBankTransfer) return null

  return (
    <div className="public-quote-actions">
      {canUseStripe && (
        <div className="public-quote-action-row">
          <button
            type="button"
            className="public-quote-pay"
            disabled={Boolean(loading)}
            onClick={() => startCheckout('deposit')}
          >
            {loading === 'deposit' ? 'Apertura Stripe…' : `Paga acconto ${depositLabel}`}
          </button>
          <button
            type="button"
            className="public-quote-pay secondary"
            disabled={Boolean(loading)}
            onClick={() => startCheckout('total')}
          >
            {loading === 'total' ? 'Apertura Stripe…' : `Paga totale ${totalLabel}`}
          </button>
        </div>
      )}
      {hasBankTransfer && (
        <button type="button" className="public-quote-print" onClick={() => window.print()}>
          Stampa preventivo per bonifico
        </button>
      )}
      {error && <div className="public-quote-error">{error}</div>}
    </div>
  )
}
