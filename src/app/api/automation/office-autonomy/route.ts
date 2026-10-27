import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { runOfficeAutonomy } from '@/lib/server/office-autonomy'

/**
 * Il giro dell'autonomia dell'Ufficio (job `office-autonomy`): approva le proposte sicure
 * mature e porta su Telegram quelle da decidere. Workspace solo dalle env, mai dal corpo.
 */
export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  const userId = String(process.env.AUTOMATION_WORKSPACE_USER_ID || '').trim()
  if (!userId) return Response.json({ error: 'AUTOMATION_WORKSPACE_USER_ID non configurato' }, { status: 503 })
  try {
    const result = await runOfficeAutonomy(createServiceRoleClient(), userId)
    return Response.json(result, { status: result.failed.length && !result.approved.length ? 502 : 200 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Giro dell’autonomia non riuscito') }, { status: 500 })
  }
}
