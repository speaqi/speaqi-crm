import { completePendingCallTasks, createActivities } from '@/lib/server/crm'
import { syncDealWithContactStatus } from '@/lib/server/deal-ops'
import { stripeFetch, stripeObjectId, subscriptionPeriodEnd } from '@/lib/server/stripe'

/**
 * Preventivo pagato → il contatto va a Paid e la trattativa si chiude won.
 * Condiviso fra il PATCH manuale del CRM e il webhook Stripe (client service
 * role): stessa conseguenza, qualunque sia la strada del pagamento.
 */
export async function applyQuotePaidToContact(supabase: any, workspaceUserId: string, contactId: string) {
  const { data: paidContact } = await supabase
    .from('contacts')
    .update({
      status: 'Paid',
      won_at: new Date().toISOString(),
      next_followup_at: null,
      next_action_at: null,
    })
    .eq('user_id', workspaceUserId)
    .eq('id', contactId)
    .select('id')
    .maybeSingle()
  if (paidContact) {
    await syncDealWithContactStatus(supabase, workspaceUserId, contactId, 'Paid')
    await completePendingCallTasks(supabase, workspaceUserId, contactId)
  }
}

function formatEuro(value: unknown, currency = 'EUR') {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(Number(value || 0))
}

function formatDay(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
}

export type StripePaidInput = {
  customerId?: string | null
  subscriptionId?: string | null
  sessionId?: string | null
  periodEnd?: string | null
}

/**
 * Segna pagato un abbonamento. L'update e' condizionato a `status <> 'paid'`:
 * webhook riconsegnato, `invoice.paid` arrivato prima del checkout o la
 * pagina di ritorno che verifica la sessione non producono mai due volte le
 * attivita' e il passaggio del contatto a Paid.
 */
export async function markQuotePaidFromStripe(admin: any, quoteId: string, input: StripePaidInput) {
  const now = new Date().toISOString()
  const stripeFields: Record<string, unknown> = {}
  if (input.customerId) stripeFields.stripe_customer_id = input.customerId
  if (input.subscriptionId) stripeFields.stripe_subscription_id = input.subscriptionId
  if (input.sessionId) stripeFields.stripe_checkout_session_id = input.sessionId
  if (input.periodEnd) stripeFields.current_period_end = input.periodEnd

  const { data: transitioned, error } = await admin
    .from('quotes')
    .update({
      ...stripeFields,
      status: 'paid',
      payment_state: 'paid',
      paid_at: now,
      stripe_payment_status: 'paid',
      subscription_status: 'active',
    })
    .eq('id', quoteId)
    .neq('status', 'paid')
    .select('id, user_id, contact_id, quote_number, total_amount, currency, stripe_subscription_id')
    .maybeSingle()
  if (error) throw error

  if (!transitioned) {
    // Gia' pagato: completa solo gli id Stripe se mancano.
    if (Object.keys(stripeFields).length) {
      const { data: current } = await admin
        .from('quotes')
        .select('id, user_id, contact_id, quote_number, stripe_subscription_id')
        .eq('id', quoteId)
        .maybeSingle()
      if (current && !current.stripe_subscription_id) {
        await admin.from('quotes').update(stripeFields).eq('id', quoteId)
      } else if (
        current?.contact_id &&
        input.subscriptionId &&
        current.stripe_subscription_id &&
        current.stripe_subscription_id !== input.subscriptionId
      ) {
        await createActivities(admin, [
          {
            user_id: current.user_id,
            contact_id: current.contact_id,
            type: 'system',
            content: `Attenzione: preventivo ${current.quote_number} ha un secondo abbonamento Stripe (${input.subscriptionId}). Verificare e annullare il doppione dal pannello Stripe.`,
            metadata: { quote_id: current.id, stripe_subscription_id: input.subscriptionId },
          },
        ])
      }
    }
    return { transitioned: false }
  }

  if (transitioned.contact_id) {
    const renewal = formatDay(input.periodEnd)
    await createActivities(admin, [
      {
        user_id: transitioned.user_id,
        contact_id: transitioned.contact_id,
        type: 'system',
        content: `Preventivo ${transitioned.quote_number} pagato con carta: abbonamento annuale ${formatEuro(transitioned.total_amount, transitioned.currency)} attivo${renewal ? `, rinnovo il ${renewal}` : ''}.`,
        metadata: {
          quote_id: transitioned.id,
          stripe_subscription_id: input.subscriptionId || null,
          stripe_customer_id: input.customerId || null,
        },
      },
    ])
    await applyQuotePaidToContact(admin, transitioned.user_id, transitioned.contact_id)
  }
  return { transitioned: true }
}

/** Trova il preventivo dell'abbonamento: prima per id Stripe, poi per metadata. */
export async function findQuoteForSubscription(
  admin: any,
  subscriptionId: string | null,
  metadata: Record<string, string> | null | undefined
) {
  const select =
    'id, user_id, contact_id, quote_number, public_token, status, total_amount, currency, subscription_status, stripe_subscription_id'
  if (subscriptionId) {
    const { data } = await admin.from('quotes').select(select).eq('stripe_subscription_id', subscriptionId).maybeSingle()
    if (data) return data
  }
  const quoteId = metadata?.quote_id
  if (quoteId && /^[0-9a-f-]{36}$/i.test(quoteId)) {
    const { data } = await admin.from('quotes').select(select).eq('id', quoteId).maybeSingle()
    // Il token pubblico nei metadata conferma che l'id non e' stato scambiato.
    if (data && (!metadata?.quote_token || metadata.quote_token === data.public_token)) return data
  }
  return null
}

/**
 * Ripiego sulla pagina di ritorno da Stripe: se il webhook non e' ancora
 * arrivato, la sessione si verifica direttamente. Idempotente e non lancia
 * mai: la pagina deve comparire comunque.
 */
export async function confirmSubscriptionCheckout(admin: any, sessionId: string, publicToken: string) {
  try {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !process.env.STRIPE_SECRET_KEY) return false
    const session = await stripeFetch<any>(
      `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`
    )
    if (session?.mode !== 'subscription' || session?.status !== 'complete' || session?.payment_status !== 'paid') {
      return false
    }
    if (session?.metadata?.quote_token !== publicToken || !session?.metadata?.quote_id) return false

    const { data: quote } = await admin
      .from('quotes')
      .select('id, public_token')
      .eq('id', session.metadata.quote_id)
      .maybeSingle()
    if (!quote || quote.public_token !== publicToken) return false

    await markQuotePaidFromStripe(admin, quote.id, {
      customerId: stripeObjectId(session.customer),
      subscriptionId: stripeObjectId(session.subscription),
      sessionId: session.id,
      periodEnd: typeof session.subscription === 'object' ? subscriptionPeriodEnd(session.subscription) : null,
    })
    return true
  } catch (error) {
    console.error('confirmSubscriptionCheckout', error instanceof Error ? error.message : error)
    return false
  }
}

export { formatDay as formatQuoteDay, formatEuro as formatQuoteEuro }
