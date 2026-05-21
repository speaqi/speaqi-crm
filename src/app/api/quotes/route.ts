import { NextRequest } from 'next/server'
import { createActivities } from '@/lib/server/crm'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import {
  DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
  DEFAULT_CONTRACT_TERMS,
  buildPublicToken,
  buildQuoteNumber,
  calculateQuoteTotals,
  currencyCode,
  normalizeNumber,
  normalizePaymentMethod,
  normalizeQuoteItems,
  normalizeStatus,
  normalizeText,
} from '@/lib/server/quotes'
import { requireRouteUser } from '@/lib/server/supabase'

const CONTACT_SELECT_BASE = 'id, name, email, company, phone, status, responsible, assigned_agent'
const CONTACT_SELECT_BILLING =
  'id, name, email, company, phone, status, responsible, assigned_agent, billing_tax_id, billing_pec, billing_sdi'

async function readContactForQuote(
  supabase: any,
  userId: string,
  contactId: string,
  responsible?: string | null
) {
  const selectContact = async (selectClause: string) => {
    let query = supabase.from('contacts').select(selectClause).eq('user_id', userId).eq('id', contactId)

    if (responsible) {
      const assigneeOr = contactAssigneeMatchOrFilter(responsible)
      if (assigneeOr) query = query.or(assigneeOr)
    }

    return await query.maybeSingle()
  }

  const first = await selectContact(CONTACT_SELECT_BILLING)
  if (!first.error) return first.data || null

  if (isMissingContactBillingColumnError(first.error)) {
    const retry = await selectContact(CONTACT_SELECT_BASE)
    if (retry.error) throw retry.error
    return retry.data || null
  }

  throw first.error
}

function normalizeQuoteRow(row: any) {
  return {
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
    items: Array.isArray(row.items) ? row.items : [],
  }
}

type OptionalQuoteColumn = 'customer_pec' | 'customer_sdi'

function isMissingContactBillingColumnError(error: unknown) {
  const message = errorText(error)
  return (
    (message.includes('billing_tax_id') || message.includes('billing_pec') || message.includes('billing_sdi')) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message.toLowerCase()
  if (error && typeof error === 'object') {
    if ('message' in error && (error as { message?: unknown }).message) {
      return String((error as { message?: unknown }).message).toLowerCase()
    }
    if ('details' in error && (error as { details?: unknown }).details) {
      return String((error as { details?: unknown }).details).toLowerCase()
    }
    if ('hint' in error && (error as { hint?: unknown }).hint) {
      return String((error as { hint?: unknown }).hint).toLowerCase()
    }
  }
  return ''
}

function isMissingOptionalQuoteColumn(error: unknown, column: OptionalQuoteColumn) {
  const message = errorText(error)
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function buildQuotePayloadFallback(payload: Record<string, unknown>, error: unknown) {
  const fallback = { ...payload }
  let changed = false

  if (isMissingOptionalQuoteColumn(error, 'customer_pec')) {
    delete fallback.customer_pec
    changed = true
  }
  if (isMissingOptionalQuoteColumn(error, 'customer_sdi')) {
    delete fallback.customer_sdi
    changed = true
  }

  return changed ? fallback : null
}

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

async function fetchQuoteById(supabase: any, userId: string, id: string) {
  const selectQuote = async (selectClause: string) =>
    await supabase
      .from('quotes')
      .select(selectClause)
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle()

  const first = await selectQuote(`*, contact:contacts(${CONTACT_SELECT_BILLING})`)
  if (!first.error) return first.data || null

  if (isMissingContactBillingColumnError(first.error)) {
    const retry = await selectQuote(`*, contact:contacts(${CONTACT_SELECT_BASE})`)
    if (retry.error) throw retry.error
    return retry.data || null
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

    const customerName =
      normalizeText(body.customer_name) ||
      normalizeText(contact?.name) ||
      normalizeText(contact?.company)
    const title = normalizeText(body.title) || 'Preventivo Speaqi'
    const items = normalizeQuoteItems(body.items)

    if (!customerName) {
      return Response.json({ error: 'Nome cliente obbligatorio' }, { status: 400 })
    }
    if (!items.length) {
      return Response.json({ error: 'Aggiungi almeno una riga offerta' }, { status: 400 })
    }

    const totals = calculateQuoteTotals(items, {
      discountAmount: normalizeNumber(body.discount_amount, 0),
      taxRate: normalizeNumber(body.tax_rate, 22),
      depositPercent: normalizeNumber(body.deposit_percent, 30),
    })
    const status = normalizeStatus(body.status, 'sent')
    const now = new Date().toISOString()

    const insertPayload = {
      user_id: auth.workspaceUserId,
      contact_id: contact?.id || null,
      quote_number: normalizeText(body.quote_number) || buildQuoteNumber(),
      public_token: buildPublicToken(),
      status,
      title,
      customer_name: customerName,
      customer_email: normalizeText(body.customer_email) || normalizeText(contact?.email),
      customer_company: normalizeText(body.customer_company) || normalizeText(contact?.company),
      customer_tax_id: normalizeText(body.customer_tax_id) || normalizeText(contact?.billing_tax_id),
      customer_pec: normalizeText(body.customer_pec) || normalizeText(contact?.billing_pec),
      customer_sdi: normalizeText(body.customer_sdi) || normalizeText(contact?.billing_sdi),
      customer_address: normalizeText(body.customer_address),
      items,
      currency: currencyCode(body.currency),
      ...totals,
      payment_method: normalizePaymentMethod(body.payment_method),
      payment_state: totals.deposit_amount > 0 ? 'pending' : 'waived',
      bank_transfer_instructions:
        normalizeText(body.bank_transfer_instructions) || DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
      contract_auto_accepted: false,
      contract_terms: normalizeText(body.contract_terms) || DEFAULT_CONTRACT_TERMS,
      contract_accepted_at: null,
      valid_until: normalizeText(body.valid_until),
      public_note: normalizeText(body.public_note),
      internal_note: normalizeText(body.internal_note),
      sent_at: status === 'draft' ? null : now,
      accepted_at: now,
      paid_at: status === 'paid' ? now : null,
    }

    let insertedId: string | null = null
    let insertError: unknown = null

    const firstInsert = await auth.supabase
      .from('quotes')
      .insert(insertPayload)
      .select('id')
      .single()

    if (!firstInsert.error) {
      insertedId = firstInsert.data?.id || null
    } else {
      const fallbackPayload = buildQuotePayloadFallback(insertPayload, firstInsert.error)
      if (fallbackPayload) {
        const retry = await auth.supabase
          .from('quotes')
          .insert(fallbackPayload)
          .select('id')
          .single()

        insertedId = retry.data?.id || null
        insertError = retry.error
      } else {
        insertError = firstInsert.error
      }
    }

    if (insertError) throw insertError
    if (!insertedId) throw new Error('Impossibile creare il preventivo')

    const data = await fetchQuoteById(auth.supabase, auth.workspaceUserId, insertedId)
    if (!data) throw new Error('Preventivo non trovato dopo la creazione')

    if (contact?.id) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: contact.id,
          type: 'system',
          content: `Preventivo ${data.quote_number} creato: ${data.total_amount} ${data.currency}.`,
          metadata: {
            quote_id: data.id,
            quote_number: data.quote_number,
            quote_total: data.total_amount,
          },
        },
      ])
    }

    return Response.json({ quote: normalizeQuoteRow(data) }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile creare il preventivo') }, { status: 500 })
  }
}
