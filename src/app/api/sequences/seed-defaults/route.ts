import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { seedDefaultSequences } from '@/lib/server/sequences'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const sequence = await seedDefaultSequences(auth.supabase, auth.workspaceUserId)
    return Response.json({ sequence })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile creare la sequenza predefinita') }, { status: 500 })
  }
}
