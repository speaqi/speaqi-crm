import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { runSiteResearch } from '@/lib/server/tourism-research'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180
export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    // The source registry controls scope; one due site per tick and no paid model calls.
    return Response.json(
      await runSiteResearch(
        createServiceRoleClient(),
        auth.context.workspaceUserId
      )
    )
  } catch (error) {
    console.error(
      '[tourism-research]',
      error instanceof Error ? error.message : 'Research failed'
    )
    return Response.json(
      { error: 'Controllo dei siti non completato' },
      { status: 500 }
    )
  }
}
