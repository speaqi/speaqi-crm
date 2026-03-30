import { NextRequest } from 'next/server'
import { logAiDecision, readLeadMemory, updateMemoryWithAI, upsertLeadMemory } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const newInteraction = String(body.new_interaction || '').trim()

    if (!newInteraction) {
      return Response.json({ error: 'new_interaction obbligatoria' }, { status: 400 })
    }

    const current = await readLeadMemory(auth.supabase, auth.user.id, id)
    const memoryUpdate = await updateMemoryWithAI(current?.summary, newInteraction)
    const memory = await upsertLeadMemory(auth.supabase, auth.user.id, id, memoryUpdate)

    await logAiDecision(
      auth.supabase,
      auth.user.id,
      'update_memory',
      { lead_id: id, new_interaction: newInteraction },
      JSON.parse(JSON.stringify(memoryUpdate)) as Record<string, unknown>,
      id
    )

    return Response.json({
      summary: memory.summary || '',
      tone: memory.tone || 'direct',
      language_detected: memory.language_detected || 'unknown',
      memory,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to update lead memory') }, { status: 500 })
  }
}
