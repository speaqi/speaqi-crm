import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { buildOperatingQueue } from '@/lib/server/operating-center'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { searchParams } = request.nextUrl
    const queue = await buildOperatingQueue(auth.supabase, auth.workspaceUserId, {
      mode: searchParams.get('mode'),
      limit: Number(searchParams.get('limit') || 80),
      agent: searchParams.get('agent'),
      source: searchParams.get('source'),
      category: searchParams.get('category'),
      isAdmin: auth.isAdmin,
      memberName: auth.memberName,
    })

    return Response.json(queue)
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Impossibile caricare la coda operativa') },
      { status: 500 }
    )
  }
}
