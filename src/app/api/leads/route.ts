import { NextRequest } from 'next/server'
import { normalizeLeadRecord, normalizeLeadStatus } from '@/lib/server/ai-ready'
import { errorMessage, parseLimit } from '@/lib/server/http'
import { createLeadFromInput } from '@/lib/server/lead-ops'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const statusFilter = request.nextUrl.searchParams.get('status')
    const sourceFilter = request.nextUrl.searchParams.get('source')
    const categoryFilter = request.nextUrl.searchParams.get('category')
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 100, 500)

    let query = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('next_action_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (sourceFilter) {
      query = query.eq('source', sourceFilter)
    }

    if (categoryFilter) {
      query = query.eq('category', categoryFilter)
    }

    const { data, error } = await query
    if (error) throw error

    const leads = (data || [])
      .map(normalizeLeadRecord)
      .filter((lead) => !statusFilter || lead.status === normalizeLeadStatus(statusFilter))

    return Response.json({ leads })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load leads') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const result = await createLeadFromInput(auth.supabase, auth.user.id, body)
    return Response.json(result, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to create lead') }, { status: 500 })
  }
}
