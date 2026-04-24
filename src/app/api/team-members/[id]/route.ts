import { NextRequest } from 'next/server'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin può modificare collaboratori' }, { status: 403 })
  const { id } = await params

  try {
    const body = await request.json()
    const update: Record<string, unknown> = {}
    let nextName: string | null = null
    if ('name' in body) {
      const name = normalizeText(body.name)
      if (!name) return Response.json({ error: 'Nome non valido' }, { status: 400 })
      update.name = name
      nextName = name
    }
    if ('email' in body) update.email = normalizeText(body.email)?.toLowerCase() || null
    if ('color' in body) update.color = normalizeText(body.color)

    const admin = createServiceRoleClient()
    let previousName: string | null = null
    if (nextName) {
      const { data: currentMember, error: currentMemberError } = await admin
        .from('team_members')
        .select('name')
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .single()
      if (currentMemberError) return Response.json({ error: currentMemberError.message }, { status: 500 })
      previousName = String(currentMember?.name || '').trim() || null
    }

    const { data, error } = await admin
      .from('team_members')
      .update(update)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (previousName && nextName && previousName !== nextName) {
      const { error: contactsUpdateError } = await admin
        .from('contacts')
        .update({ responsible: nextName })
        .eq('user_id', auth.workspaceUserId)
        .eq('responsible', previousName)
      if (contactsUpdateError) {
        return Response.json({ error: contactsUpdateError.message }, { status: 500 })
      }
    }

    return Response.json({ member: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Impossibile aggiornare il membro' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin può rimuovere collaboratori' }, { status: 403 })
  const { id } = await params

  const admin = createServiceRoleClient()
  const { error } = await admin
    .from('team_members')
    .delete()
    .eq('user_id', auth.workspaceUserId)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
