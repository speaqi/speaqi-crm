import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { arubaConfigured, arubaEnv } from '@/lib/server/aruba-fe'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { createInvoiceDraftFromQuote, EDITABLE_STATUSES, invoiceProblems, loadInvoiceSettings, type InvoiceRow } from '@/lib/server/invoices'

/**
 * GET: fatture, preventivi ancora da fatturare e stato del collegamento Aruba.
 * POST { quote_id }: bozza di fattura da un preventivo (idempotente).
 */

export async function GET(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error

  try {
    const { admin, userId } = auth
    const [{ settings, saved }, invoicesResult, quotesResult] = await Promise.all([
      loadInvoiceSettings(admin, userId),
      admin
        .from('invoices')
        .select('id, quote_id, contact_id, source, status, year, number, numero, issue_date, customer, lines, payment_method, causale, imponibile, imposta, totale, warnings, aruba_env, aruba_filename, sdi_status, sdi_detail, last_error, sent_at, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(300),
      admin
        .from('quotes')
        .select('id, quote_number, title, customer_name, customer_company, total_amount, status, payment_state, paid_at, accepted_at, billing_interval')
        .eq('user_id', userId)
        .or('status.eq.paid,payment_state.eq.paid,status.eq.accepted')
        .is('invoiced_outside_at', null)
        .order('paid_at', { ascending: false, nullsFirst: false })
        .limit(200),
    ])
    if (invoicesResult.error) throw invoicesResult.error
    if (quotesResult.error) throw quotesResult.error

    const invoices = (invoicesResult.data || []) as InvoiceRow[]
    const invoicedQuotes = new Set(invoices.filter((row) => row.source === 'quote' && row.quote_id).map((row) => row.quote_id))
    const toInvoice = (quotesResult.data || []).filter((quote: any) => !invoicedQuotes.has(quote.id))

    return Response.json({
      invoices: invoices.map((row) => ({
        ...row,
        imponibile: Number(row.imponibile),
        imposta: Number(row.imposta),
        totale: Number(row.totale),
        problems: EDITABLE_STATUSES.includes(row.status) ? invoiceProblems(row, settings) : [],
      })),
      to_invoice: toInvoice,
      aruba: { configured: arubaConfigured(), env: arubaEnv() },
      settings_saved: saved,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le fatture') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const quoteId = String(body.quote_id || '').trim()
    if (!quoteId) return Response.json({ error: 'Scegli il preventivo da fatturare' }, { status: 400 })
    const { invoice, created } = await createInvoiceDraftFromQuote(auth.admin, auth.userId, quoteId)
    return Response.json({ invoice, created }, { status: created ? 201 : 200 })
  } catch (error) {
    const message = errorMessage(error, 'Impossibile preparare la fattura')
    return Response.json({ error: message }, { status: message === 'Preventivo non trovato' ? 404 : 500 })
  }
}
