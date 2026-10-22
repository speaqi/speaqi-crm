import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || Object.keys(body).some((key) => key !== 'status') || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: 'Scegli approvata o rifiutata' }, { status: 400 })
    }
    // Una decisione soltanto: approvare NON esegue alcuna azione esterna.
    const { data, error } = await admin.from('office_agent_outputs')
      .update({ status: body.status, decided_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
      .eq('status', 'pending').select('*').maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Uscita non trovata o già decisa. Aggiorna la pagina.' }, { status: 409 })
    return Response.json({ output: data })
  })
}
