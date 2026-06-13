import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createSequence, listSequences } from '@/lib/server/sequences'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const sequences = await listSequences(auth.supabase, auth.workspaceUserId)
    return Response.json({ sequences })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le sequenze') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const sequence = await createSequence(auth.supabase, auth.workspaceUserId, {
      name: body.name,
      description: body.description,
      status: body.status,
      trigger_event: body.trigger_event,
      stop_on_reply: body.stop_on_reply,
      steps: Array.isArray(body.steps) ? body.steps : [],
    })
    return Response.json({ sequence })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile creare la sequenza') }, { status: 400 })
  }
}
