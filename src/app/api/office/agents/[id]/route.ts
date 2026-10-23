import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { officeAgentPatch } from '@/lib/office'
import { errorMessage } from '@/lib/server/http'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    let patch: Record<string, unknown>
    try { patch = officeAgentPatch(await request.json()) }
    catch (error) { return Response.json({ error: errorMessage(error, 'Dati non validi') }, { status: 400 }) }
    const { data, error } = await admin.from('office_agents').update(patch).eq('id', id).eq('user_id', userId).select('*').maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Agente non trovato' }, { status: 404 })
    return Response.json({ agent: data })
  })
}
