import { StripeApiError, stripeFetch, toCents } from '@/lib/server/stripe'

type CheckoutQuote = {
  id: string
  public_token: string
  total_amount: unknown
  currency: string
  stripe_checkout_session_id?: string | null
}

type CheckoutAttempt = {
  attempt_id: string
  params: Record<string, string>
  stripe_session_id: string | null
  created_at: string
}

/** Una chiave persistente e parametri immutabili per ogni tentativo. */
export async function subscriptionCheckoutSession(
  admin: any,
  quote: CheckoutQuote,
  requestedParams: URLSearchParams
): Promise<{ id: string; url: string }> {
  const claim = async (replaces: string | null = null): Promise<CheckoutAttempt> => {
    const { data, error } = await admin.rpc('claim_quote_checkout_attempt', {
      p_quote_id: quote.id,
      p_params: Object.fromEntries(requestedParams),
      p_replaces_attempt: replaces,
    })
    if (error) {
      if (String(error.message).includes('quote_checkout_not_available')) {
        throw new StripeApiError('Pagamento già completato o preventivo non disponibile.', 409)
      }
      throw error
    }
    if (!data?.attempt_id) throw new Error('Tentativo di checkout non registrato')
    return data
  }

  const remember = async (attempt: CheckoutAttempt, session: any) => {
    if (!session?.id || !session?.url) throw new Error('Stripe non ha restituito un link valido')
    const stored = await admin.from('quote_checkout_attempts')
      .update({ stripe_session_id: session.id })
      .eq('quote_id', quote.id).eq('attempt_id', attempt.attempt_id)
      .select('attempt_id').single()
    if (stored.error) throw stored.error
    if (!stored.data) throw new Error('Tentativo di checkout sostituito: riprova')
    const recorded = await admin.rpc('mark_quote_checkout_created', {
      p_public_token: quote.public_token,
      p_session_id: session.id,
      p_checkout_url: session.url,
    })
    if (recorded.error) throw recorded.error
    return { id: String(session.id), url: String(session.url) }
  }

  let attempt = await claim()
  let legacyChecked = false
  for (let tries = 0; tries < 3; tries++) {
    const sessionId = attempt.stripe_session_id || (!legacyChecked ? quote.stripe_checkout_session_id : null)
    legacyChecked = true
    if (sessionId) {
      // Un errore di lettura non prova che la vecchia sessione sia scaduta.
      const existing = await stripeFetch<any>(`/checkout/sessions/${encodeURIComponent(sessionId)}`)
      if (existing?.mode !== 'subscription' || existing?.metadata?.quote_id !== quote.id ||
          existing?.client_reference_id !== quote.public_token) {
        throw new StripeApiError('La sessione Stripe non corrisponde al preventivo.', 409)
      }
      if (existing.status === 'complete') {
        throw new StripeApiError('Pagamento già completato: attendi la conferma.', 409)
      }
      if (existing.status === 'open' && existing.url) {
        if (toCents(quote.total_amount) !== Number(existing.amount_total) ||
            String(existing.currency).toUpperCase() !== String(quote.currency).toUpperCase()) {
          throw new StripeApiError('La sessione Stripe non corrisponde all’importo firmato.', 409)
        }
        return remember(attempt, existing)
      }
      if (existing.status !== 'expired') throw new StripeApiError('Stato del pagamento non verificabile.', 409)
      if (attempt.stripe_session_id) {
        attempt = await claim(attempt.attempt_id)
        continue
      }
      // Sessione legacy scaduta: il tentativo persistente è ancora nuovo.
    }

    // Stripe conserva le chiavi per almeno 24 ore. Senza un session_id oltre
    // questa finestra l'esito è incerto: serve riconciliare, non incassare di nuovo.
    const createdAt = new Date(attempt.created_at).getTime()
    if (!Number.isFinite(createdAt) || Date.now() - createdAt >= 23 * 3_600_000) {
      throw new StripeApiError('Esito del precedente checkout da verificare. Contatta il team Speaqi.', 409)
    }
    const session = await stripeFetch<any>('/checkout/sessions', {
      params: new URLSearchParams(attempt.params),
      idempotencyKey: `quote-checkout-${attempt.attempt_id}`,
    })
    return remember(attempt, session)
  }
  throw new StripeApiError('Checkout aggiornato da un’altra richiesta: riprova.', 409)
}
