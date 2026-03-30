import { NextRequest } from 'next/server'
import { logAiDecision, readLeadMemory, updateMemoryWithAI, upsertLeadMemory } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const leadId = String(body.lead_id || '').trim()
    const newInteraction = String(body.new_interaction || '').trim()

    if (!leadId || !newInteraction) {
      return Response.json({ error: 'lead_id e new_interaction sono obbligatori' }, { status: 400 })
    }

    const current = await readLeadMemory(auth.supabase, auth.user.id, leadId)
    const update = await updateMemoryWithAI(current?.summary, newInteraction)
    const memory = await upsertLeadMemory(auth.supabase, auth.user.id, leadId, update)

    await logAiDecision(
      auth.supabase,
      auth.user.id,
      'update_memory',
      { lead_id: leadId, new_interaction: newInteraction },
      JSON.parse(JSON.stringify(update)) as Record<string, unknown>,
      leadId
    )

    return Response.json({
      summary: memory.summary || '',
      tone: memory.tone || 'direct',
      language_detected: memory.language_detected || 'unknown',
      memory,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to update memory') }, { status: 500 })
  }
}
