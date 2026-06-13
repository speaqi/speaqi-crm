import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { enrollContact, stopEnrollmentsForContact } from '@/lib/server/sequences'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const sequenceId = String(body.sequence_id || '').trim()
    const contactIds: string[] = Array.isArray(body.contact_ids)
      ? body.contact_ids.map((id: unknown) => String(id).trim()).filter(Boolean)
      : [String(body.contact_id || '').trim()].filter(Boolean)

    if (!sequenceId || !contactIds.length) {
      return Response.json({ error: 'sequence_id e contact_id sono obbligatori' }, { status: 400 })
    }

    const enrollments = []
    for (const contactId of contactIds) {
      enrollments.push(await enrollContact(auth.supabase, auth.workspaceUserId, sequenceId, contactId))
    }

    return Response.json({ enrolled: enrollments.length, enrollments })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile iscrivere il contatto') }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const contactId = String(body.contact_id || '').trim()
    if (!contactId) {
      return Response.json({ error: 'contact_id è obbligatorio' }, { status: 400 })
    }

    const stopped = await stopEnrollmentsForContact(
      auth.supabase,
      auth.workspaceUserId,
      contactId,
      String(body.reason || 'manual_stop')
    )
    return Response.json({ stopped })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile fermare la sequenza') }, { status: 500 })
  }
}
