import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { approveDirectorContact, startAfterApproval } from '@/lib/server/office-director-orders'
import { missingWorkSchema, officeWorkEnabled } from '@/lib/server/office-work-routing'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || Object.keys(body).some((key) => key !== 'status') || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: 'Scegli approvata o rifiutata' }, { status: 400 })
    }
    if (officeWorkEnabled()) {
      // Lo schema deve esserci prima del clic: la proposta non viene consumata in sua assenza.
      const supported = await admin.from('office_work_items').select('id').limit(0)
      if (missingWorkSchema(supported.error)) return Response.json({ error: 'Aggiornamento dei lavori in corso. La proposta resta da decidere.' }, { status: 503 })
      if (supported.error) throw supported.error
    }
    if (body.status === 'approved') {
      // Nuovo contatto dal Direttore: lo inserisce il codice del CRM, con le sue regole.
      const contact = await approveDirectorContact(admin, userId, id)
      if (contact && 'error' in contact) return Response.json({ error: contact.error }, { status: contact.status })
      if (contact) return Response.json({ output: contact.output, notice: contact.notice, contact_id: contact.contact_id })
    }
    // Decisione e coda interna nella stessa transazione; nessuna azione esterna.
    const { data, error } = await admin.rpc(officeWorkEnabled() ? 'office_work_decide_output' : 'decide_office_output', { p_output_id:id,p_user_id:userId,p_status:body.status })
    if (error) throw error
    if (!data?.output) {
      if (data?.reason === 'merge_failed') {
        // Nessuna unione e' partita: la proposta resta da decidere, con il motivo di ogni gruppo.
        const first = (data.skipped as Array<{ error?: string }> | undefined)?.[0]?.error
        return Response.json({ error: `Nessun gruppo unito${first ? `: ${first}` : ''}. La proposta resta in attesa.`, skipped: data.skipped }, { status: 409 })
      }
      if (data?.reason === 'enrich_failed') {
        // Nessuna scrittura: verifiche, CRM e coda tornano indietro insieme, la proposta resta da decidere.
        return Response.json({ error: `Ente non portato nel CRM: ${data.error || 'errore'}. La proposta resta in attesa.` }, { status: 409 })
      }
      if (data?.reason === 'deadline_passed') {
        // La scadenza dell'evento è passata fra la proposta e il clic: approvarla non serve più.
        return Response.json({ error: 'La scadenza di questo evento è già passata: non c’è più niente da decidere. Rifiuta la proposta per toglierla dalla coda.' }, { status: 409 })
      }
      return Response.json({ error: data?.reason==='agent_missing' ? 'Il destinatario non è ancora installato. Installa gli agenti successivi prima di accodare.' : 'Uscita non trovata o già decisa. Aggiorna la pagina.' }, { status: 409 })
    }
    await startAfterApproval(admin, userId, data.output).catch(() => undefined)
    return Response.json({ output: data.output })
  })
}
