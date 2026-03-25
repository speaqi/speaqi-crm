import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

function normalizeTaskRow(row: any) {
  return {
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const status = request.nextUrl.searchParams.get('status')
    let query = auth.supabase
      .from('tasks')
      .select('*, contact:contacts(id, name, status, source, priority, next_followup_at)')
      .eq('user_id', auth.user.id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error

    return Response.json({ tasks: (data || []).map(normalizeTaskRow) })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load tasks' },
      { status: 500 }
    )
  }
}
