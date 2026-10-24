import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { DestinationEmailError, loadDestinationSignature, reconcileDestinationDraft, sendDestinationEmail } from '@/lib/server/trade-fair-destination-email'
import { errorMessage } from '@/lib/server/http'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Le fiere sono di Tourism Intelligence: solo il titolare' }, { status: 403 })
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (id) return Response.json({ exhibitor: await reconcileDestinationDraft(auth.supabase, auth.workspaceUserId, id) })
    const signature = await loadDestinationSignature(auth.supabase, auth.workspaceUserId)
    return Response.json({ signature: signature.text })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile leggere la firma CRM.') }, { status: error instanceof DestinationEmailError ? error.status : 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Le fiere sono di Tourism Intelligence: solo il titolare' }, { status: 403 })
  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'Destinazione mancante.' }, { status: 400 })
    return Response.json(await sendDestinationEmail(auth.supabase, auth.workspaceUserId, {
      id, subject: String(body.subject || ''), text: String(body.text || ''), mode: body.mode === 'draft' ? 'draft' : undefined,
    }))
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile inviare l’email.') }, { status: error instanceof DestinationEmailError ? error.status : 500 })
  }
}
