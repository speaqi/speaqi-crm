import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { quoteDraftFromPackage, SPEAQI_PACKAGES } from '@/lib/speaqi-quote-packages'
import { errorMessage } from '@/lib/server/http'
import { QuoteInputError, createQuoteRecord } from '@/lib/server/quote-create'
import { buildQuoteAcceptanceToken } from '@/lib/server/quotes'
import {
  SALES_LINK_DEDUP_MINUTES,
  SALES_LINK_HOURLY_LIMIT,
  findOrCreateSalesContact,
  parseSalesQuotePayload,
  resolveSalesLink,
} from '@/lib/server/sales-links'
import { createServiceRoleClient } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ token: string }>
}

function signingPath(publicToken: string, acceptanceToken: string) {
  return `/preventivo?id=${encodeURIComponent(publicToken)}&accept=${encodeURIComponent(acceptanceToken)}`
}

/**
 * Il commerciale, dal suo link e senza login, crea il preventivo davanti al
 * cliente e passa subito alla pagina di firma e pagamento. Nessuna email: il
 * token di accettazione va nel link che si apre sul suo dispositivo.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const admin = createServiceRoleClient()
    const link = await resolveSalesLink(admin, token)
    if (!link) return Response.json({ error: 'Link non valido o revocato' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = parseSalesQuotePayload(body)
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
    const payload = parsed.value

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await admin
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('sales_team_member_id', link.member.id)
      .gte('created_at', hourAgo)
    if (countError) throw countError
    if ((count || 0) >= SALES_LINK_HOURLY_LIMIT) {
      return Response.json({ error: 'Troppi preventivi in un’ora da questo link: riprova più tardi' }, { status: 429 })
    }

    // Doppio clic o modulo reinviato: stesso cliente e pacchetto, ancora da firmare.
    const packageDef = SPEAQI_PACKAGES[payload.packageKey]
    const recent = new Date(Date.now() - SALES_LINK_DEDUP_MINUTES * 60 * 1000).toISOString()
    const { data: duplicate } = await admin
      .from('quotes')
      .select('public_token, quote_acceptance_token, contract_signer_name, title')
      .eq('sales_team_member_id', link.member.id)
      .eq('customer_email', payload.email)
      .eq('title', packageDef.quoteTitle)
      .eq('status', 'sent')
      .gte('created_at', recent)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (duplicate?.quote_acceptance_token && !duplicate.contract_signer_name) {
      return Response.json({ url: signingPath(duplicate.public_token, duplicate.quote_acceptance_token), reused: true })
    }

    const contact = await findOrCreateSalesContact(admin, link.userId, link.member.name, payload)
    const acceptanceToken = buildQuoteAcceptanceToken()
    const quote = await createQuoteRecord(
      admin,
      link.userId,
      contact,
      {
        ...quoteDraftFromPackage(payload.packageKey, randomUUID()),
        status: 'sent',
        customer_name: payload.contactName,
        customer_email: payload.email,
        customer_company: payload.company,
        customer_tax_id: payload.taxId,
        customer_pec: payload.pec,
        customer_sdi: payload.sdi,
        customer_address: payload.address,
        customer_zip: payload.zip,
        customer_city: payload.city,
      },
      {
        salesTeamMemberId: link.member.id,
        acceptanceToken,
        acceptanceEmail: payload.email,
        activityContent: `Preventivo "${packageDef.quoteTitle}" creato in presenza da ${link.member.name} (link vendita).`,
      }
    )

    await admin.from('sales_links').update({ last_used_at: new Date().toISOString() }).eq('id', link.id)

    return Response.json({ url: signingPath(quote.public_token, acceptanceToken) }, { status: 201 })
  } catch (error) {
    if (error instanceof QuoteInputError) return Response.json({ error: error.message }, { status: 400 })
    return Response.json({ error: errorMessage(error, 'Impossibile creare il preventivo') }, { status: 500 })
  }
}
