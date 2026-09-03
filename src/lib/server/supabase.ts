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
  email?: string | null
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

async function resolveTeamMemberWithUserClient(
  userSb: ReturnType<typeof createUserClient>,
  userId: string,
  emailLc: string
): Promise<TeamMemberCandidate | null> {
  const { data: linkedMembers, error: linkedError } = await userSb
    .from('team_members')
    .select('user_id, name, created_at')
    .eq('auth_user_id', userId)
    .limit(50)

  if (!linkedError && (linkedMembers || []).length >= 1) {
    return pickMostRecentCandidate((linkedMembers || []) as TeamMemberCandidate[])
  }

  if (!emailLc) return null

  const { data: matchedMembers, error: memberError } = await userSb
    .from('team_members')
    .select('user_id, name, created_at')
    .eq('email', emailLc)
    .limit(50)

  if (!memberError && (matchedMembers || []).length >= 1) {
    return pickMostRecentCandidate((matchedMembers || []) as TeamMemberCandidate[])
  }

  const { data: ilikeMembers, error: ilikeError } = await userSb
    .from('team_members')
    .select('user_id, name, created_at, email')
    .ilike('email', emailLc)
    .limit(50)

  if (!ilikeError && (ilikeMembers || []).length >= 1) {
    const normalized = (ilikeMembers || []).filter(
      (row: TeamMemberCandidate) => String(row.email || '').trim().toLowerCase() === emailLc
    )
    if (normalized.length) return pickMostRecentCandidate(normalized as TeamMemberCandidate[])
  }

  return null
}

async function resolveTeamMemberWithServiceRole(
  userId: string,
  emailLc: string
): Promise<TeamMemberCandidate | null> {
  const admin = createServiceRoleClient()

  const { data: linkedMembers, error: linkedError } = await admin
    .from('team_members')
    .select('user_id, name, created_at')
    .eq('auth_user_id', userId)
    .limit(50)

  if (!linkedError && (linkedMembers || []).length >= 1) {
    return pickMostRecentCandidate((linkedMembers || []) as TeamMemberCandidate[])
  }

  if (emailLc) {
    const { data: matchedMembers, error: memberError } = await admin
      .from('team_members')
      .select('user_id, name, created_at')
      .eq('email', emailLc)
      .limit(50)

    if (!memberError && (matchedMembers || []).length >= 1) {
      return pickMostRecentCandidate((matchedMembers || []) as TeamMemberCandidate[])
    }

    const { data: ilikeMembers, error: ilikeError } = await admin
      .from('team_members')
      .select('user_id, name, created_at, email')
      .ilike('email', emailLc)
      .limit(50)

    if (!ilikeError && (ilikeMembers || []).length >= 1) {
      const normalized = (ilikeMembers || []).filter(
        (row: TeamMemberCandidate) => String(row.email || '').trim().toLowerCase() === emailLc
      )
      if (normalized.length) return pickMostRecentCandidate(normalized as TeamMemberCandidate[])
    }
  }

  return null
}

/**
 * Cache in-process delle risoluzioni di identità.
 *
 * Ogni chiamata a `requireRouteUser` costava 1 round-trip verso GoTrue
 * (`auth.getUser`) più 1-3 query su `team_members`, in sequenza. Con 5-6
 * chiamate API per apertura pagina erano ~25 round-trip di puro overhead
 * prima ancora di leggere un contatto. Il TTL è corto apposta: un token
 * revocato smette di funzionare entro pochi secondi.
 */
type CachedEntry<T> = { value: T; expiresAt: number }

const AUTH_USER_TTL_MS = 30_000
const MEMBER_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 500

function cacheGet<T>(store: Map<string, CachedEntry<T>>, key: string): T | null {
  const hit = store.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    store.delete(key)
    return null
  }
  return hit.value
}

function cacheSet<T>(store: Map<string, CachedEntry<T>>, key: string, value: T, ttlMs: number) {
  if (store.size >= MAX_CACHE_ENTRIES) {
    // Mappa ordinata per inserimento: la chiave più vecchia è la prima.
    const oldest = store.keys().next()
    if (!oldest.done) store.delete(oldest.value)
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs })
}

type AuthUser = Awaited<ReturnType<ReturnType<typeof createPublicServerClient>['auth']['getUser']>>['data']['user']
type ResolvedIdentity = { workspaceUserId: string; isAdmin: boolean; memberName: string | null }

const authUserCache = new Map<string, CachedEntry<AuthUser>>()
const identityCache = new Map<string, CachedEntry<ResolvedIdentity>>()

/** Invalida le cache di identità (es. dopo una modifica al team). */
export function invalidateRouteUserCaches() {
  authUserCache.clear()
  identityCache.clear()
}

export async function requireRouteUser(request: NextRequest) {
  const token = getBearerToken(request)
  if (!token) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  let user = cacheGet(authUserCache, token)
  if (!user) {
    const authClient = createPublicServerClient()
    const { data, error } = await authClient.auth.getUser(token)
    if (error || !data.user) {
      return {
        error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
      }
    }
    user = data.user
    cacheSet(authUserCache, token, user, AUTH_USER_TTL_MS)
  }

  const emailLc = String(user.email || '').trim().toLowerCase()
  const userSb = createUserClient(token)
  const identityKey = `${user.id}|${emailLc}`

  const cachedIdentity = cacheGet(identityCache, identityKey)
  if (cachedIdentity) {
    return {
      token,
      user,
      supabase: userSb,
      workspaceUserId: cachedIdentity.workspaceUserId,
      isAdmin: cachedIdentity.isAdmin,
      memberName: cachedIdentity.memberName,
    }
  }

  let workspaceUserId = user.id
  let isAdmin = true
  let memberName: string | null = null

  try {
    let resolvedMember =
      (await resolveTeamMemberWithUserClient(userSb, user.id, emailLc)) || null

    if (!resolvedMember) {
      try {
        resolvedMember = await resolveTeamMemberWithServiceRole(user.id, emailLc)
      } catch {
        // No service role key or lookup failure; collaborator may be unresolved.
      }
    }

    if (resolvedMember?.user_id) {
      workspaceUserId = resolvedMember.user_id
      isAdmin = resolvedMember.user_id === user.id
      memberName = resolvedMember.name?.trim() || null
    }
  } catch {
    // Keep default owner/admin mapping.
  }

  if (isAdmin && !memberName?.trim()) {
    try {
      const { data: rows } = await userSb
        .from('team_members')
        .select('name, auth_user_id, email')
        .eq('user_id', workspaceUserId)
      const self = (rows || []).find(
        (row) =>
          row.auth_user_id === user.id ||
          String(row.email || '').trim().toLowerCase() === emailLc
      )
      const picked = self?.name?.trim()
      if (picked) memberName = picked
    } catch {
      // ignore
    }
  }

  if (isAdmin && !memberName?.trim()) {
    const meta = user.user_metadata as Record<string, unknown> | undefined
    const fromMeta = String(meta?.full_name || meta?.name || meta?.display_name || '').trim()
    if (fromMeta) memberName = fromMeta
  }

  cacheSet(identityCache, identityKey, { workspaceUserId, isAdmin, memberName }, MEMBER_TTL_MS)

  return {
    token,
    user,
    supabase: userSb,
    workspaceUserId,
    isAdmin,
    memberName,
  }
}
