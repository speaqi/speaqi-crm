import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { runOfficeWorker } from '@/lib/server/office-work'

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  const result = await runOfficeWorker(auth.context.workspaceUserId)
  return Response.json(result, { status: result.outcome === 'failed' ? 502 : 200 })
}
