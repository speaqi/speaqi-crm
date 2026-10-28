import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { syncTourismOpportunities } from '@/lib/server/tourism-opportunity'

/** Ogni ente di Tourism Intelligence nei contatti ha la sua opportunità (tourism o distribuzione). */
export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    const result = await syncTourismOpportunities(createServiceRoleClient(), auth.context.workspaceUserId)
    return Response.json({ ok: result.errors.length === 0, ...result })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Opportunità Tourism non sincronizzate') }, { status: 500 })
  }
}
