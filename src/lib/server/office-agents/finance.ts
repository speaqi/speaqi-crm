import { createHash } from 'node:crypto'
import type { AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { createInvoiceDraftFromQuote, invoiceProblems, loadInvoiceSettings, type InvoiceRow } from '../invoices'
import { isQuotePaid } from '@/lib/command-center'
import { financeClosedMonth, financeContactCorrection, financeReminder, financeSdiExplanation, officeRomeDay, type FinanceQuote } from '@/lib/office/finance'
import type { CRMContact } from '@/types'
import { officeRows } from '../office-read'
import { selectByIdChunks } from '../http'
import { addOfficeOutputOnce, officeEmailDraft } from './shared'

export function financeHandler(admin: any, now: () => Date = () => new Date()): AgentHandler {
  return async (ctx) => {
    const userId = ctx.agent.user_id
    const today = now()
    const day = officeRomeDay(today)
    const [quotes, invoices, settingsResult] = await Promise.all([
      officeRows<FinanceQuote>(admin, userId, 'quotes'),
      officeRows<InvoiceRow>(admin, userId, 'invoices'),
      loadInvoiceSettings(admin, userId),
    ])
    const contactIds = [...new Set([...quotes.map((q) => q.contact_id), ...invoices.map((i) => i.contact_id)].filter((id): id is string => Boolean(id)))]
    const contacts = await selectByIdChunks<CRMContact>(contactIds, 100, (ids, range) => admin.from('contacts').select('*').eq('user_id', userId).in('id', ids).order('id').range(range.from, range.to))
    const byContact = new Map(contacts.map((c) => [c.id, c]))
    const billed = new Set(invoices.filter((i) => i.source === 'quote' && i.quote_id).map((i) => i.quote_id))
    let invoiceDrafts = 0
    let emailDrafts = 0
    const fixes: Array<{ invoice_id: string; problems: string[] }> = []
    const sdi: Array<{ invoice_id: string; explanation: string }> = []
    for (const quote of quotes) {
      if (isQuotePaid(quote) && !billed.has(quote.id)) {
        // La funzione esistente prepara soltanto la bozza: nessun numero o upload SDI.
        const { invoice, created } = await createInvoiceDraftFromQuote(admin, userId, quote.id)
        billed.add(quote.id); invoices.push(invoice)
        if (created) invoiceDrafts++
      }
      const contact = quote.contact_id ? byContact.get(quote.contact_id) : undefined
      const reminder = contact ? financeReminder(quote, contact, today) : null
      if (reminder && contact) {
        const draft = await officeEmailDraft(admin, ctx, { contactId: contact.id, key: reminder.key, subject: reminder.subject, text: reminder.text, note: reminder.note })
        if (draft.created) {
          emailDrafts++
          await addOfficeOutputOnce(admin, ctx, `email:${reminder.key}`, { kind: 'draft_email', title: `Sollecito da rivedere: ${quote.quote_number}`,
            body: { motivo: reminder.note, fonti: [{ table: 'quotes', id: quote.id }, { table: 'contacts', id: contact.id }], email_draft_id: draft.id, testo: reminder.text }, target_table: 'email_drafts', target_id: draft.id! })
        }
      }
    }
    for (const invoice of invoices) {
      if (invoice.status === 'draft') {
        const problems = invoiceProblems(invoice, settingsResult.settings)
        if (problems.length) fixes.push({ invoice_id: invoice.id, problems })
        const contact = invoice.contact_id ? byContact.get(invoice.contact_id) : undefined
        const patch = contact ? financeContactCorrection(invoice.customer, contact) : {}
        if (Object.keys(patch).length && contact) {
          const hash = createHash('sha256').update(JSON.stringify(patch)).digest('hex').slice(0, 20)
          await addOfficeOutputOnce(admin, ctx, `finance:fix:${invoice.id}:${hash}`, { kind: 'data_fix', title: `Dati fattura da completare: ${invoice.numero || invoice.id}`,
            body: { proposta: patch, dati_attuali: invoice.customer, problemi: problems,
              fonte: { table: 'contacts', id: contact.id, campi: ['billing_tax_id','billing_zip','billing_sdi','billing_pec','billing_address','billing_city','company','name'] } }, target_table: 'invoices', target_id: invoice.id })
        }
      }
      if (['rejected', 'not_delivered'].includes(invoice.status)) sdi.push({ invoice_id: invoice.id, explanation: financeSdiExplanation(invoice) })
    }
    await addOfficeOutputOnce(admin, ctx, `finance:day:${day}`, { kind: 'report', title: `Finanza — ${day}`,
      body: { bozze_fattura_create: invoiceDrafts, bozze_email_create: emailDrafts, fatture_da_correggere: fixes, esiti_sdi: sdi,
        fonti: { quote_ids: quotes.map((q) => q.id), invoice_ids: invoices.map((i) => i.id) }, nota: 'Solo bozze e proposte: nessun documento inviato allo SDI e nessuna email inviata.' } })
    const month = financeClosedMonth(quotes, invoices, today)
    if (month.is_first_day) await addOfficeOutputOnce(admin, ctx, `finance:month:${month.month}`, { kind: 'report', title: `Mese chiuso — ${month.month}`, body: month })
    return { summary: `Preparate ${invoiceDrafts} bozze fattura e ${emailDrafts} bozze di sollecito; ${fixes.length} fatture da controllare` }
  }
}

export const runFinance: AgentHandler = (ctx) => financeHandler(createServiceRoleClient())(ctx)
