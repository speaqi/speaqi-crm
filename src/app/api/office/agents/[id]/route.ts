import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { officeAgentPatch } from '@/lib/office'
import { errorMessage } from '@/lib/server/http'

/** Storico dedicato: non dipende dalle ultime corse dell'intero ufficio. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const offsetText = request.nextUrl.searchParams.get('offset') || '0'
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(id) || !/^\d{1,6}$/.test(offsetText) || Number(offsetText) > 100_000) {
      return Response.json({ error: 'Agente o pagina non validi' }, { status: 400 })
    }
    const offset = Number(offsetText)
    const agent = await admin.from('office_agents').select('id').eq('user_id', userId).eq('id', id).maybeSingle()
    if (agent.error) throw agent.error
    if (!agent.data) return Response.json({ error: 'Agente non trovato' }, { status: 404 })
    const [runs, outputs] = await Promise.all([
      admin.from('office_agent_runs').select('id,agent_id,status,summary,error,started_at,finished_at,items_created', { count: 'exact' })
        .eq('user_id', userId).eq('agent_id', id).order('started_at', { ascending: false }).order('id').range(offset, offset + 19),
      admin.from('office_agent_outputs').select('id,agent_id,title,kind,status,body,target_table,target_id,created_at,decided_at', { count: 'exact' })
        .eq('user_id', userId).eq('agent_id', id).order('created_at', { ascending: false }).order('id').range(offset, offset + 19),
    ])
    for (const result of [runs, outputs]) if (result.error && result.error.code !== 'PGRST103') throw result.error
    return Response.json({ runs: runs.data || [], outputs: outputs.data || [],
      total: Math.max(runs.count || 0, outputs.count || 0), offset })
  })
}

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
