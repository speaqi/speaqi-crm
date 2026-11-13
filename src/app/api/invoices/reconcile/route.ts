import { NextRequest } from 'next/server'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { createInvoiceDraftFromQuote } from '@/lib/server/invoices'
import { errorMessage } from '@/lib/server/http'
import { reconcileInvoiceRecord } from '@/lib/server/external-invoices'

function validDate(value: unknown) {
  const s = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s
}
/** Registra un documento esterno: non assegna numeri e non chiama Aruba. */
export async function POST(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const number = String(body.number || '').trim()
    const issued = String(body.issue_date || '')
    const paid = body.payment_state === 'paid'
    const paymentState = String(body.payment_state || '')
    const paidAt = paid ? String(body.paid_at || '') : null
    const total = Number(body.total)
    if (!number || number.length > 100 || !validDate(issued) || !['unknown','unpaid','paid'].includes(paymentState) || (paid && !validDate(paidAt)) || body.total === '' || body.total === undefined || body.total === null || !Number.isFinite(total) || total < 0 || total > 9999999999)
      return Response.json({ error: 'Inserisci numero, data di emissione e stato del pagamento validi.' }, { status: 400 })
    const existingNumber = await auth.admin.from('invoices').select('id').eq('user_id', auth.userId).eq('numero', number).gte('issue_date', `${issued.slice(0, 4)}-01-01`).lte('issue_date', `${issued.slice(0, 4)}-12-31`).limit(1).maybeSingle()
    if (existingNumber.error) throw existingNumber.error
    if (existingNumber.data && existingNumber.data.id !== String(body.invoice_id || '')) return Response.json({ error: 'Una fattura CRM usa già questo numero: verifica il documento prima di registrarlo.' }, { status: 409 })
    const externalNumber = await auth.admin.from('invoices').select('id').eq('user_id', auth.userId).eq('externally_issued', true).ilike('external_number', number.replace(/[%_\\]/g, '\\$&')).gte('issue_date', `${issued.slice(0, 4)}-01-01`).lte('issue_date', `${issued.slice(0, 4)}-12-31`).limit(1).maybeSingle()
    if (externalNumber.error) throw externalNumber.error
    if (externalNumber.data) return Response.json({ error: 'Esiste già una fattura esterna con questo numero e anno: verifica prima di proseguire.' }, { status: 409 })
    let invoiceId = String(body.invoice_id || '').trim()
    const quoteId = String(body.quote_id || '').trim()
    if (!invoiceId && !quoteId) {
      const name = String(body.customer_name || '').trim()
      const contactId = String(body.contact_id || '').trim() || null
      if (!name || name.length > 200 || body.total === '' || body.total === undefined || body.total === null || !Number.isFinite(total) || total < 0 || total > 9999999999)
        return Response.json({ error: 'Inserisci il cliente e un importo valido.' }, { status: 400 })
      if (contactId) {
        const contact = await auth.admin.from('contacts').select('id').eq('id', contactId).eq('user_id', auth.userId).maybeSingle()
        if (contact.error) throw contact.error
        if (!contact.data) return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
      }
      const { data, error } = await auth.admin.from('invoices').insert({ user_id: auth.userId, contact_id: contactId, source: 'manual', status: 'sent', issue_date: issued, customer: { denominazione: name }, lines: [], totale: total, externally_issued: true, external_number: number, sent_at: `${issued}T12:00:00Z`, payment_state: paymentState, paid_at: paidAt }).select('*').single()
      if (error?.code === '23505') return Response.json({ error: 'Esiste già una fattura esterna con questo numero e anno: verifica prima di proseguire.' }, { status: 409 })
      if (error) throw error
      return Response.json({ invoice: data }, { status: 201 })
    }
    if (!invoiceId && quoteId) {
      const result = await createInvoiceDraftFromQuote(auth.admin, auth.userId, quoteId)
      invoiceId = result.invoice.id
    }
    if (!invoiceId) return Response.json({ error: 'Scegli una bozza o un preventivo.' }, { status: 400 })
    const result = await reconcileInvoiceRecord(auth.admin, auth.userId, invoiceId, { number, issued, paymentState, paidAt, total })
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ invoice: result.invoice })
  } catch (error) { return Response.json({ error: errorMessage(error, 'Impossibile registrare la fattura esterna') }, { status: 500 }) }
}

/** Stato dell'incasso indipendente dall'invio SDI. */
export async function PATCH(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await request.json().catch(() => ({}))
    const state = String(body.payment_state || '')
    const paidAt = state === 'paid' ? String(body.paid_at || '') : null
    if (!body.invoice_id || !['unknown','unpaid','paid'].includes(state) || (state === 'paid' && !validDate(paidAt))) return Response.json({ error: 'Pagamento non valido' }, { status: 400 })
    const { data, error } = await auth.admin.from('invoices').update({ payment_state: state, paid_at: paidAt }).eq('id', String(body.invoice_id)).eq('user_id', auth.userId).select('id,payment_state,paid_at').maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Fattura non trovata' }, { status: 404 })
    return Response.json({ invoice: data })
  } catch (error) { return Response.json({ error: errorMessage(error, 'Impossibile aggiornare il pagamento') }, { status: 500 }) }
}
