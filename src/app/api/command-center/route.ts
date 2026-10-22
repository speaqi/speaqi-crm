import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { loadMapsStatus } from '@/lib/server/maps-status'
import { buildWaiting, countMapStages, summarizeMoney, type MoneyInvoice, type MoneyQuote } from '@/lib/command-center'

/**
 * GET: la prima pagina del titolare. Cosa aspetta lui, i soldi del mese, le
 * trattative aperte e a che punto sono le mappe. Una fonte che non risponde
 * (le mappe stanno fuori dal CRM) non toglie le altre.
 */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  try {
    const [quotesRes, invoicesRes, presentationsRes, decksRes, dealsRes, maps] = await Promise.all([
      admin
        .from('quotes')
        .select('id, quote_number, title, customer_name, customer_company, contact_id, status, payment_state, total_amount, paid_at, billing_interval, subscription_status, current_period_end, cancel_at_period_end, sent_at')
        .eq('user_id', userId)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(1000),
      admin
        .from('invoices')
        .select('id, quote_id, source, status, totale, numero, customer, sent_at, warnings, last_error')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500),
      admin.from('agency_presentations').select('id, title, status, project:agency_projects(title)').eq('user_id', userId).eq('status', 'ready').limit(20),
      admin.from('tourism_decks').select('id, title, status, destination').eq('user_id', userId).eq('status', 'ready').limit(20),
      admin.from('deals').select('id, stage, value').eq('user_id', userId).is('closed_at', null).limit(2000),
      loadMapsStatus(),
    ])
    if (quotesRes.error) throw quotesRes.error
    if (invoicesRes.error) throw invoicesRes.error

    const quotes = (quotesRes.data || []) as Array<MoneyQuote & { sent_at?: string | null }>
    const invoices = (invoicesRes.data || []) as MoneyInvoice[]
    const money = summarizeMoney(quotes, invoices)

    const waiting = buildWaiting({
      invoices: invoices as any,
      // Agency e Tourism sono moduli a parte: se le tabelle non si leggono, la pagina resta in piedi.
      presentations: (presentationsRes.data || []).map((p: any) => ({ id: p.id, title: p.title, status: p.status, project_title: p.project?.title || null })),
      decks: (decksRes.data || []) as any,
      pastDue: money.past_due,
      toInvoiceCount: money.to_invoice_count,
    })

    const stages = new Map<string, { stage: string; count: number; value: number }>()
    for (const deal of dealsRes.data || []) {
      const row = stages.get(deal.stage) || { stage: deal.stage, count: 0, value: 0 }
      row.count += 1
      row.value += Number(deal.value) || 0
      stages.set(deal.stage, row)
    }
    const awaitingSignature = quotes.filter((q) => q.status === 'sent').map((q) => ({
      id: q.id,
      label: q.customer_company || q.customer_name || q.quote_number,
      amount: Number(q.total_amount) || 0,
      sent_at: q.sent_at || null,
      contact_id: q.contact_id || null,
    }))

    return Response.json({
      waiting,
      money,
      sales: {
        open_deals: (dealsRes.data || []).length,
        by_stage: Array.from(stages.values()).sort((a, b) => b.count - a.count),
        awaiting_signature: awaitingSignature.slice(0, 6),
        awaiting_signature_count: awaitingSignature.length,
        awaiting_signature_amount: awaitingSignature.reduce((sum, q) => sum + Math.round(q.amount * 100), 0) / 100,
      },
      maps: { counts: countMapStages(maps.rows), rows: maps.rows, sources: maps.sources },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare la prima pagina') }, { status: 500 })
  }
}
