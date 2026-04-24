import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/supabase'

function createBaseClient(accessToken?: string) {
  const { url, anonKey } = getSupabaseConfig()

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  })
}

export function createUserClient(accessToken: string) {
  return createBaseClient(accessToken)
}

export function createPublicServerClient() {
  return createBaseClient()
}

export function createServiceRoleClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for this operation')
  }

  const { url } = getSupabaseConfig()
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function getBearerToken(request: NextRequest) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length)
}

export async function requireRouteUser(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const authClient = createPublicServerClient()
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token)

  if (error || !user) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  let workspaceUserId = user.id
  let isAdmin = true
  let memberName: string | null = null
  const email = String(user.email || '').trim().toLowerCase()

  if (email) {
    try {
      const admin = createServiceRoleClient()
      const { data: linkedMembers, error: linkedError } = await admin
        .from('team_members')
        .select('user_id, name')
        .eq('auth_user_id', user.id)
        .limit(2)

      if (linkedError) throw linkedError

      if ((linkedMembers || []).length === 1) {
        const member = linkedMembers![0] as { user_id?: string | null; name?: string | null }
        if (member.user_id) {
          workspaceUserId = member.user_id
          isAdmin = member.user_id === user.id
          memberName = member.name || null
        }
      } else {
        const { data: matchedMembers, error: memberError } = await admin
        .from('team_members')
        .select('user_id, name, created_at')
        .ilike('email', email)
        .limit(10)

        if (memberError) throw memberError

        if ((matchedMembers || []).length >= 1) {
          const member = [...matchedMembers!]
            .sort(
              (left: any, right: any) =>
                new Date(String(right.created_at || 0)).getTime() -
                new Date(String(left.created_at || 0)).getTime()
            )[0] as { user_id?: string | null; name?: string | null }
          if (member.user_id) {
            workspaceUserId = member.user_id
            isAdmin = member.user_id === user.id
            memberName = member.name || null
          }
        }
      }
    } catch {
      // Keep default owner/admin behavior when team mapping is unavailable.
    }
  }

  return {
    token,
    user,
    supabase: createUserClient(token),
    workspaceUserId,
    isAdmin,
    memberName,
  }
}
