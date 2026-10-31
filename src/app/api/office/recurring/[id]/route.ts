import { NextRequest } from 'next/server'
import { parseRecurringInput } from '@/lib/office-recurring'
import { officeOwnerRoute } from '@/lib/server/office-api'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    if (!UUID.test(id)) return Response.json({ error: 'Incarico non valido' }, { status: 400 })
    let input, revision
    try {
      const body = await request.json()
      input = parseRecurringInput(body); revision = body.revision
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Revisione non valida')
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Incarico non valido' }, { status: 400 }) }
    const { data, error } = await admin.rpc('office_recurring_update', { p_user_id: userId, p_id: id, p_revision: revision,
      p_title: input.title, p_instruction: input.instruction, p_every_days: input.every_days,
      p_local_time: input.local_time, p_next_day: input.next_local_date, p_enabled: input.enabled })
    if (error && ['42883', 'PGRST202'].includes(error.code)) return Response.json({ error: 'Agenda non ancora installata nel database.' }, { status: 503 })
    if (error) throw error
    if (!data) return Response.json({ error: 'L’incarico è cambiato: aggiorna la pagina e riprova.' }, { status: 409 })
    return Response.json({ schedule: data })
  })
}
