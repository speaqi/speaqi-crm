import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { sendInvoice } from '@/lib/server/invoices'

/**
 * Invio ad Aruba. Lo decide sempre una persona: nessun automatismo chiama questa rotta.
 * Con `{ manual: true }` numera e prepara l'XML senza inviarlo: lo si carica a mano su Aruba.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const result = await sendInvoice(auth.admin, auth.userId, id, { manual: body?.manual === true })
    if (result.ok) return Response.json({ invoice: result.invoice })
    return Response.json({ error: result.error, problems: result.problems, invoice: result.invoice }, { status: result.status })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Invio non riuscito') }, { status: 500 })
  }
}
