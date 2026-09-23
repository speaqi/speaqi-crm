import { NextRequest } from 'next/server'
import { sendQuoteContractAcceptanceEmail } from '@/lib/email'
import { errorMessage } from '@/lib/server/http'
import { clientIp, parseSignPayload, signatureTermsMeta } from '@/lib/server/quote-signature'
import { createServiceRoleClient } from '@/lib/server/supabase'

function parseRpcJsonb(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data) as unknown
  } catch {
    return data
  }
}

function absolutePublicUrl(request: NextRequest, token: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin
  return `${base}/preventivo?id=${encodeURIComponent(token)}`
}

/**
 * Firma disegnata. Stesso cancello dell'accettazione con spunta: servono il
 * token pubblico e quello di accettazione (dall'email, o dal link vendita
 * aperto davanti al cliente). IP e user-agent li legge il server: per questo
 * la RPC e' eseguibile solo dal service role.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const admin = createServiceRoleClient()

    const token = String(body?.token || '').trim()
    const { data: billing } = token
      ? await admin.from('quotes').select('billing_interval').eq('public_token', token).maybeSingle()
      : { data: null }

    const parsed = parseSignPayload(body, { requireRenewalClause: billing?.billing_interval === 'year' })
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    const { data, error } = await admin.rpc('sign_public_quote_contract', {
      p_public_token: input.token,
      p_acceptance_token: input.acceptanceToken,
      p_signer_name: input.signerName,
      p_signature_png: input.signaturePng,
      p_ip: clientIp(request.headers),
      p_user_agent: (request.headers.get('user-agent') || '').slice(0, 500),
      p_terms_meta: signatureTermsMeta(input.renewalAccepted),
    })
    if (error) return Response.json({ error: errorMessage(error, 'Firma non registrata') }, { status: 500 })

    const row = parseRpcJsonb(data) as {
      ok?: boolean
      error?: string
      already?: boolean
      quote_number?: string
      customer_name?: string
      title?: string
      signer_email?: string
    } | null

    if (!row?.ok) {
      if (row?.error === 'not_found') return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })
      if (row?.error === 'invalid_acceptance_token') {
        return Response.json({ error: 'Link di firma non valido. Usa il link completo ricevuto dal team Speaqi.' }, { status: 403 })
      }
      return Response.json({ error: 'Firma non registrata' }, { status: 400 })
    }

    // La conferma via email da' al cliente una copia e lo avvisa se qualcun
    // altro ha firmato al posto suo. Una mail che non parte non annulla la firma.
    let warning: string | undefined
    if (!row.already && row.signer_email) {
      try {
        await sendQuoteContractAcceptanceEmail(String(row.signer_email), {
          quoteNumber: String(row.quote_number || ''),
          title: String(row.title || 'Preventivo Speaqi'),
          customerName: String(row.customer_name || ''),
          publicUrl: absolutePublicUrl(request, input.token),
        })
      } catch (mailError) {
        const detail = mailError instanceof Error ? mailError.message : 'unknown'
        console.error('quote sign: Resend', detail)
        warning = 'Firma registrata; l’email di conferma non è partita.'
      }
    }

    return Response.json({
      success: true,
      already: Boolean(row.already),
      quote_number: row.quote_number,
      signer_email: row.signer_email,
      ...(warning ? { warning } : {}),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Firma non registrata') }, { status: 500 })
  }
}
