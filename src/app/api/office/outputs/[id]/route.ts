import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || Object.keys(body).some((key) => key !== 'status') || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: 'Scegli approvata o rifiutata' }, { status: 400 })
    }
    // Decisione e coda interna nella stessa transazione; nessuna azione esterna.
    const { data, error } = await admin.rpc('decide_office_output', { p_output_id:id,p_user_id:userId,p_status:body.status })
    if (error) throw error
    if (!data?.output) {
      if (data?.reason === 'merge_failed') {
        // Nessuna unione e' partita: la proposta resta da decidere, con il motivo di ogni gruppo.
        const first = (data.skipped as Array<{ error?: string }> | undefined)?.[0]?.error
        return Response.json({ error: `Nessun gruppo unito${first ? `: ${first}` : ''}. La proposta resta in attesa.`, skipped: data.skipped }, { status: 409 })
      }
      return Response.json({ error: data?.reason==='agent_missing' ? 'Il destinatario non è ancora installato. Installa gli agenti successivi prima di accodare.' : 'Uscita non trovata o già decisa. Aggiorna la pagina.' }, { status: 409 })
    }
    return Response.json({ output: data.output })
  })
}
