import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import {
  StripeApiError,
  buildSubscriptionCheckoutParams,
  catalogAmountCents,
  catalogPriceCents,
  stripeFetch,
  toCents,
  type StripeCatalogPricing,
} from '@/lib/server/stripe'
import { createPublicServerClient, createServiceRoleClient } from '@/lib/server/supabase'
import { quoteSignatureMismatches } from '@/lib/server/quotes'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function pickOrigin(request: NextRequest) {
  const configuredOrigin = normalizeText(process.env.NEXT_PUBLIC_APP_URL)
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, '')

  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return request.nextUrl.origin
}

/** Stati Stripe in cui l'abbonamento esiste gia': un secondo checkout sarebbe un doppione. */
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'incomplete'])

/**
 * Prodotto "Video nella mappa" del catalogo Stripe. Si usa solo se l'importo
 * che ne risulta coincide al centesimo con quello firmato: prima il prezzo
 * pieno da solo (il listino attuale, 400 € + IVA = 488 €), poi — se c'e' —
 * col coupon permanente, che serve ai preventivi firmati quando il prezzo era
 * 300 € + IVA. Un preventivo con un importo diverso (piu' video, un prezzo
 * fatto a mano nel CRM) torna al prezzo scritto al volo, cosi' non si
 * addebita mai una cifra diversa da quella firmata.
 */
async function resolveCatalogPricing(totalAmount: unknown, quoteNumber: string): Promise<StripeCatalogPricing | null> {
  const priceId = process.env.STRIPE_VIDEO_MAP_PRICE_ID?.trim()
  const couponId = process.env.STRIPE_VIDEO_MAP_COUPON_ID?.trim() || null
  if (!priceId) return null
  const signed = toCents(totalAmount)
  try {
    const price = await stripeFetch<any>(`/prices/${encodeURIComponent(priceId)}`)
    const full = catalogPriceCents(price)
    if (full !== null && full === signed) return { priceId, couponId: null }

    let discounted: number | null = null
    if (couponId) {
      const coupon = await stripeFetch<any>(`/coupons/${encodeURIComponent(couponId)}`)
      discounted = catalogAmountCents(price, coupon)
      if (discounted !== null && discounted === signed) return { priceId, couponId }
    }
    console.warn('checkout: catalogo Stripe non allineato, prezzo inline', { quoteNumber, full, discounted, signed })
  } catch (error) {
    console.warn('checkout: catalogo Stripe illeggibile, prezzo inline', error instanceof Error ? error.message : error)
  }
  return null
}

/**
 * Abbonamento annuale: si paga solo dopo la firma, e solo l'importo firmato.
 * Il client service role serve per leggere la firma (tabella senza accesso
 * pubblico) e gli id Stripe, che get_public_quote non espone.
 */
async function startSubscriptionCheckout(request: NextRequest, token: string) {
  const admin = createServiceRoleClient()
  const { data: quote, error } = await admin
    .from('quotes')
    .select(
      'id, quote_number, public_token, title, status, items, subtotal_amount, discount_amount, tax_rate, tax_amount, total_amount, currency, customer_email, quote_acceptance_email, contract_signer_email, billing_interval, subscription_status, stripe_checkout_session_id, stripe_checkout_url'
    )
    .eq('public_token', token)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (error) throw error
  if (!quote) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })

  if (quote.status === 'paid' || LIVE_SUBSCRIPTION_STATUSES.has(String(quote.subscription_status || ''))) {
    return Response.json({ error: 'Abbonamento già attivo per questo preventivo' }, { status: 409 })
  }

  const { data: signature } = await admin
    .from('quote_signatures')
    .select('amounts_snapshot')
    .eq('quote_id', quote.id)
    .maybeSingle()
  if (!signature) {
    return Response.json({ error: 'Firma il contratto prima di procedere al pagamento' }, { status: 409 })
  }
  // Offerta cambiata dopo la firma: il cliente pagherebbe condizioni diverse da
  // quelle firmate. Non basta confrontare il totale: contano righe, IVA, valuta
  // e periodicità.
  const mismatches = quoteSignatureMismatches(signature.amounts_snapshot, quote)
  if (mismatches.length) {
    return Response.json(
      { error: 'L’offerta è cambiata dopo la firma: chiedi al team Speaqi un nuovo link di firma' },
      { status: 409 }
    )
  }
  if (toCents(quote.total_amount) < 50) {
    return Response.json({ error: 'Importo troppo basso per Stripe' }, { status: 400 })
  }

  const catalog = await resolveCatalogPricing(quote.total_amount, quote.quote_number)
  const pricing = catalog ? 'catalog' : 'inline'

  // Una sessione ancora aperta si riusa: due clic non creano due abbonamenti.
  // Se il prezzo e' passato da inline a catalogo (o viceversa) la vecchia si
  // chiude prima di aprirne una nuova, per non lasciarne due pagabili.
  if (quote.stripe_checkout_session_id && quote.stripe_checkout_url) {
    try {
      const existing = await stripeFetch<any>(
        `/checkout/sessions/${encodeURIComponent(quote.stripe_checkout_session_id)}`
      )
      if (existing?.status === 'open' && existing?.mode === 'subscription' && existing?.url) {
        if ((existing?.metadata?.pricing || 'inline') === pricing) {
          return Response.json({ url: existing.url })
        }
        await stripeFetch(`/checkout/sessions/${encodeURIComponent(existing.id)}/expire`, {
          method: 'POST',
          params: new URLSearchParams(),
        })
      }
    } catch {
      // sessione scaduta o illeggibile: se ne crea una nuova
    }
  }

  const params = buildSubscriptionCheckoutParams({
    token,
    quoteId: quote.id,
    quoteNumber: quote.quote_number,
    totalAmount: quote.total_amount,
    currency: quote.currency,
    customerEmail: quote.contract_signer_email || quote.quote_acceptance_email || quote.customer_email,
    productName: `${quote.title || 'Abbonamento Speaqi'} (${quote.quote_number})`,
    origin: pickOrigin(request),
    catalog,
  })
  // Due clic contemporanei devono produrre la stessa sessione Stripe, non due
  // abbonamenti pagabili. La chiave cambia ogni ora: un retry il giorno dopo
  // può creare una sessione nuova, due richieste nello stesso minuto no.
  const hourBucket = Math.floor(Date.now() / 3_600_000)
  const idempotencyKey = [
    'quote-checkout',
    quote.id,
    pricing,
    toCents(quote.total_amount),
    String(quote.currency || 'EUR').toUpperCase(),
    hourBucket,
  ].join('-')
  const session = await stripeFetch<any>('/checkout/sessions', { params, idempotencyKey })
  const checkoutUrl = normalizeText(session?.url)
  const sessionId = normalizeText(session?.id)
  if (!checkoutUrl || !sessionId) {
    return Response.json({ error: 'Stripe non ha restituito un link valido' }, { status: 502 })
  }

  await admin.rpc('mark_quote_checkout_created', {
    p_public_token: token,
    p_session_id: sessionId,
    p_checkout_url: checkoutUrl,
  })

  return Response.json({ url: checkoutUrl })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = normalizeText(body.token)

    if (!token) return Response.json({ error: 'Token preventivo mancante' }, { status: 400 })

    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json(
        { error: 'Stripe non configurato: imposta STRIPE_SECRET_KEY sul deploy' },
        { status: 501 }
      )
    }

    const supabase = createPublicServerClient()
    const { data, error } = await supabase.rpc('get_public_quote', { p_public_token: token })
    if (error) throw error

    const quote = Array.isArray(data) ? data[0] : null
    if (!quote) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })

    if (quote.billing_interval === 'year') {
      return await startSubscriptionCheckout(request, token)
    }

    // I preventivi una tantum si pagano con bonifico. La pagina /preventivo non
    // mostra mai il pulsante carta per queste offerte: lasciare la sessione
    // `mode=payment` raggiungibile significava incassare senza segnare il
    // preventivo come pagato ne' preparare la fattura.
    return Response.json(
      {
        error:
          'Pagamento con carta disponibile solo per gli abbonamenti annuali. Per questa offerta usa il bonifico.',
      },
      { status: 409 }
    )
  } catch (error) {
    if (error instanceof StripeApiError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: errorMessage(error, 'Impossibile avviare il pagamento') }, { status: 500 })
  }
}
