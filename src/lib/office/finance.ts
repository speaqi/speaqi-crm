import { isQuotePaid, type MoneyQuote } from '../command-center'
import { isPlausibleCodiceFiscale, isValidPartitaIva, splitComuneProvincia, type FeCustomer } from '../fatturapa'
import type { InvoiceRow } from '../server/invoices'
import type { CRMContact } from '@/types'

export type FinanceQuote = MoneyQuote & {
  user_id?: string; customer_email?: string | null; payment_method?: string; accepted_at?: string | null
  created_at?: string; updated_at?: string; stripe_subscription_id?: string | null
}
export function officeRomeDay(date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((v) => [v.type, v.value]))
  return `${p.year}-${p.month}-${p.day}`
}
const monthOf = (date: string) => officeRomeDay(new Date(date)).slice(0, 7)
const cents = (v: unknown) => Math.round((Number(v) || 0) * 100)
const validDate = (date: unknown): date is string => typeof date === 'string' && Number.isFinite(Date.parse(date))

/** Incassi registrati nel CRM, non una stima del MRR o un saldo bancario. */
export function financeClosedMonth(quotes: FinanceQuote[], invoices: InvoiceRow[], now = new Date()) {
  const day = officeRomeDay(now)
  const [year, month] = day.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 2, 1))
  const key = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
  const paid = quotes.filter((q) => isQuotePaid(q) && validDate(q.paid_at) && monthOf(q.paid_at) === key)
  const renewalsPaid = invoices.filter((i) => i.source === 'stripe_renewal' && validDate(i.created_at) && monthOf(i.created_at) === key)
  const issued = invoices.filter((i) => validDate(i.sent_at) && monthOf(i.sent_at) === key && !['draft','sending','error','rejected'].includes(i.status))
  const invoicedQuoteIds = new Set(invoices.filter((i) => i.source === 'quote' && i.quote_id).map((i) => i.quote_id))
  const toInvoice = paid.filter((q) => !invoicedQuoteIds.has(q.id))
  const renewals = quotes.filter((q) => q.billing_interval === 'year' && !q.cancel_at_period_end && q.subscription_status !== 'canceled'
    && validDate(q.current_period_end) && monthOf(q.current_period_end) === day.slice(0, 7))
  const cash = paid.reduce((n, q) => n + cents(q.total_amount), 0) + renewalsPaid.reduce((n, i) => n + cents(i.totale), 0)
  const billed = issued.reduce((n, i) => n + cents(i.totale), 0)
  return { month: key, is_first_day: day.endsWith('-01'), incassato_registrato_cents: cash, fatturato_cents: billed,
    da_fatturare_cents: toInvoice.reduce((n, q) => n + cents(q.total_amount), 0), differenza_cents: cash - billed,
    rinnovi_mese_corrente: renewals.map((q) => ({ quote_id: q.id, date: q.current_period_end, amount_cents: cents(q.total_amount) })),
    sources: { paid_quote_ids: paid.map((q) => q.id), renewal_invoice_ids: renewalsPaid.map((i) => i.id), issued_invoice_ids: issued.map((i) => i.id), to_invoice_quote_ids: toInvoice.map((q) => q.id) },
    limitations: ['I rinnovi Stripe sono attribuiti alla data di registrazione della bozza: il CRM non conserva qui la data valuta del provider. Importi IVA compresa, non saldo del conto corrente.'] }
}

/** Correzioni proposte solo da valori presenti nel contatto, mai applicate qui. */
export function financeContactCorrection(customer: FeCustomer, contact: CRMContact): Partial<FeCustomer> {
  const patch: Partial<FeCustomer> = {}
  const put = (key: keyof FeCustomer, value: string | null | undefined, valid: (s: string) => boolean = (s) => Boolean(s.trim())) => {
    if ((!customer[key] || !valid(String(customer[key]))) && value && valid(value)) (patch as Record<string, string>)[key] = value.trim()
  }
  put('denominazione', contact.company || contact.name)
  put('indirizzo', contact.billing_address)
  put('cap', contact.billing_zip, (s) => /^\d{5}$/.test(s))
  put('codiceDestinatario', contact.billing_sdi, (s) => /^[A-Z0-9]{7}$/i.test(s))
  put('pec', contact.billing_pec, (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  if (contact.billing_city) {
    const place = splitComuneProvincia(contact.billing_city)
    put('comune', place.comune); put('provincia', place.provincia)
  }
  const tax = String(contact.billing_tax_id || '').trim()
  if (isValidPartitaIva(tax)) put('partitaIva', tax.replace(/^IT/i, ''), isValidPartitaIva)
  else if (isPlausibleCodiceFiscale(tax)) put('codiceFiscale', tax, isPlausibleCodiceFiscale)
  return patch
}

export function financeReminder(quote: FinanceQuote, contact: CRMContact, now = new Date()) {
  if (!contact.email || contact.hidden || contact.email_unsubscribed_at) return null
  const overdueBank = quote.status === 'accepted' && quote.payment_method === 'bank_transfer' && !isQuotePaid(quote)
    && validDate(quote.accepted_at) && Date.parse(quote.accepted_at) < now.getTime() - 15 * 86400_000
  const failed = quote.subscription_status === 'past_due'
  if (!failed && !overdueBank) return null
  const kind = failed ? 'stripe' : 'bonifico'
  const period = failed ? quote.current_period_end || 'periodo-non-disponibile' : quote.accepted_at!
  const reason = failed ? `Pagamento dell’abbonamento ${quote.quote_number} non riuscito (past_due).` : `Preventivo ${quote.quote_number} accettato da oltre 15 giorni, bonifico non registrato.`
  return { kind, key: `finance:${kind}:${quote.id}:${period}`, note: reason,
    subject: `Un aggiornamento sul pagamento — ${quote.quote_number}`,
    text: `Buongiorno ${contact.name},\nsono Massimo Morgante, fondatore di Speaqi.\n${failed ? 'Risulta un pagamento non riuscito' : 'Non risulta ancora registrato il bonifico'} per ${quote.quote_number}.\nPuoi verificare quando ti è possibile? Se hai già provveduto, rispondi pure a questa email così possiamo aggiornare la registrazione.\nGrazie,\nMassimo Morgante` }
}

export function financeSdiExplanation(invoice: Pick<InvoiceRow, 'status' | 'sdi_detail' | 'last_error'>) {
  const reason = String(invoice.sdi_detail || invoice.last_error || '').trim()
  return `${invoice.status === 'not_delivered' ? 'Lo SDI non ha consegnato la fattura: verificare il recapito e il documento sul pannello.' : 'La fattura è stata scartata: controllare e correggere prima di un nuovo invio.'}${reason ? ` Motivo registrato: ${reason}` : ' Nessun motivo dettagliato disponibile nel CRM.'}`
}
