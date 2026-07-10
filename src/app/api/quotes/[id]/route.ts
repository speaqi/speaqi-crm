import { NextRequest } from 'next/server'
import { completePendingCallTasks, createActivities } from '@/lib/server/crm'
import { syncDealWithContactStatus } from '@/lib/server/deal-ops'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import {
  DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
  DEFAULT_CONTRACT_TERMS,
  calculateQuoteTotals,
  currencyCode,
  normalizeNumber,
  normalizePaymentMethod,
  normalizePaymentTermsMode,
  normalizeQuoteItems,
  normalizeStatus,
  normalizeText,
} from '@/lib/server/quotes'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

const CONTACT_SELECT_BASE = 'id, name, email, company, phone, status, responsible, assigned_agent'
const CONTACT_SELECT_BILLING =
  'id, name, email, company, phone, status, responsible, assigned_agent, billing_tax_id, billing_pec, billing_sdi, billing_address, billing_zip, billing_city'

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

type OptionalQuoteColumn =
  | 'customer_pec'
  | 'customer_sdi'
  | 'customer_zip'
  | 'customer_city'

const OPTIONAL_QUOTE_COLUMNS: OptionalQuoteColumn[] = [
  'customer_pec',
  'customer_sdi',
  'customer_zip',
  'customer_city',
]

type RequiredPaymentTermsColumn = 'payment_terms_mode' | 'deposit_manual_amount' | 'payment_terms_note'

const REQUIRED_PAYMENT_TERMS_COLUMNS: RequiredPaymentTermsColumn[] = [
  'payment_terms_mode',
  'deposit_manual_amount',
  'payment_terms_note',
]

function isMissingContactBillingColumnError(error: unknown) {
  const message = errorText(error)
  return (
    (
      message.includes('billing_tax_id') ||
      message.includes('billing_pec') ||
      message.includes('billing_sdi') ||
      message.includes('billing_address') ||
      message.includes('billing_zip') ||
      message.includes('billing_city')
    ) &&
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

function hasOptionalQuoteColumnSchemaError(error: unknown) {
  return OPTIONAL_QUOTE_COLUMNS.some((column) => isMissingOptionalQuoteColumn(error, column))
}

function hasMissingPaymentTermsSchemaError(error: unknown) {
  return REQUIRED_PAYMENT_TERMS_COLUMNS.some((column) => {
    const message = errorText(error)
    return (
      message.includes(column) &&
      (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
    )
  })
}

function stripOptionalQuoteColumns(payload: Record<string, unknown>) {
  const fallback = { ...payload }
  OPTIONAL_QUOTE_COLUMNS.forEach((column) => {
    delete fallback[column]
  })
  return fallback
}

function buildQuotePayloadFallback(payload: Record<string, unknown>, error: unknown) {
  const fallback = { ...payload }
  let changed = false

  if (hasMissingPaymentTermsSchemaError(error)) {
    throw new Error(
      'Il database non ha ancora le colonne per le condizioni di pagamento manuali. Applica la migration Supabase più recente e riprova.'
    )
  }

  if (hasOptionalQuoteColumnSchemaError(error)) {
    return stripOptionalQuoteColumns(fallback)
  }

  return changed ? fallback : null
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

async function readQuote(supabase: any, userId: string, id: string) {
  return await fetchQuoteById(supabase, userId, id)
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const quote = await readQuote(auth.supabase, auth.workspaceUserId, id)
    if (!quote) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })
    return Response.json({ quote: normalizeQuoteRow(quote) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare il preventivo') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const current = await readQuote(auth.supabase, auth.workspaceUserId, id)
    if (!current) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })

    const body = await request.json()
    const currentContact = Array.isArray(current.contact) ? current.contact[0] : current.contact
    let nextContact = currentContact || null
    let nextContactId = current.contact_id || null
    const contactChanged = body.contact_id !== undefined

    if (contactChanged) {
      nextContactId = normalizeText(body.contact_id)
      nextContact = nextContactId
        ? await readContactForQuote(
            auth.supabase,
            auth.workspaceUserId,
            nextContactId,
            auth.isAdmin ? null : auth.memberName || null
          )
        : null

      if (nextContactId && !nextContact) {
        return Response.json({ error: 'Contatto non trovato o non assegnato a te' }, { status: 404 })
      }
    }

    const items =
      body.items !== undefined
        ? normalizeQuoteItems(body.items)
        : normalizeQuoteItems(current.items)

    if (body.items !== undefined && !items.length) {
      return Response.json({ error: 'Aggiungi almeno una riga offerta' }, { status: 400 })
    }

    const totals = calculateQuoteTotals(items, {
      discountAmount:
        body.discount_amount !== undefined
          ? normalizeNumber(body.discount_amount, 0)
          : Number(current.discount_amount || 0),
      taxRate:
        body.tax_rate !== undefined
          ? normalizeNumber(body.tax_rate, 22)
          : Number(current.tax_rate || 22),
      paymentTermsMode:
        body.payment_terms_mode !== undefined
          ? normalizePaymentTermsMode(body.payment_terms_mode, 'percent')
          : normalizePaymentTermsMode(current.payment_terms_mode, 'percent'),
      depositPercent:
        body.deposit_percent !== undefined
          ? normalizeNumber(body.deposit_percent, 30)
          : Number(current.deposit_percent || 30),
      depositManualAmount:
        body.deposit_manual_amount !== undefined
          ? normalizeNumber(body.deposit_manual_amount, 0)
          : Number(current.deposit_manual_amount || 0),
    })

    const nextStatus = normalizeStatus(body.status, current.status)
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      contact_id: nextContactId,
      title: body.title !== undefined ? normalizeText(body.title) || current.title : current.title,
      customer_name:
        body.customer_name !== undefined
          ? normalizeText(body.customer_name) || current.customer_name
          : contactChanged
            ? normalizeText(nextContact?.name) || current.customer_name
            : current.customer_name,
      customer_email:
        body.customer_email !== undefined
          ? normalizeText(body.customer_email)
          : contactChanged
            ? normalizeText(nextContact?.email) || current.customer_email
            : current.customer_email,
      customer_company:
        body.customer_company !== undefined
          ? normalizeText(body.customer_company)
          : contactChanged
            ? normalizeText(nextContact?.company) || current.customer_company
            : current.customer_company,
      customer_tax_id:
        body.customer_tax_id !== undefined
          ? normalizeText(body.customer_tax_id)
          : contactChanged
            ? normalizeText(nextContact?.billing_tax_id) || current.customer_tax_id
            : current.customer_tax_id,
      customer_pec:
        body.customer_pec !== undefined
          ? normalizeText(body.customer_pec)
          : contactChanged
            ? normalizeText(nextContact?.billing_pec) || current.customer_pec
            : current.customer_pec,
      customer_sdi:
        body.customer_sdi !== undefined
          ? normalizeText(body.customer_sdi)
          : contactChanged
            ? normalizeText(nextContact?.billing_sdi) || current.customer_sdi
            : current.customer_sdi,
      customer_address:
        body.customer_address !== undefined
          ? normalizeText(body.customer_address)
          : contactChanged
            ? normalizeText(nextContact?.billing_address) || current.customer_address
            : current.customer_address,
      customer_zip:
        body.customer_zip !== undefined
          ? normalizeText(body.customer_zip)
          : contactChanged
            ? normalizeText(nextContact?.billing_zip) || current.customer_zip
            : current.customer_zip,
      customer_city:
        body.customer_city !== undefined
          ? normalizeText(body.customer_city)
          : contactChanged
            ? normalizeText(nextContact?.billing_city) || current.customer_city
            : current.customer_city,
      items,
      currency: body.currency !== undefined ? currencyCode(body.currency) : current.currency,
      ...totals,
      status: nextStatus,
      payment_method:
        body.payment_method !== undefined
          ? normalizePaymentMethod(body.payment_method)
          : current.payment_method,
      payment_state:
        nextStatus === 'paid'
          ? 'paid'
          : totals.deposit_amount > 0
            ? current.payment_state || 'pending'
            : 'waived',
      payment_terms_note:
        body.payment_terms_note !== undefined
          ? normalizeText(body.payment_terms_note)
          : current.payment_terms_note,
      bank_transfer_instructions:
        body.bank_transfer_instructions !== undefined
          ? normalizeText(body.bank_transfer_instructions) || DEFAULT_BANK_TRANSFER_INSTRUCTIONS
          : current.bank_transfer_instructions,
      contract_terms:
        body.contract_terms !== undefined
          ? normalizeText(body.contract_terms) || DEFAULT_CONTRACT_TERMS
          : current.contract_terms,
      valid_until: body.valid_until !== undefined ? normalizeText(body.valid_until) : current.valid_until,
      public_note: body.public_note !== undefined ? normalizeText(body.public_note) : current.public_note,
      internal_note: body.internal_note !== undefined ? normalizeText(body.internal_note) : current.internal_note,
      sent_at:
        current.sent_at || (nextStatus === 'draft' ? null : now),
      accepted_at:
        nextStatus === 'accepted' || nextStatus === 'paid'
          ? current.accepted_at || now
          : current.accepted_at,
      paid_at: nextStatus === 'paid' ? current.paid_at || now : current.paid_at,
    }

    let updatedId: string | null = null
    let updateError: unknown = null

    const firstUpdate = await auth.supabase
      .from('quotes')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .single()

    if (!firstUpdate.error) {
      updatedId = firstUpdate.data?.id || null
    } else {
      const fallbackPayload = buildQuotePayloadFallback(updatePayload, firstUpdate.error)
      if (fallbackPayload) {
        const retry = await auth.supabase
          .from('quotes')
          .update(fallbackPayload)
          .eq('user_id', auth.workspaceUserId)
          .eq('id', id)
          .select('id')
          .single()

        updatedId = retry.data?.id || null
        updateError = retry.error
      } else {
        updateError = firstUpdate.error
      }
    }

    if (updateError) throw updateError
    if (!updatedId) throw new Error('Impossibile aggiornare il preventivo')

    const quoteData = await fetchQuoteById(auth.supabase, auth.workspaceUserId, updatedId)
    if (!quoteData) throw new Error('Preventivo non trovato dopo l’aggiornamento')

    if (quoteData.contact_id && current.status !== quoteData.status) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: quoteData.contact_id,
          type: 'system',
          content: `Preventivo ${quoteData.quote_number}: stato ${current.status} -> ${quoteData.status}.`,
          metadata: {
            quote_id: quoteData.id,
            previous_status: current.status,
            next_status: quoteData.status,
          },
        },
      ])
    }

    // Preventivo pagato → il contatto va a Paid e la trattativa si chiude won
    // (prima status contatto e preventivi erano del tutto scollegati).
    if (quoteData.contact_id && current.status !== 'paid' && quoteData.status === 'paid') {
      const nowIso = new Date().toISOString()
      const { data: paidContact } = await auth.supabase
        .from('contacts')
        .update({
          status: 'Paid',
          won_at: nowIso,
          next_followup_at: null,
          next_action_at: null,
        })
        .eq('user_id', auth.workspaceUserId)
        .eq('id', quoteData.contact_id)
        .select('id')
        .maybeSingle()
      if (paidContact) {
        await syncDealWithContactStatus(auth.supabase, auth.workspaceUserId, quoteData.contact_id, 'Paid')
        await completePendingCallTasks(auth.supabase, auth.workspaceUserId, quoteData.contact_id)
      }
    }

    return Response.json({ quote: normalizeQuoteRow(quoteData) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare il preventivo') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const current = await readQuote(auth.supabase, auth.workspaceUserId, id)
    if (!current) return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })

    const { error } = await auth.supabase
      .from('quotes')
      .update({ status: 'cancelled' })
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (error) throw error
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile annullare il preventivo') }, { status: 500 })
  }
}
