import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const { data, error } = await auth.supabase.from('tourism_crm_links').select('contact_id').eq('user_id', auth.workspaceUserId)
  if (error) return Response.json({ error: errorMessage(error, 'Collegamenti Turismo non disponibili') }, { status: 500 })
  return Response.json({ contactIds: (data || []).map((link) => link.contact_id) })
}
