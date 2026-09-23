import { NextRequest } from 'next/server'
import { createLeadTask } from '@/lib/server/ai-ready'
import { createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import {
  findQuoteForSubscription,
  formatQuoteDay,
  formatQuoteEuro,
  markQuotePaidFromStripe,
} from '@/lib/server/quote-payments'
import {
  invoicePeriodEnd,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  stripeObjectId,
  subscriptionPeriodEnd,
  verifyStripeSignature,
} from '@/lib/server/stripe'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

/**
 * Webhook Stripe degli abbonamenti (Video nella mappa).
 *
 * Eventi da abilitare sull'endpoint: checkout.session.completed, invoice.paid,
 * invoice.payment_failed, customer.subscription.updated,
 * customer.subscription.deleted. I pagamenti una tantum (mode=payment) si
 * ignorano: per loro non cambia niente.
 *
 * Idempotenza: ogni evento finisce in stripe_webhook_events e uno gia'
 * processato risponde 200 senza rifare nulla. In piu' ogni scrittura e' di
 * per se' ripetibile (update condizionali, task con idempotency_key). Un
 * errore risponde 500 cosi' Stripe riprova.
 */

type Quote = {
  id: string
  user_id: string
  contact_id: string | null
  quote_number: string
  total_amount: number
  currency: string
  subscription_status: string | null
}

async function logActivity(admin: any, quote: Quote, content: string, metadata: Record<string, unknown>) {
  if (!quote.contact_id) return
  await createActivities(admin, [
    { user_id: quote.user_id, contact_id: quote.contact_id, type: 'system', content, metadata: { quote_id: quote.id, ...metadata } },
  ])
}

async function handleCheckoutCompleted(admin: any, session: any) {
  if (session?.mode !== 'subscription') return null
  const quoteId = session?.metadata?.quote_id
  const quoteToken = session?.metadata?.quote_token
  if (!quoteId || !quoteToken) return null

  const { data: quote } = await admin
    .from('quotes')
    .select('id, public_token')
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote || quote.public_token !== quoteToken) return null
  // "unpaid" arriva con i metodi asincroni: il pagamento vero lo porta invoice.paid.
  if (session?.payment_status !== 'paid') return quote.id

  await markQuotePaidFromStripe(admin, quote.id, {
    customerId: stripeObjectId(session.customer),
    subscriptionId: stripeObjectId(session.subscription),
    sessionId: session.id,
  })
  return quote.id
}

async function handleInvoicePaid(admin: any, invoice: any) {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return null
  const quote: Quote | null = await findQuoteForSubscription(admin, subscriptionId, invoiceSubscriptionMetadata(invoice))
  if (!quote) return null

  const periodEnd = invoicePeriodEnd(invoice)
  const amount = Number(invoice?.amount_paid || 0) / 100

  if (invoice?.billing_reason === 'subscription_create') {
    // Puo' arrivare prima di checkout.session.completed: il primo pagamento lo chiude chi arriva prima.
    await markQuotePaidFromStripe(admin, quote.id, {
      customerId: stripeObjectId(invoice.customer),
      subscriptionId,
      periodEnd,
    })
  } else {
    await logActivity(
      admin,
      quote,
      `Rinnovo abbonamento pagato (preventivo ${quote.quote_number}): ${formatQuoteEuro(amount, quote.currency)}${periodEnd ? `, prossimo rinnovo il ${formatQuoteDay(periodEnd)}` : ''}.`,
      { stripe_invoice_id: invoice.id, stripe_subscription_id: subscriptionId }
    )
  }

  await admin
    .from('quotes')
    .update({
      subscription_status: 'active',
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
    })
    .eq('id', quote.id)

  // Le ricevute Stripe non sono fatture elettroniche: ogni incasso va fatturato a mano (SDI).
  if (quote.contact_id) {
    await createLeadTask(admin, quote.user_id, {
      leadId: quote.contact_id,
      action: 'wait',
      type: 'follow-up',
      dueAt: new Date().toISOString(),
      priority: 'medium',
      note: `Emettere fattura elettronica: abbonamento ${quote.quote_number}, ${formatQuoteEuro(amount, quote.currency)} incassati con carta (Stripe ${invoice.number || invoice.id}).`,
      idempotencyKey: `stripe-invoice:${invoice.id}`,
    })
  }
  return quote.id
}

async function handleInvoicePaymentFailed(admin: any, invoice: any) {
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return null
  const quote: Quote | null = await findQuoteForSubscription(admin, subscriptionId, invoiceSubscriptionMetadata(invoice))
  if (!quote) return null

  await admin.from('quotes').update({ subscription_status: 'past_due' }).eq('id', quote.id)
  await logActivity(
    admin,
    quote,
    `Pagamento con carta non riuscito (abbonamento ${quote.quote_number}): Stripe ritenta in automatico, conviene avvisare il cliente.`,
    { stripe_invoice_id: invoice.id, stripe_subscription_id: subscriptionId }
  )
  if (quote.contact_id) {
    await createLeadTask(admin, quote.user_id, {
      leadId: quote.contact_id,
      action: 'call',
      type: 'call',
      dueAt: new Date().toISOString(),
      priority: 'high',
      note: `Pagamento abbonamento ${quote.quote_number} non riuscito: chiedere al cliente di aggiornare la carta.`,
      idempotencyKey: `stripe-invoice-failed:${invoice.id}`,
    })
  }
  return quote.id
}

async function handleSubscriptionChange(admin: any, subscription: any, deleted: boolean) {
  const quote: Quote | null = await findQuoteForSubscription(admin, subscription?.id || null, subscription?.metadata)
  if (!quote) return null

  const nextStatus = deleted ? 'canceled' : String(subscription?.status || '') || null
  const periodEnd = subscriptionPeriodEnd(subscription)
  await admin
    .from('quotes')
    .update({
      subscription_status: nextStatus,
      cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      ...(subscription?.id ? { stripe_subscription_id: subscription.id } : {}),
    })
    .eq('id', quote.id)

  if (deleted) {
    await logActivity(admin, quote, `Abbonamento ${quote.quote_number} cessato su Stripe.`, {
      stripe_subscription_id: subscription?.id,
    })
  } else if (nextStatus && nextStatus !== quote.subscription_status) {
    await logActivity(admin, quote, `Abbonamento ${quote.quote_number}: stato Stripe ${quote.subscription_status || '—'} → ${nextStatus}.`, {
      stripe_subscription_id: subscription?.id,
    })
  }
  return quote.id
}

async function dispatch(admin: any, event: any) {
  const object = event?.data?.object
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return handleCheckoutCompleted(admin, object)
    case 'invoice.paid':
      return handleInvoicePaid(admin, object)
    case 'invoice.payment_failed':
      return handleInvoicePaymentFailed(admin, object)
    case 'customer.subscription.updated':
      return handleSubscriptionChange(admin, object, false)
    case 'customer.subscription.deleted':
      return handleSubscriptionChange(admin, object, true)
    default:
      return null
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return Response.json({ error: 'STRIPE_WEBHOOK_SECRET non configurato' }, { status: 500 })
  }

  // Corpo grezzo: la firma e' calcolata sui byte ricevuti, non su un JSON rilavorato.
  const raw = await request.text()
  const check = verifyStripeSignature(raw, request.headers.get('stripe-signature'), secret)
  if (!check.ok) return Response.json({ error: `Firma non valida (${check.reason})` }, { status: 400 })

  let event: any
  try {
    event = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'JSON non valido' }, { status: 400 })
  }
  const eventId = String(event?.id || '')
  if (!eventId) return Response.json({ error: 'Evento senza id' }, { status: 400 })

  const admin = createServiceRoleClient()
  const { data: seen } = await admin
    .from('stripe_webhook_events')
    .select('id, processed_at')
    .eq('id', eventId)
    .maybeSingle()
  if (seen?.processed_at) return Response.json({ received: true, duplicate: true })
  if (!seen) {
    await admin
      .from('stripe_webhook_events')
      .upsert({ id: eventId, type: String(event.type || '') }, { onConflict: 'id', ignoreDuplicates: true })
  }

  try {
    const quoteId = await dispatch(admin, event)
    await admin
      .from('stripe_webhook_events')
      .update({ processed_at: new Date().toISOString(), quote_id: quoteId || null, error: null })
      .eq('id', eventId)
    return Response.json({ received: true })
  } catch (error) {
    const message = errorMessage(error, 'Errore elaborando l’evento Stripe')
    console.error('stripe webhook', event?.type, eventId, message)
    await admin.from('stripe_webhook_events').update({ error: message.slice(0, 1000) }).eq('id', eventId)
    return Response.json({ error: message }, { status: 500 })
  }
}
