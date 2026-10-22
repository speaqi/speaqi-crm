import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { markQuoteInvoicedOutside } from '@/lib/server/invoices'

/** POST { quote_id }: il preventivo e' gia' stato fatturato fuori dal CRM, esce da «Da fatturare». */
export async function POST(request: NextRequest) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const quoteId = String(body.quote_id || '').trim()
    if (!quoteId) return Response.json({ error: 'Scegli il preventivo' }, { status: 400 })
    const result = await markQuoteInvoicedOutside(auth.admin, auth.userId, quoteId)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile segnare il preventivo') }, { status: 500 })
  }
}
