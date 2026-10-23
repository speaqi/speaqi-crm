import type { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from './owner-auth'
import { errorMessage } from './http'

/** Un solo cancello del titolare per tutte le API dell'ufficio. */
export async function officeOwnerRoute(request: NextRequest,
  handler: (auth: { admin: ReturnType<typeof import('./supabase').createServiceRoleClient>; userId: string }) => Promise<Response>) {
  try {
    const auth = await requireWorkspaceOwner(request)
    if ('error' in auth) return auth.error!
    return await handler(auth)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Ufficio non disponibile') }, { status: 500 })
  }
}
export function officeRunKey(request: NextRequest): string | null {
  const key = request.headers.get('idempotency-key') || ''
  return /^[a-zA-Z0-9:_-]{8,160}$/.test(key) ? key : null
}
