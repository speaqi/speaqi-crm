import { NextRequest } from 'next/server'
import { buildFatturaXml } from '@/lib/fatturapa'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { feInputFromInvoice, loadInvoiceSettings } from '@/lib/server/invoices'

/**
 * L'XML della fattura: quello inviato, se c'e'; per una bozza un'anteprima
 * con numero "BOZZA1", utile da caricare a mano sul pannello Aruba o da far
 * vedere al commercialista.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const { data: invoice, error } = await auth.admin.from('invoices').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle()
    if (error) throw error
    if (!invoice) return Response.json({ error: 'Fattura non trovata' }, { status: 404 })
    let xml = invoice.xml as string | null
    if (!xml) {
      const { settings } = await loadInvoiceSettings(auth.admin, auth.userId)
      try {
        xml = buildFatturaXml(feInputFromInvoice(invoice, settings))
      } catch (buildError) {
        return Response.json({ error: errorMessage(buildError, 'La fattura non è completa') }, { status: 400 })
      }
    }
    const name = invoice.numero ? `fattura-${String(invoice.numero).replace(/[^A-Za-z0-9-]/g, '-')}.xml` : 'fattura-bozza.xml'
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile preparare l’XML') }, { status: 500 })
  }
}
