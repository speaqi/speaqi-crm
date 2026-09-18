import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import {
  backfillWineProjectFollowups,
  queueDueWineProjectFollowups,
  reviveFailedWineProjectFollowups,
} from '@/lib/server/wine-project-automation'

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  try {
    const supabase = createServiceRoleClient()
    const backfill = await backfillWineProjectFollowups(supabase)
    // Prima della coda: un invio caduto per un 429 deve poter rientrare nello
    // stesso giro, altrimenti resta indietro di mezz'ora a ogni tentativo.
    const retries = await reviveFailedWineProjectFollowups(supabase)
    const queue = await queueDueWineProjectFollowups(supabase)
    return Response.json({ ok: true, backfill, retries, queue })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project followups failed') }, { status: 500 })
  }
}
