import { NextRequest } from 'next/server'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

/**
 * Prima pagina e scheda completa sono del titolare: mettono insieme soldi,
 * fatture e trattative di tutto il workspace. Un collaboratore riceve 403.
 * Le letture passano dal service role, sempre filtrate per `user_id`.
 */
export async function requireWorkspaceOwner(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return { error: auth.error }
  if (!auth.isAdmin) return { error: Response.json({ error: 'Questa vista e’ solo del titolare.' }, { status: 403 }) }
  return { userId: auth.workspaceUserId, admin: createServiceRoleClient() }
}
