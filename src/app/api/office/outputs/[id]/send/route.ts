import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { decideOfficeOutput } from '@/lib/server/office-output-decision'
import { approveAndSendOutput } from '@/lib/server/office-email-send'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** «Approva e invia» di una bozza email dell'Ufficio: lo stesso servizio del pulsante su Telegram. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    if (!UUID.test(id)) return Response.json({ error: 'Bozza non valida' }, { status: 400 })
    const result = await approveAndSendOutput(admin, userId, id, (outputId) => decideOfficeOutput(admin, userId, outputId, 'approved'))
    if (!result.ok) return Response.json({ error: result.text, uncertain: !!result.uncertain }, { status: result.status })
    return Response.json({ sent: true, notice: result.text, gmail_message_id: result.gmail_message_id })
  })
}
