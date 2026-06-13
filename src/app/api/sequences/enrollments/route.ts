import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { listEnrollmentsForContact } from '@/lib/server/sequences'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const contactId = String(new URL(request.url).searchParams.get('contact_id') || '').trim()
    if (!contactId) {
      return Response.json({ error: 'contact_id è obbligatorio' }, { status: 400 })
    }
    const enrollments = await listEnrollmentsForContact(auth.supabase, auth.workspaceUserId, contactId)
    return Response.json({ enrollments })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le iscrizioni') }, { status: 500 })
  }
}
