import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

/** Conteggi e cartelle in un solo scan; la RPC conserva RLS e filtro assegnatario. */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase.rpc('contact_workspace_summary', {
      p_user_id: auth.workspaceUserId,
      p_member_name: !auth.isAdmin && auth.memberName ? auth.memberName.trim() : null,
    })
    if (error) throw error

    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load contact counts') },
      { status: 500 }
    )
  }
}
