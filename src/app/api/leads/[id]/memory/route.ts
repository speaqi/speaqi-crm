import { NextRequest } from 'next/server'
import { readLeadMemory } from '@/lib/server/ai-ready'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const memory = await readLeadMemory(auth.supabase, auth.user.id, id)
    return Response.json({ memory })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load lead memory') }, { status: 500 })
  }
}
