import { ensureOfficeAgents } from '@/lib/server/office-agents/definitions'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { officeRunKey } from '@/lib/server/office-api'
import { runAgent } from '@/lib/server/office-agents'
import { officeAgentHandler } from '@/lib/server/office-agents/registry'
import { enqueueAgentTurn, missingWorkSchema, officeWorkEnabled } from '@/lib/server/office-work-routing'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  const { id } = await context.params
  const handler = officeAgentHandler(id)
  if (!handler) return Response.json({ error: 'Agente non installato' }, { status: 404 })
  try { await ensureOfficeAgents(createServiceRoleClient(), auth.context.workspaceUserId) }
  catch (error) { return Response.json({ error: errorMessage(error, 'Registro non disponibile') }, { status: 500 }) }
  // I retry del pianificatore nello stesso minuto riusano la corsa.
  const key = officeRunKey(request) || `cron:${new Date().toISOString().slice(0, 16)}`
  if (officeWorkEnabled()) {
    try {
      const work = await enqueueAgentTurn(createServiceRoleClient(), auth.context.workspaceUserId, id, key)
      return Response.json({ work, outcome: 'skipped', reason: 'Incarico registrato: viene eseguito dal worker dei lavori' }, { status: 202 })
    } catch (error) {
      if (missingWorkSchema(error)) return Response.json({ outcome: 'blocked', reason: 'Aggiornamento del registro lavori in corso: il turno non è stato eseguito' })
      throw error
    }
  }
  const result = await runAgent(id, handler, { userId: auth.context.workspaceUserId, key })
  // Una corsa finita in errore è un errore anche per il pianificatore: con 200
  // finiva in automation_job_runs come riuscita e l'avviso non partiva.
  if (result.run?.status === 'failed') {
    return Response.json({ ...result, error: result.run.error || result.error || 'Corsa dell’agente fallita' }, { status: 502 })
  }
  return Response.json(result, { status: result.error && !result.run ? 500 : 200 })
}
