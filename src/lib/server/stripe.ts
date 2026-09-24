import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe senza SDK: il CRM parla con l'API REST via fetch e parametri
 * form-encoded, e verifica a mano la firma del webhook. Stessa versione API
 * da impostare sull'endpoint webhook nel pannello Stripe.
 */
export const STRIPE_API_VERSION = '2026-02-25.clover'

/** Tolleranza sul timestamp della firma: oltre, l'evento e' un replay. */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300

export function toCents(value: unknown) {
  const amount = Number(value || 0)
  return Math.max(0, Math.round(amount * 100))
}

export class StripeApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function stripeFetch<T = any>(
  path: string,
  options: { method?: 'GET' | 'POST'; params?: URLSearchParams } = {}
): Promise<T> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new StripeApiError('Stripe non configurato: imposta STRIPE_SECRET_KEY sul deploy', 501)

  const method = options.method || (options.params ? 'POST' : 'GET')
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': STRIPE_API_VERSION,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? options.params : undefined,
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new StripeApiError(payload?.error?.message || `Stripe ha risposto ${response.status}`, 502)
  }
  return payload as T
}

export type StripeSignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string }

/**
 * Verifica l'header `Stripe-Signature` (`t=…,v1=…[,v1=…]`): HMAC-SHA256 di
 * `${t}.${corpo grezzo}` col segreto dell'endpoint. Piu' `v1` arrivano durante
 * la rotazione del segreto: basta che uno torni. Il corpo deve essere quello
 * ricevuto byte per byte, mai un JSON riserializzato.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC
): StripeSignatureCheck {
  if (!header) return { ok: false, reason: 'missing_header' }
  if (!secret) return { ok: false, reason: 'missing_secret' }

  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key === 't') timestamp = Number(value)
    else if (key === 'v1' && value) signatures.push(value)
  }

  if (timestamp === null || !Number.isFinite(timestamp)) return { ok: false, reason: 'missing_timestamp' }
  if (!signatures.length) return { ok: false, reason: 'missing_v1' }

  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex'),
    'utf8'
  )
  const matches = signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'utf8')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
  if (!matches) return { ok: false, reason: 'signature_mismatch' }

  if (Math.abs(nowSec - timestamp) > toleranceSec) return { ok: false, reason: 'timestamp_out_of_tolerance' }
  return { ok: true, timestamp }
}

/** `couponId: null` = prezzo di catalogo pieno, senza sconto. */
export type StripeCatalogPricing = { priceId: string; couponId: string | null }

/**
 * Quanto addebita Stripe col prezzo di catalogo da solo, in centesimi.
 * `null` quando il prezzo non e' adatto a un abbonamento annuale in euro:
 * spento, non annuale o in altra valuta.
 */
export function catalogPriceCents(price: any): number | null {
  if (!price || price.active === false) return null
  if (price.type !== 'recurring' || price.recurring?.interval !== 'year' || Number(price.recurring?.interval_count || 1) !== 1) {
    return null
  }
  if (String(price.currency || '').toLowerCase() !== 'eur') return null
  const unit = Number(price.unit_amount)
  if (!Number.isInteger(unit) || unit <= 0) return null
  return unit
}

/**
 * Quanto addebita Stripe con prezzo di catalogo + coupon, in centesimi.
 * `null` quando la coppia non e' adatta a un abbonamento annuale in euro con
 * sconto permanente: prezzo non valido (vedi `catalogPriceCents`), coupon non
 * valido o non "per sempre". Un coupon "una volta" farebbe rinnovare a prezzo
 * pieno, mentre il contratto firmato dice "stesso prezzo".
 */
export function catalogAmountCents(price: any, coupon: any): number | null {
  const unit = catalogPriceCents(price)
  if (unit === null) return null

  if (!coupon || coupon.valid === false || coupon.duration !== 'forever') return null
  let discounted: number
  if (coupon.amount_off != null) {
    if (String(coupon.currency || '').toLowerCase() !== 'eur') return null
    discounted = unit - Number(coupon.amount_off)
  } else if (coupon.percent_off != null) {
    discounted = Math.round(unit * (1 - Number(coupon.percent_off) / 100))
  } else {
    return null
  }
  if (!Number.isFinite(discounted) || discounted <= 0) return null
  return discounted
}

export function buildSubscriptionCheckoutParams(input: {
  token: string
  quoteId: string
  quoteNumber: string
  totalAmount: number | string
  currency?: string | null
  customerEmail?: string | null
  productName: string
  origin: string
  /** Prodotto del catalogo Stripe (con o senza coupon); senza, il prezzo si scrive al volo. */
  catalog?: StripeCatalogPricing | null
}) {
  const origin = input.origin.replace(/\/$/, '')
  const tokenParam = encodeURIComponent(input.token)
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('payment_method_types[0]', 'card')
  params.set('locale', 'it')
  params.set('client_reference_id', input.token)
  // {CHECKOUT_SESSION_ID} lo sostituisce Stripe: la pagina di ritorno verifica
  // la sessione anche se il webhook arriva in ritardo.
  params.set('success_url', `${origin}/preventivo?id=${tokenParam}&checkout=success&session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', `${origin}/preventivo?id=${tokenParam}&checkout=cancelled`)
  params.set('line_items[0][quantity]', '1')
  if (input.catalog) {
    params.set('line_items[0][price]', input.catalog.priceId)
    if (input.catalog.couponId) params.set('discounts[0][coupon]', input.catalog.couponId)
  } else {
    params.set('line_items[0][price_data][currency]', String(input.currency || 'EUR').toLowerCase())
    params.set('line_items[0][price_data][unit_amount]', String(toCents(input.totalAmount)))
    params.set('line_items[0][price_data][recurring][interval]', 'year')
    params.set('line_items[0][price_data][product_data][name]', input.productName)
  }
  for (const [key, value] of [
    ['quote_token', input.token],
    ['quote_id', input.quoteId],
    ['quote_number', input.quoteNumber],
    ['pricing', input.catalog ? 'catalog' : 'inline'],
  ]) {
    params.set(`metadata[${key}]`, value)
    // Anche sull'abbonamento: le fatture di rinnovo arrivano senza la sessione.
    params.set(`subscription_data[metadata][${key}]`, value)
  }
  if (input.customerEmail) params.set('customer_email', input.customerEmail)
  return params
}

// ── Letture tolleranti: le versioni API recenti hanno spostato alcuni campi ──

function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

export function invoiceSubscriptionId(invoice: any): string | null {
  return idOf(invoice?.parent?.subscription_details?.subscription) || idOf(invoice?.subscription)
}

export function invoiceSubscriptionMetadata(invoice: any): Record<string, string> {
  return (
    invoice?.parent?.subscription_details?.metadata ||
    invoice?.subscription_details?.metadata ||
    invoice?.lines?.data?.[0]?.metadata ||
    {}
  )
}

function unixToIso(value: unknown): string | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

export function invoicePeriodEnd(invoice: any): string | null {
  return unixToIso(invoice?.lines?.data?.[0]?.period?.end) || unixToIso(invoice?.period_end)
}

export function subscriptionPeriodEnd(subscription: any): string | null {
  return (
    unixToIso(subscription?.items?.data?.[0]?.current_period_end) ||
    unixToIso(subscription?.current_period_end)
  )
}

export function stripeObjectId(value: unknown) {
  return idOf(value)
}
