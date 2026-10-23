import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { officeRunKey } from '@/lib/server/office-api'
import { runAgent } from '@/lib/server/office-agents'
import { officeAgentHandler } from '@/lib/server/office-agents/registry'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  const { id } = await context.params
  const handler = officeAgentHandler(id)
  if (!handler) return Response.json({ error: 'Agente non installato' }, { status: 404 })
  // I retry del pianificatore nello stesso minuto riusano la corsa.
  const key = officeRunKey(request) || `cron:${new Date().toISOString().slice(0, 16)}`
  const result = await runAgent(id, handler, { userId: auth.context.workspaceUserId, key })
  return Response.json(result, { status: result.error && !result.run ? 500 : 200 })
}
