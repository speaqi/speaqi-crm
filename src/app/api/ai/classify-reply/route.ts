import { NextRequest } from 'next/server'
import { classifyReplyWithAI, logAiDecision } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const emailText = String(body.email_text || '').trim()
    const leadId = body.lead_id ? String(body.lead_id) : null

    if (!emailText) {
      return Response.json({ error: 'email_text obbligatorio' }, { status: 400 })
    }

    const result = await classifyReplyWithAI(emailText)
    await logAiDecision(
      auth.supabase,
      auth.user.id,
      'classify_reply',
      { email_text: emailText },
      JSON.parse(JSON.stringify(result)) as Record<string, unknown>,
      leadId
    )

    return Response.json({ intent: result.intent, tone: result.tone, language_detected: result.language_detected })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to classify reply') }, { status: 500 })
  }
}
