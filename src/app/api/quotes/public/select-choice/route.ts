import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { calculateQuoteTotals, normalizeQuoteItems } from '@/lib/server/quotes'
import { createServiceRoleClient } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const token = String(body?.token || '').trim()
    const groupId = String(body?.group_id || '').trim()
    const itemId = String(body?.item_id || '').trim()
    if (!token || !groupId || !itemId) {
      return Response.json({ error: 'Scelta non valida' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    const { data: quote, error: readError } = await supabase
      .from('quotes')
      .select('*')
      .eq('public_token', token)
      .maybeSingle()
    if (readError) throw readError
    if (!quote || quote.status === 'cancelled') {
      return Response.json({ error: 'Preventivo non trovato' }, { status: 404 })
    }
    if (quote.status === 'accepted' || quote.status === 'paid' || quote.contract_signer_email) {
      return Response.json({ error: 'Il preventivo è già stato accettato e non può essere modificato' }, { status: 409 })
    }

    const items = normalizeQuoteItems(quote.items)
    const choiceExists = items.some((item) => item.choice_group_id === groupId && item.id === itemId)
    if (!choiceExists) return Response.json({ error: 'Alternativa non trovata' }, { status: 404 })

    const selectedItems = items.map((item) =>
      item.choice_group_id === groupId ? { ...item, selected: item.id === itemId } : item
    )
    const totals = calculateQuoteTotals(selectedItems, {
      discountAmount: Number(quote.discount_amount || 0),
      taxRate: Number(quote.tax_rate || 0),
      paymentTermsMode: quote.payment_terms_mode,
      depositPercent: Number(quote.deposit_percent || 0),
      depositManualAmount: Number(quote.deposit_manual_amount || 0),
    })
    const { data: updatedQuote, error: updateError } = await supabase
      .from('quotes')
      .update({ items: selectedItems, ...totals })
      .eq('id', quote.id)
      .eq('public_token', token)
      .not('status', 'in', '(accepted,paid,cancelled)')
      .is('contract_signer_email', null)
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updatedQuote) {
      return Response.json(
        { error: 'Il preventivo è stato accettato o annullato e non può più essere modificato' },
        { status: 409 }
      )
    }

    return Response.json({ success: true, totals })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare la scelta') }, { status: 500 })
  }
}
