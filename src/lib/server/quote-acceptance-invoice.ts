import { directorInvoiceReply, quoteIsInvoiceable, type DirectorInvoiceQuote } from '../office/director-orders'
import { createInvoiceDraftFromQuote, invoiceProblems, loadInvoiceSettings } from './invoices'
import { sendNotificationText } from './whatsapp'

// Un preventivo appena accettato (firma o spunta del cliente sul link, stato cambiato nella
// scheda) porta con sé la bozza della fattura, e il titolare lo sa su Telegram. Solo la bozza:
// lo SDI resta un clic in Fatture. Gli abbonamenti con carta no: la loro bozza nasce dal
// pagamento, e farla prima la raddoppierebbe. Non lancia mai: chi la chiama ha già fatto il suo.

type Where = { quoteId: string } | { publicToken: string }
const COLUMNS = 'id,user_id,quote_number,customer_name,customer_company,total_amount,status,payment_state,billing_interval,contact_id'

export async function invoiceOnAcceptance(admin: any, where: Where, how: 'firma' | 'scheda'): Promise<{ invoiceId: string; sent: boolean } | null> {
  try {
    let query = admin.from('quotes').select(COLUMNS)
    query = 'quoteId' in where ? query.eq('id', where.quoteId) : query.eq('public_token', where.publicToken)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    const quote = data as (DirectorInvoiceQuote & { user_id: string }) | null
    if (!quote || !quoteIsInvoiceable(quote) || quote.billing_interval === 'year') return null
    const { invoice, created } = await createInvoiceDraftFromQuote(admin, quote.user_id, quote.id)
    if (!created) return { invoiceId: invoice.id, sent: false }
    const { settings } = await loadInvoiceSettings(admin, quote.user_id)
    const base = (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
    const who = quote.customer_company || quote.customer_name || 'Il cliente'
    const head = how === 'firma' ? `${who} ha accettato il preventivo ${quote.quote_number} dal link.` : `Preventivo ${quote.quote_number} accettato.`
    const text = `${head}\n${directorInvoiceReply({
      quote, created, invoiceStatus: invoice.status, numero: invoice.numero || null,
      problems: invoiceProblems(invoice, settings), warnings: Array.isArray(invoice.warnings) ? invoice.warnings : [],
      link: `${base}/fatture?invoice=${invoice.id}`,
    })}`
    const result = await sendNotificationText(text, { requiredChannel: 'telegram' })
    return { invoiceId: invoice.id, sent: result.ok }
  } catch (error) {
    console.error('[quote-acceptance] bozza fattura non preparata', error)
    return null
  }
}
