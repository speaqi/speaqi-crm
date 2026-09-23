import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

/** Link vendita attivi del workspace: mai il token, solo le ultime 4 cifre. */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ links: [] })

  try {
    const { data, error } = await auth.supabase
      .from('sales_links')
      .select('team_member_id, created_at, token_hint, last_used_at')
      .eq('user_id', auth.workspaceUserId)
      .is('revoked_at', null)
    if (error) throw error
    return Response.json({ links: data || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile leggere i link vendita') }, { status: 500 })
  }
}
