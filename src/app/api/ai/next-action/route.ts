import { NextRequest } from 'next/server'
import { buildLeadContext, logAiDecision, suggestNextActionWithAI } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const leadId = String(body.lead_id || '').trim()

    if (!leadId) {
      return Response.json({ error: 'lead_id obbligatorio' }, { status: 400 })
    }

    const context = await buildLeadContext(auth.supabase, auth.user.id, leadId)
    const result = await suggestNextActionWithAI({
      lead: context.lead,
      memory: context.memory,
      lastActivity: body.last_activity ? String(body.last_activity) : context.activities[0]?.type || null,
      history: body.history ? String(body.history) : context.history,
    })

    await logAiDecision(
      auth.supabase,
      auth.user.id,
      'next_action',
      { lead_id: leadId, history: body.history || context.history, last_activity: body.last_activity || context.activities[0]?.type || null },
      JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
      leadId
    )

    return Response.json(result)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to compute next action') }, { status: 500 })
  }
}
