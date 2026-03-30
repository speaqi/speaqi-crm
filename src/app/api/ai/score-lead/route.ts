import { NextRequest } from 'next/server'
import { buildLeadContext, logAiDecision, scoreLeadWithAI, syncLeadScore } from '@/lib/server/ai-ready'
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
    const score = await syncLeadScore(auth.supabase, auth.user.id, leadId)

    await logAiDecision(
      auth.supabase,
      auth.user.id,
      'score_lead',
      { lead_id: leadId, lead: context.lead, memory: context.memory },
      { score },
      leadId
    )

    return Response.json({ score })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to score lead') }, { status: 500 })
  }
}
