import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data: drafts, error } = await auth.supabase
      .from('email_drafts')
      .select(`
        *,
        contact:contact_id (
          id, name, email, company, status, score, priority, next_followup_at
        )
      `)
      .eq('user_id', auth.workspaceUserId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error

    return Response.json({ drafts: drafts || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load drafts') }, { status: 500 })
  }
}
