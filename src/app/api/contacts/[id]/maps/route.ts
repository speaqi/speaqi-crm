import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'

/**
 * POST { map_ref, role?, note? }: collega una mappa a un contatto.
 * DELETE ?link_id=: toglie il collegamento (la mappa non si tocca).
 */
const ROLES = ['client', 'partner', 'prospect', 'guide']

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const mapRef = String(body?.map_ref || '').trim().slice(0, 120)
  const role = ROLES.includes(body?.role) ? body.role : 'client'
  const note = body?.note ? String(body.note).trim().slice(0, 500) || null : null
  if (mapRef.length < 2) return Response.json({ error: 'Scrivi lo slug o il nome della mappa.' }, { status: 400 })

  try {
    const contact = await admin.from('contacts').select('id').eq('user_id', userId).eq('id', id).maybeSingle()
    if (!contact.data) return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    const { data, error } = await admin
      .from('contact_map_links')
      .upsert({ user_id: userId, contact_id: id, map_ref: mapRef, role, note }, { onConflict: 'user_id,contact_id,map_ref' })
      .select('id, map_ref, role, note')
      .single()
    if (error) throw error
    return Response.json({ link: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Collegamento non riuscito') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth
  const { id } = await params
  const linkId = request.nextUrl.searchParams.get('link_id')
  if (!linkId) return Response.json({ error: 'link_id mancante' }, { status: 400 })
  const { error } = await admin.from('contact_map_links').delete().eq('user_id', userId).eq('contact_id', id).eq('id', linkId)
  if (error) return Response.json({ error: errorMessage(error, 'Non riuscito') }, { status: 500 })
  return Response.json({ ok: true })
}
