import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { updateLeadFromInput } from '@/lib/server/lead-ops'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const leadId = String(body.id || body.lead_id || '').trim()

    if (!leadId) {
      return Response.json({ error: 'lead_id obbligatorio' }, { status: 400 })
    }

    const lead = await updateLeadFromInput(auth.supabase, auth.user.id, leadId, body)
    return Response.json({ lead })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to update lead') }, { status: 500 })
  }
}
