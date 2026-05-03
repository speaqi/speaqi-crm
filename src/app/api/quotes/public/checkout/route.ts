import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createPublicServerClient } from '@/lib/server/supabase'

const STRIPE_API_VERSION = '2026-02-25.clover'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function toCents(value: unknown) {
  const amount = Number(value || 0)
  return Math.max(0, Math.round(amount * 100))
}

function pickOrigin(request: NextRequest) {
  const configuredOrigin = normalizeText(process.env.NEXT_PUBLIC_APP_URL)
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, '')

  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return request.nextUrl.origin
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = normalizeText(body.token)
    const amountKind = normalizeText(body.amount) === 'total' ? 'total' : 'deposit'

    if (!token) return Response.json({ error: 'Token preventivo mancante' }, { status: 400 })

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
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

    if (quote.payment_method !== 'stripe' && quote.payment_method !== 'both') {
      return Response.json({ error: 'Pagamento Stripe non previsto per questo preventivo' }, { status: 400 })
    }

    const amountCents = toCents(amountKind === 'total' ? quote.total_amount : quote.deposit_amount)
    if (amountCents < 50) {
      return Response.json({ error: 'Importo troppo basso per Stripe' }, { status: 400 })
    }

    const origin = pickOrigin(request)
    const successUrl = `${origin}/preventivo?id=${encodeURIComponent(token)}&checkout=success`
    const cancelUrl = `${origin}/preventivo?id=${encodeURIComponent(token)}&checkout=cancelled`

    const params = new URLSearchParams()
    params.set('mode', 'payment')
    params.set('client_reference_id', token)
    params.set('success_url', successUrl)
    params.set('cancel_url', cancelUrl)
    params.set('line_items[0][quantity]', '1')
    params.set('line_items[0][price_data][currency]', String(quote.currency || 'EUR').toLowerCase())
    params.set(
      'line_items[0][price_data][product_data][name]',
      `${amountKind === 'total' ? 'Saldo' : 'Acconto'} ${quote.quote_number}`
    )
    params.set('line_items[0][price_data][unit_amount]', String(amountCents))
    params.set('metadata[quote_token]', token)
    params.set('metadata[quote_number]', String(quote.quote_number || ''))
    params.set('metadata[payment_part]', amountKind)
    if (quote.customer_email) params.set('customer_email', String(quote.customer_email))

    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
      },
      body: params,
      cache: 'no-store',
    })

    const stripePayload = await stripeResponse.json().catch(() => null)
    if (!stripeResponse.ok) {
      return Response.json(
        { error: stripePayload?.error?.message || 'Errore creando il pagamento Stripe' },
        { status: 502 }
      )
    }

    const checkoutUrl = normalizeText(stripePayload?.url)
    const sessionId = normalizeText(stripePayload?.id)
    if (!checkoutUrl || !sessionId) {
      return Response.json({ error: 'Stripe non ha restituito un link valido' }, { status: 502 })
    }

    await supabase.rpc('mark_quote_checkout_created', {
      p_public_token: token,
      p_session_id: sessionId,
      p_checkout_url: checkoutUrl,
    })

    return Response.json({ url: checkoutUrl })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile avviare il pagamento') }, { status: 500 })
  }
}
