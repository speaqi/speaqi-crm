import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { deleteSequence, getSequence, updateSequence } from '@/lib/server/sequences'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const sequence = await getSequence(auth.supabase, auth.workspaceUserId, id)
    if (!sequence) return Response.json({ error: 'Sequenza non trovata' }, { status: 404 })
    return Response.json({ sequence })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare la sequenza') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const sequence = await updateSequence(auth.supabase, auth.workspaceUserId, id, {
      name: body.name,
      description: body.description,
      status: body.status,
      trigger_event: body.trigger_event,
      stop_on_reply: body.stop_on_reply,
      steps: Array.isArray(body.steps) ? body.steps : undefined,
    })
    return Response.json({ sequence })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare la sequenza') }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    await deleteSequence(auth.supabase, auth.workspaceUserId, id)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile archiviare la sequenza') }, { status: 500 })
  }
}
