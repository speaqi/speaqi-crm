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

  return {
    token,
    user,
    supabase: createUserClient(token),
  }
}
