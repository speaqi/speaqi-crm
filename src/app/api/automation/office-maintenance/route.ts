import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    const { data, error } = await createServiceRoleClient().rpc('prune_office_agent_runs')
    if (error) throw error
    return Response.json({ removed: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Pulizia ufficio non riuscita') }, { status: 500 })
  }
}
