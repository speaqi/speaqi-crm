import { NextRequest } from 'next/server'
import { createServiceRoleClient, invalidateRouteUserCaches, requireRouteUser } from '@/lib/server/supabase'
import {
  TeamLoginError,
  assertAuthUserBelongsToWorkspace,
  ensureMemberLogin,
  findAuthUserIdByEmail,
} from '@/lib/server/team-login'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.supabase
    .from('team_members')
    .select('*')
    .eq('user_id', auth.workspaceUserId)
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  const emailLc = String(auth.user.email || '').trim().toLowerCase()
  const members = (data || []).map((member: any) => {
    const memberEmail = String(member.email || '').trim().toLowerCase()
    return {
      ...member,
      is_current_admin:
        auth.isAdmin &&
        (member.auth_user_id === auth.user.id || (Boolean(memberEmail) && memberEmail === emailLc)),
    }
  })
  return Response.json({
    members,
    is_admin: auth.isAdmin,
    member_name: auth.memberName,
    allowed_areas: auth.allowedAreas,
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin può creare collaboratori' }, { status: 403 })

  try {
    const body = await request.json()
    const name = normalizeText(body.name)
    const email = normalizeText(body.email)?.toLowerCase() || null
    const password = normalizeText(body.password)
    if (!name) return Response.json({ error: 'Nome obbligatorio' }, { status: 400 })
    if (password && !email) {
      return Response.json({ error: 'Email obbligatoria per creare accesso con password' }, { status: 400 })
    }

    const admin = createServiceRoleClient()
    const scope = { workspaceUserId: auth.workspaceUserId, currentUserId: auth.user.id }
    let authUserId: string | null = null
    if (email && password) {
      // Se l'email ha già un accesso libero (collaboratore rimosso e ricreato) lo riusa.
      authUserId = (await ensureMemberLogin(admin, email, password, scope)).authUserId
    } else if (email) {
      const matchedId = await findAuthUserIdByEmail(admin, email)
      if (matchedId) {
        try {
          await assertAuthUserBelongsToWorkspace(admin, matchedId, scope)
          authUserId = matchedId
        } catch {
          // Accesso di qualcun altro: il collaboratore nasce senza login.
        }
      }
    }

    const payload = {
      user_id: auth.workspaceUserId,
      name,
      email,
      auth_user_id: authUserId,
      color: normalizeText(body.color),
    }

    const { data, error } = await admin
      .from('team_members')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505' && String(error.message).includes('auth_user')) {
        return Response.json({ error: 'Questa email è già l’accesso di un altro collaboratore del team' }, { status: 409 })
      }
      if (error.code === '23505') {
        return Response.json({ error: 'Esiste già un membro con questo nome' }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }
    invalidateRouteUserCaches()
    return Response.json({ member: data })
  } catch (error) {
    if (error instanceof TeamLoginError) return Response.json({ error: error.message }, { status: error.status })
    return Response.json(
      { error: error instanceof Error ? error.message : 'Impossibile creare il membro' },
      { status: 500 }
    )
  }
}
