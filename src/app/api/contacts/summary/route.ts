import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { cachedSummary } from '@/lib/server/summary-cache'

/**
 * Conteggi e cartelle in un solo scan; la RPC conserva RLS e filtro assegnatario.
 *
 * Lo scan legge tutti i contatti (62 mila, quasi tutti hotel e cantine in
 * holding) e sul piano Free costa ~2,5 s. `useCRM` lo richiede dopo ogni
 * modifica: il risultato resta in memoria e chi arriva dopo 15 s riceve
 * subito i numeri di prima mentre il ricalcolo parte dietro.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const memberName = !auth.isAdmin && auth.memberName ? auth.memberName.trim() : null
    const data = await cachedSummary(`${auth.workspaceUserId}:${memberName || ''}`, async () => {
      const { data, error } = await auth.supabase.rpc('contact_workspace_summary', {
        p_user_id: auth.workspaceUserId,
        p_member_name: memberName,
      })
      if (error) throw error
      return data
    })

    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load contact counts') },
      { status: 500 }
    )
  }
}
