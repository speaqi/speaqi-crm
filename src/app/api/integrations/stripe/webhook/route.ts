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
import { createInvoiceDraftFromQuote, type DraftFromQuoteOptions } from '@/lib/server/invoices'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

/**
 * Webhook Stripe degli abbonamenti (Video nella mappa).
 *
 * Eventi da abilitare sull'endpoint: checkout.session.completed, invoice.paid,
 * invoice.payment_failed, customer.subscription.updated,
 * customer.subscription.deleted. Un pagamento una tantum (mode=payment) non
 * cambia il preventivo: diventa un'attivita' da registrare a mano.
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

/**
 * Bozza della fattura elettronica per un incasso. Non la invia: l'invio allo
 * SDI lo decide sempre una persona da /fatture. Un errore qui non deve far
 * riconsegnare l'evento a Stripe (il pagamento e' gia' registrato): si scrive
 * nella timeline e la bozza si prepara a mano.
 */
async function prepareInvoiceDraft(admin: any, quote: Pick<Quote, 'id' | 'user_id' | 'contact_id' | 'quote_number'>, options: DraftFromQuoteOptions) {
  try {
    const { invoice } = await createInvoiceDraftFromQuote(admin, quote.user_id, quote.id, options)
    return invoice
  } catch (error) {
    console.error('[stripe-webhook] bozza fattura non preparata', quote.id, error)
    await logActivity(admin, quote as Quote, `Bozza della fattura non preparata (preventivo ${quote.quote_number}): ${errorMessage(error, 'errore')}. Preparala da Fatture.`, {})
    return null
  }
}

/**
 * Acconto o saldo una tantum di un preventivo. Il checkout non ne apre piu',
 * ma una sessione aperta prima puo' ancora essere pagata: prima si scartava e
 * l'incasso non compariva da nessuna parte. Non si segna pagato da solo
 * (un acconto non chiude il preventivo): resta nella timeline con un'attivita'
 * per registrarlo.
 */
async function handleOneOffPayment(admin: any, session: any) {
  if (session?.payment_status !== 'paid') return null
  // Solo i checkout del CRM portano quote_token: l'endpoint riceve gli eventi
  // di tutto l'account Stripe, e gli altri pagamenti non sono affari suoi.
  const token = session?.metadata?.quote_token
  if (!token) return null

  const { data: quote } = await admin
    .from('quotes')
    .select('id, user_id, contact_id, quote_number, total_amount, currency, subscription_status')
    .eq('public_token', token)
    .maybeSingle()
  if (!quote) {
    console.warn('[stripe-webhook] pagamento una tantum senza preventivo', session?.id)
    return null
  }

  const amount = Number(session?.amount_total || 0) / 100
  const currency = String(session?.currency || quote.currency || 'EUR').toUpperCase()
  const part = session?.metadata?.payment_part === 'total' ? 'saldo' : 'acconto'
  await logActivity(
    admin,
    quote,
    `Pagamento con carta una tantum ricevuto (${part}, preventivo ${quote.quote_number}): ${formatQuoteEuro(amount, currency)}. Il preventivo non è stato aggiornato in automatico: controlla l’incasso su Stripe e registralo.`,
    {
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: stripeObjectId(session.payment_intent),
      payment_part: part,
    }
  )
  if (quote.contact_id) {
    await createLeadTask(admin, quote.user_id, {
      leadId: quote.contact_id,
      action: 'wait',
      type: 'follow-up',
      dueAt: new Date().toISOString(),
      priority: 'high',
      note: `Registrare l’incasso con carta di ${formatQuoteEuro(amount, currency)} (${part}) sul preventivo ${quote.quote_number} e preparare la fattura.`,
      idempotencyKey: `stripe-session:${session.id}`,
    })
  }
  return quote.id
}

async function handleCheckoutCompleted(admin: any, session: any) {
  if (session?.mode === 'payment') return handleOneOffPayment(admin, session)
  if (session?.mode !== 'subscription') return null
  const quoteId = session?.metadata?.quote_id
  const quoteToken = session?.metadata?.quote_token
  if (!quoteId || !quoteToken) return null

  const { data: quote } = await admin
    .from('quotes')
    .select('id, public_token, user_id, contact_id, quote_number')
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
  await prepareInvoiceDraft(admin, quote, { viaStripe: true })
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

  // Le ricevute Stripe non sono fatture elettroniche: ogni rinnovo ha la sua fattura, in bozza.
  const draft = await prepareInvoiceDraft(
    admin,
    quote,
    invoice?.billing_reason === 'subscription_create'
      ? { viaStripe: true }
      : { stripeInvoiceId: invoice.id, grossAmount: amount, periodEnd, viaStripe: true }
  )
  if (quote.contact_id) {
    await createLeadTask(admin, quote.user_id, {
      leadId: quote.contact_id,
      action: 'wait',
      type: 'follow-up',
      dueAt: new Date().toISOString(),
      priority: 'medium',
      note: draft
        ? `Fattura in bozza da controllare e inviare (Fatture): abbonamento ${quote.quote_number}, ${formatQuoteEuro(amount, quote.currency)} incassati con carta (Stripe ${invoice.number || invoice.id}).`
        : `Emettere fattura elettronica: abbonamento ${quote.quote_number}, ${formatQuoteEuro(amount, quote.currency)} incassati con carta (Stripe ${invoice.number || invoice.id}).`,
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
