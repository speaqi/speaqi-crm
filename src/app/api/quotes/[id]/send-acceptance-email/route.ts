import { NextRequest } from 'next/server'
import { sendQuoteAcceptanceRequestEmail } from '@/lib/email'
import { createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import {
  buildQuoteAcceptanceToken,
  normalizeText,
  publicQuoteUrl,
  quoteAcceptanceUrl,
} from '@/lib/server/quotes'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function requestOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')

  try {
    const url = new URL(request.url)
    const host = url.hostname.toLowerCase()
    const isLocalHost =
      host === '0.0.0.0' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.')

    if (url.origin && url.origin !== 'null' && !isLocalHost) return url.origin
  } catch {
    // fall through
  }

  return 'https://crm.speaqi.com'
}

function missingAcceptanceColumns(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '').toLowerCase()
        : ''

  return (
    (message.includes('quote_acceptance_email') ||
      message.includes('quote_acceptance_token') ||
      message.includes('quote_acceptance_sent_at')) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const explicitEmail = normalizeText((body as { email?: unknown }).email)

    const { data: quote, error: readError } = await auth.supabase
      .from('quotes')
      .select('id, user_id, contact_id, quote_number, public_token, status, title, customer_name, customer_email, customer_company')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .maybeSingle()

    if (readError) throw readError
    if (!quote) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })
    if (quote.status === 'cancelled') {
      return Response.json({ error: 'Non puoi inviare un preventivo annullato' }, { status: 400 })
    }

    const recipient = String(explicitEmail || quote.customer_email || '').trim().toLowerCase()
    if (!isEmail(recipient)) {
      return Response.json({ error: 'Imposta un’email cliente valida prima di inviare il preventivo' }, { status: 400 })
    }

    const acceptanceToken = buildQuoteAcceptanceToken()
    const prepare = await auth.supabase
      .from('quotes')
      .update({
        customer_email: recipient,
        quote_acceptance_email: recipient,
        quote_acceptance_token: acceptanceToken,
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .single()

    if (prepare.error) {
      if (missingAcceptanceColumns(prepare.error)) {
        return Response.json(
          {
            error:
              'Il database non ha ancora le colonne per l’accettazione via email. Applica la migration Supabase più recente e riprova.',
          },
          { status: 500 }
        )
      }
      throw prepare.error
    }

    const origin = requestOrigin(request)
    const publicUrl = publicQuoteUrl(origin, quote.public_token)
    const acceptanceUrl = quoteAcceptanceUrl(origin, quote.public_token, acceptanceToken)

    await sendQuoteAcceptanceRequestEmail(recipient, {
      quoteNumber: String(quote.quote_number || ''),
      title: String(quote.title || 'Preventivo Speaqi'),
      customerName: String(quote.customer_company || quote.customer_name || ''),
      publicUrl,
      acceptanceUrl,
    })

    const sentAt = new Date().toISOString()
    const sentUpdate = await auth.supabase
      .from('quotes')
      .update({
        quote_acceptance_sent_at: sentAt,
        status: quote.status === 'draft' ? 'sent' : quote.status,
        sent_at: sentAt,
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (sentUpdate.error) throw sentUpdate.error

    if (quote.contact_id) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: quote.contact_id,
          type: 'email_sent',
          content: `Preventivo ${quote.quote_number} inviato per accettazione a ${recipient}.`,
          metadata: {
            quote_id: quote.id,
            quote_number: quote.quote_number,
            recipient,
          },
        },
      ])
    }

    return Response.json({
      success: true,
      sent_at: sentAt,
      quote_acceptance_email: recipient,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile inviare il preventivo') }, { status: 500 })
  }
}
