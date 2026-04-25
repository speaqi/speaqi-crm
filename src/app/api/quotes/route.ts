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

async function readContactForQuote(
  supabase: any,
  userId: string,
  contactId: string,
  responsible?: string | null
) {
  let query = supabase
    .from('contacts')
    .select('id, name, email, company, phone, status, responsible, assigned_agent')
    .eq('user_id', userId)
    .eq('id', contactId)

  if (responsible) {
    const assigneeOr = contactAssigneeMatchOrFilter(responsible)
    if (assigneeOr) query = query.or(assigneeOr)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data || null
}

function normalizeQuoteRow(row: any) {
  return {
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
    items: Array.isArray(row.items) ? row.items : [],
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('quotes')
      .select(
        '*, contact:contacts(id, name, email, company, phone, status, responsible, assigned_agent)'
      )
      .eq('user_id', auth.workspaceUserId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return Response.json({ quotes: (data || []).map(normalizeQuoteRow) })
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
      customer_tax_id: normalizeText(body.customer_tax_id),
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

    const { data, error } = await auth.supabase
      .from('quotes')
      .insert(insertPayload)
      .select('*, contact:contacts(id, name, email, company, phone, status, responsible, assigned_agent)')
      .single()

    if (error) throw error

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
