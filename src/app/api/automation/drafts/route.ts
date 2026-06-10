import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status') || 'pending'

    let query = auth.supabase
      .from('email_drafts')
      .select(`
        *,
        contact:contact_id (
          id, name, email, company, status, score, priority, next_followup_at
        )
      `)
      .eq('user_id', auth.workspaceUserId)
      .order('created_at', { ascending: false })
      .limit(50)

    // Allow filtering by status (pending, sent, dismissed)
    if (statusFilter === 'all') {
      // no status filter
    } else {
      query = query.eq('status', statusFilter)
    }

    const { data: drafts, error } = await query

    if (error) throw error

    return Response.json({ drafts: drafts || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load drafts') }, { status: 500 })
  }
}
