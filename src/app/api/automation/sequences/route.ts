import { NextRequest } from 'next/server'
import { processDueEnrollments } from '@/lib/server/sequences'
import { createServiceRoleClient } from '@/lib/server/supabase'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 200))
    const supabase = createServiceRoleClient()
    const result = await processDueEnrollments(supabase, limit)
    return Response.json(result)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to process sequences' },
      { status: 500 }
    )
  }
}
