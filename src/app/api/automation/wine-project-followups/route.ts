import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { backfillWineProjectFollowups, queueDueWineProjectFollowups } from '@/lib/server/wine-project-automation'

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  try {
    const supabase = createServiceRoleClient()
    const backfill = await backfillWineProjectFollowups(supabase)
    const queue = await queueDueWineProjectFollowups(supabase)
    return Response.json({ ok: true, backfill, queue })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project followups failed') }, { status: 500 })
  }
}
