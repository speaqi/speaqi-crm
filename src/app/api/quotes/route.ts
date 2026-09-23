import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import {
  CONTACT_SELECT_BASE,
  CONTACT_SELECT_BILLING,
  QuoteInputError,
  createQuoteRecord,
  isMissingContactBillingColumnError,
  normalizeQuoteRow,
  readContactForQuote,
} from '@/lib/server/quote-create'
import { normalizeText } from '@/lib/server/quotes'
import { requireRouteUser } from '@/lib/server/supabase'

async function fetchQuotesForWorkspace(supabase: any, userId: string) {
  const selectQuotes = async (selectClause: string) =>
    await supabase
      .from('quotes')
      .select(selectClause)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

  const first = await selectQuotes(`*, contact:contacts(${CONTACT_SELECT_BILLING})`)
  if (!first.error) return first.data || []

  if (isMissingContactBillingColumnError(first.error)) {
    const retry = await selectQuotes(`*, contact:contacts(${CONTACT_SELECT_BASE})`)
    if (retry.error) throw retry.error
    return retry.data || []
  }

  throw first.error
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const quotes = await fetchQuotesForWorkspace(auth.supabase, auth.workspaceUserId)
    return Response.json({ quotes: quotes.map(normalizeQuoteRow) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare i preventivi') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const contactId = normalizeText(body.contact_id)
    const contact = contactId
      ? await readContactForQuote(
          auth.supabase,
          auth.workspaceUserId,
          contactId,
          auth.isAdmin ? null : auth.memberName || null
        )
      : null

    if (contactId && !contact) {
      return Response.json({ error: 'Contatto non trovato o non assegnato a te' }, { status: 404 })
    }

    const quote = await createQuoteRecord(auth.supabase, auth.workspaceUserId, contact, body)
    return Response.json({ quote }, { status: 201 })
  } catch (error) {
    if (error instanceof QuoteInputError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: errorMessage(error, 'Impossibile creare il preventivo') }, { status: 500 })
  }
}
