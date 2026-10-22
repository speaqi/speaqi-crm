import { NextRequest } from 'next/server'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

/**
 * Le fatture sono del proprietario del workspace, come /incassi: un
 * collaboratore riceve 403 anche se conosce l'indirizzo. Le scritture passano
 * dal service role (il numero lo assegna una RPC riservata), sempre filtrate
 * per `user_id` del proprietario.
 */
export async function requireInvoiceOwner(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return { error: auth.error }
  if (!auth.isAdmin) return { error: Response.json({ error: 'Le fatture le gestisce solo il titolare.' }, { status: 403 }) }
  return { userId: auth.workspaceUserId, admin: createServiceRoleClient() }
}
