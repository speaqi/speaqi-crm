import { NextRequest } from 'next/server'
import { createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import {
  DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
  DEFAULT_CONTRACT_TERMS,
  calculateQuoteTotals,
  currencyCode,
  normalizeNumber,
  normalizePaymentMethod,
  normalizeQuoteItems,
  normalizeStatus,
  normalizeText,
} from '@/lib/server/quotes'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

function normalizeQuoteRow(row: any) {
  return {
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
    items: Array.isArray(row.items) ? row.items : [],
  }
}

async function readQuote(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, contact:contacts(id, name, email, company, phone, status, responsible, assigned_agent)')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data || null
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
      depositPercent:
        body.deposit_percent !== undefined
          ? normalizeNumber(body.deposit_percent, 30)
          : Number(current.deposit_percent || 30),
    })

    const nextStatus = normalizeStatus(body.status, current.status)
    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      title: body.title !== undefined ? normalizeText(body.title) || current.title : current.title,
      customer_name:
        body.customer_name !== undefined
          ? normalizeText(body.customer_name) || current.customer_name
          : current.customer_name,
      customer_email:
        body.customer_email !== undefined ? normalizeText(body.customer_email) : current.customer_email,
      customer_company:
        body.customer_company !== undefined ? normalizeText(body.customer_company) : current.customer_company,
      customer_tax_id:
        body.customer_tax_id !== undefined ? normalizeText(body.customer_tax_id) : current.customer_tax_id,
      customer_address:
        body.customer_address !== undefined ? normalizeText(body.customer_address) : current.customer_address,
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

    const { data, error } = await auth.supabase
      .from('quotes')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*, contact:contacts(id, name, email, company, phone, status, responsible, assigned_agent)')
      .single()

    if (error) throw error

    if (data.contact_id && current.status !== data.status) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: data.contact_id,
          type: 'system',
          content: `Preventivo ${data.quote_number}: stato ${current.status} -> ${data.status}.`,
          metadata: {
            quote_id: data.id,
            previous_status: current.status,
            next_status: data.status,
          },
        },
      ])
    }

    return Response.json({ quote: normalizeQuoteRow(data) })
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
