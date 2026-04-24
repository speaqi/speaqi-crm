import { NextRequest } from 'next/server'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const admin = createServiceRoleClient()
  const { data, error } = await admin
    .from('team_members')
    .select('*')
    .eq('user_id', auth.workspaceUserId)
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ members: data || [], is_admin: auth.isAdmin })
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
    let authUserId: string | null = null
    if (email && password) {
      const { data: createdUserResult, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createError) {
        return Response.json(
          {
            error:
              createError.message.includes('already registered')
                ? 'Email già registrata in auth. Usa un’altra email o resetta password da Supabase.'
                : createError.message,
          },
          { status: 400 }
        )
      } else {
        authUserId = createdUserResult.user?.id || null
        if (!authUserId) {
          const { data: linkedUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
          const matchedUser = (linkedUsers?.users || []).find(
            (candidate) => String(candidate.email || '').toLowerCase() === email
          )
          authUserId = matchedUser?.id || null
        }
      }
    } else if (email) {
      const { data: linkedUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
      const matchedUser = (linkedUsers?.users || []).find(
        (candidate) => String(candidate.email || '').toLowerCase() === email
      )
      authUserId = matchedUser?.id || null
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
      if (error.code === '23505') {
        return Response.json({ error: 'Esiste già un membro con questo nome' }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ member: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Impossibile creare il membro' },
      { status: 500 }
    )
  }
}
