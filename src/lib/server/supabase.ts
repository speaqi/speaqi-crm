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

type TeamMemberCandidate = {
  user_id?: string | null
  name?: string | null
  created_at?: string | null
}

function pickMostRecentCandidate(candidates: TeamMemberCandidate[]) {
  const withWorkspace = candidates.filter((candidate) => candidate.user_id)
  if (!withWorkspace.length) return null
  return [...withWorkspace].sort(
    (left, right) =>
      new Date(String(right.created_at || 0)).getTime() -
      new Date(String(left.created_at || 0)).getTime()
  )[0]
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
      let resolvedMember: TeamMemberCandidate | null = null

      try {
        const { data: linkedMembers, error: linkedError } = await admin
          .from('team_members')
          .select('user_id, name, created_at')
          .eq('auth_user_id', user.id)
          .limit(50)

        if (!linkedError && (linkedMembers || []).length >= 1) {
          resolvedMember = pickMostRecentCandidate((linkedMembers || []) as TeamMemberCandidate[])
        }
      } catch {
        // Ignore and fallback to email lookup (useful before auth_user_id migration).
      }

      if (!resolvedMember) {
        const { data: matchedMembers, error: memberError } = await admin
          .from('team_members')
          .select('user_id, name, created_at')
          .eq('email', email)
          .limit(50)

        if (!memberError && (matchedMembers || []).length >= 1) {
          resolvedMember = pickMostRecentCandidate((matchedMembers || []) as TeamMemberCandidate[])
        }
      }

      if (resolvedMember?.user_id) {
        workspaceUserId = resolvedMember.user_id
        isAdmin = resolvedMember.user_id === user.id
        memberName = resolvedMember.name || null
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
