import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { decideOfficeOutput } from '@/lib/server/office-output-decision'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || Object.keys(body).some((key) => key !== 'status') || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: 'Scegli approvata o rifiutata' }, { status: 400 })
    }
    // La stessa decisione del pulsante su Telegram: regole e messaggi in un posto solo.
    const result = await decideOfficeOutput(admin, userId, id, body.status)
    if (!result.ok) return Response.json({ error: result.error, ...(result.extra || {}) }, { status: result.status })
    return Response.json({ output: result.output, ...(result.notice ? { notice: result.notice } : {}), ...(result.contact_id ? { contact_id: result.contact_id } : {}) })
  })
}
