import { NextRequest } from 'next/server'
import { feText } from '@/lib/fatturapa'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { EDITABLE_STATUSES, loadInvoiceSettings, normalizeCustomer, normalizeLines, recomputeTotals } from '@/lib/server/invoices'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH: correzione di una bozza (o di una fattura scartata): data, cliente,
 * righe, pagamento, causale. Il numero, una volta assegnato, non si tocca.
 * DELETE: solo una bozza mai numerata.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const { admin, userId } = auth
    const { data: invoice, error } = await admin.from('invoices').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    if (!invoice) return Response.json({ error: 'Fattura non trovata' }, { status: 404 })
    if (!EDITABLE_STATUSES.includes(invoice.status)) return Response.json({ error: 'Una fattura inviata non si modifica.' }, { status: 409 })

    const body = await request.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if (body.issue_date !== undefined) {
      const date = String(body.issue_date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'Data non valida' }, { status: 400 })
      if (invoice.number != null && Number(date.slice(0, 4)) !== invoice.year) {
        return Response.json({ error: `Il numero ${invoice.numero} è dell'anno ${invoice.year}: la data deve restare in quell'anno.` }, { status: 400 })
      }
      patch.issue_date = date
    }
    if (body.customer !== undefined) {
      const customer = normalizeCustomer(body.customer)
      if (!customer) return Response.json({ error: 'Dati del cliente non validi' }, { status: 400 })
      patch.customer = customer
    }
    if (body.lines !== undefined) {
      const lines = normalizeLines(body.lines)
      if (!lines || !lines.length) return Response.json({ error: 'Ogni riga vuole descrizione, quantità, prezzo e aliquota.' }, { status: 400 })
      patch.lines = lines
    }
    if (body.payment_method !== undefined) {
      if (!['MP05', 'MP08'].includes(body.payment_method)) return Response.json({ error: 'Metodo di pagamento non valido' }, { status: 400 })
      patch.payment_method = body.payment_method
    }
    if (body.causale !== undefined) patch.causale = feText(body.causale, 600) || null
    if (body.dismiss_warnings === true) patch.warnings = []

    const { settings } = await loadInvoiceSettings(admin, userId)
    Object.assign(patch, recomputeTotals((patch.lines as any) || invoice.lines, settings))

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .in('status', EDITABLE_STATUSES)
      .select('*')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) return Response.json({ error: 'La fattura è appena partita: ricarica la pagina.' }, { status: 409 })
    return Response.json({ invoice: updated })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare la fattura') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const { data, error } = await auth.admin
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.userId)
      .eq('status', 'draft')
      .is('number', null)
      .select('id')
    if (error) throw error
    if (!data?.length) return Response.json({ error: 'Si cancella solo una bozza mai inviata.' }, { status: 409 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile cancellare la bozza') }, { status: 500 })
  }
}
