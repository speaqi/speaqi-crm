import { NextRequest } from 'next/server'
import { officeOwnerRoute, officeRunKey } from '@/lib/server/office-api'
import { createOfficeStore, runAgent } from '@/lib/server/office-agents'
import { officeAgentHandler } from '@/lib/server/office-agents/registry'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    const key = officeRunKey(request)
    if (!key) return Response.json({ error: 'Serve una Idempotency-Key valida (8–160 caratteri)' }, { status: 400 })
    const handler = officeAgentHandler(id)
    if (!handler) return Response.json({ error: 'Questo agente non ha ancora un compito installato' }, { status: 409 })
    const store = createOfficeStore(admin)
    if (!await store.agent(id, userId)) return Response.json({ error: 'Agente non trovato' }, { status: 404 })
    const result = await runAgent(id, handler, { userId, key, store })
    return Response.json(result, { status: result.error && !result.run ? 500 : 200 })
  })
}
