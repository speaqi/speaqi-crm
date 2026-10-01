import { NextRequest } from 'next/server'
import { isAreaKey } from '@/lib/areas'
import { createServiceRoleClient, invalidateRouteUserCaches, requireRouteUser } from '@/lib/server/supabase'
import {
  TeamLoginError,
  assertAuthUserBelongsToWorkspace,
  ensureMemberLogin,
  setMemberPassword,
} from '@/lib/server/team-login'

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
    if ('allowed_areas' in body) {
      const areas: unknown = body.allowed_areas
      if (!Array.isArray(areas) || !areas.every(isAreaKey)) {
        return Response.json({ error: 'Aree non valide' }, { status: 400 })
      }
      update.allowed_areas = Array.from(new Set(areas))
    }

    const admin = createServiceRoleClient()
    if (body.make_admin === true) {
      await admin
        .from('team_members')
        .update({ auth_user_id: null })
        .eq('user_id', auth.workspaceUserId)
        .eq('auth_user_id', auth.user.id)
      update.auth_user_id = auth.user.id
    }

    // Cambio password: aggiorna l'accesso esistente, o lo crea se il collaboratore
    // ne era senza (o l'aveva perso rimuovendolo e ricreandolo).
    let passwordChanged = false
    if ('password' in body) {
      const password = String(body.password || '')
      const { data: member, error: memberError } = await admin
        .from('team_members')
        .select('id, email, auth_user_id')
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .single()
      if (memberError || !member) return Response.json({ error: 'Collaboratore non trovato' }, { status: 404 })
      const scope = { workspaceUserId: auth.workspaceUserId, currentUserId: auth.user.id, memberId: id }
      if (member.auth_user_id) {
        await assertAuthUserBelongsToWorkspace(admin, member.auth_user_id, scope)
        await setMemberPassword(admin, member.auth_user_id, password)
      } else {
        const email = String(update.email ?? member.email ?? '').trim().toLowerCase()
        if (!email) {
          return Response.json({ error: 'Serve un’email per creare l’accesso di questo collaboratore' }, { status: 400 })
        }
        update.auth_user_id = (await ensureMemberLogin(admin, email, password, scope)).authUserId
      }
      passwordChanged = true
    }

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

    if (passwordChanged && Object.keys(update).length === 0) {
      const { data: unchanged, error: readError } = await admin
        .from('team_members')
        .select('*')
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .single()
      if (readError) return Response.json({ error: readError.message }, { status: 500 })
      return Response.json({ member: unchanged, password_changed: true })
    }

    const { data, error } = await admin
      .from('team_members')
      .update(update)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    // Permessi e collegamento admin devono valere subito, non dopo il TTL della cache identità.
    invalidateRouteUserCaches()

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

    return Response.json({ member: data, password_changed: passwordChanged })
  } catch (error) {
    if (error instanceof TeamLoginError) return Response.json({ error: error.message }, { status: error.status })
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
