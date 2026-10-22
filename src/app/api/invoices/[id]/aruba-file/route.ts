import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireInvoiceOwner } from '@/lib/server/invoice-auth'
import { recordManualArubaFile } from '@/lib/server/invoices'

type Params = { params: Promise<{ id: string }> }

/**
 * POST { filename, env? }: il nome del file con cui la fattura numerata a mano
 * e' stata caricata sul pannello Aruba. Da qui lo stato SDI si legge da solo.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireInvoiceOwner(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const result = await recordManualArubaFile(auth.admin, auth.userId, id, body.filename, body.env)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ invoice: result.invoice })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile registrare il file Aruba') }, { status: 500 })
  }
}
