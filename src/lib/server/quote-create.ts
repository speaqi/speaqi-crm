import { createActivities } from '@/lib/server/crm'
import { getOpenDeal } from '@/lib/server/deal-ops'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import {
  DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
  DEFAULT_CONTRACT_TERMS,
  applyBillingRules,
  buildPublicToken,
  buildQuoteNumber,
  calculateQuoteTotals,
  currencyCode,
  normalizeNumber,
  normalizePaymentMethod,
  normalizePaymentTermsMode,
  normalizeQuoteItems,
  normalizeStatus,
  normalizeText,
} from '@/lib/server/quotes'

/**
 * Creazione di un preventivo, condivisa fra POST /api/quotes (utente loggato)
 * e /vendita (link del commerciale, client service role). Il client passato
 * decide i permessi; `extra` porta i campi che solo il server puo' scrivere.
 */

export class QuoteInputError extends Error {}

export const CONTACT_SELECT_BASE = 'id, name, email, company, phone, status, responsible, assigned_agent'
export const CONTACT_SELECT_BILLING =
  'id, name, email, company, phone, status, responsible, assigned_agent, billing_tax_id, billing_pec, billing_sdi, billing_address, billing_zip, billing_city'

export async function readContactForQuote(
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

export function normalizeQuoteRow(row: any) {
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

export function isMissingContactBillingColumnError(error: unknown) {
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

export function buildQuotePayloadFallback(payload: Record<string, unknown>, error: unknown) {
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

export async function fetchQuoteById(supabase: any, userId: string, id: string) {
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


export type CreateQuoteExtra = {
  salesTeamMemberId?: string | null
  acceptanceToken?: string | null
  acceptanceEmail?: string | null
  activityContent?: string | null
}

export async function createQuoteRecord(
  supabase: any,
  workspaceUserId: string,
  contact: any | null,
  rawBody: Record<string, any>,
  extra: CreateQuoteExtra = {}
) {
  const body = applyBillingRules(rawBody)
  const customerName =
    normalizeText(body.customer_name) ||
    normalizeText(contact?.name) ||
    normalizeText(contact?.company)
  const title = normalizeText(body.title) || 'Preventivo Speaqi'
  const items = normalizeQuoteItems(body.items)

  if (!customerName) throw new QuoteInputError('Nome cliente obbligatorio')
  if (!items.length) throw new QuoteInputError('Aggiungi almeno una riga offerta')

  const totals = calculateQuoteTotals(items, {
    discountAmount: normalizeNumber(body.discount_amount, 0),
    taxRate: normalizeNumber(body.tax_rate, 22),
    paymentTermsMode: normalizePaymentTermsMode(body.payment_terms_mode, 'percent'),
    depositPercent: normalizeNumber(body.deposit_percent, 30),
    depositManualAmount: normalizeNumber(body.deposit_manual_amount, 0),
  })
  const status = normalizeStatus(body.status, 'sent')
  const now = new Date().toISOString()

  const insertPayload: Record<string, unknown> = {
    user_id: workspaceUserId,
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
    customer_address: normalizeText(body.customer_address) || normalizeText(contact?.billing_address),
    customer_zip: normalizeText(body.customer_zip) || normalizeText(contact?.billing_zip),
    customer_city: normalizeText(body.customer_city) || normalizeText(contact?.billing_city),
    items,
    currency: currencyCode(body.currency),
    ...totals,
    payment_method: normalizePaymentMethod(body.payment_method),
    payment_state: totals.deposit_amount > 0 ? 'pending' : 'waived',
    payment_terms_note: normalizeText(body.payment_terms_note),
    bank_transfer_instructions:
      normalizeText(body.bank_transfer_instructions) || DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
    contract_auto_accepted: false,
    contract_terms: normalizeText(body.contract_terms) || DEFAULT_CONTRACT_TERMS,
    contract_accepted_at: null,
    valid_until: normalizeText(body.valid_until),
    public_note: normalizeText(body.public_note),
    internal_note: normalizeText(body.internal_note),
    sent_at: status === 'draft' ? null : now,
    accepted_at: status === 'accepted' || status === 'paid' ? now : null,
    paid_at: status === 'paid' ? now : null,
  }

  // Solo quando serve: un preventivo una tantum non deve dipendere dalla
  // migration dell'abbonamento per poter essere creato.
  if (body.billing_interval === 'year') insertPayload.billing_interval = 'year'
  if (extra.salesTeamMemberId) insertPayload.sales_team_member_id = extra.salesTeamMemberId
  if (extra.acceptanceToken) {
    insertPayload.quote_acceptance_token = extra.acceptanceToken
    insertPayload.quote_acceptance_email = extra.acceptanceEmail || insertPayload.customer_email || null
  }

  let insertedId: string | null = null
  let insertError: unknown = null

  const firstInsert = await supabase
    .from('quotes')
    .insert(insertPayload)
    .select('id')
    .single()

  if (!firstInsert.error) {
    insertedId = firstInsert.data?.id || null
  } else {
    const fallbackPayload = buildQuotePayloadFallback(insertPayload, firstInsert.error)
    if (fallbackPayload) {
      const retry = await supabase
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

  // Aggancia il preventivo alla trattativa aperta del contatto (best-effort:
  // se la tabella deals o la colonna deal_id non esistono ancora, si ignora).
  if (contact?.id) {
    try {
      const openDeal = await getOpenDeal(supabase, workspaceUserId, contact.id)
      if (openDeal) {
        await supabase
          .from('quotes')
          .update({ deal_id: openDeal.id })
          .eq('user_id', workspaceUserId)
          .eq('id', insertedId)
      }
    } catch {
      // colonna/tabella non ancora migrata: il preventivo resta senza deal_id
    }
  }

  const data = await fetchQuoteById(supabase, workspaceUserId, insertedId)
  if (!data) throw new Error('Preventivo non trovato dopo la creazione')

  if (contact?.id) {
    await createActivities(supabase, [
      {
        user_id: workspaceUserId,
        contact_id: contact.id,
        type: 'system',
        content:
          extra.activityContent ||
          `Preventivo ${data.quote_number} creato: ${data.total_amount} ${data.currency}.`,
        metadata: {
          quote_id: data.id,
          quote_number: data.quote_number,
          quote_total: data.total_amount,
        },
      },
    ])
  }

  return normalizeQuoteRow(data)
}
