import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

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
      .select(
        '*, contact:contacts(id, name, status, source, category, company, phone, responsible, event_tag, last_activity_summary, contact_scope, priority, next_followup_at)'
      )
      .eq('user_id', auth.workspaceUserId)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (!auth.isAdmin) {
      if (!auth.memberName) return Response.json({ tasks: [] })
      query = query.eq('contact.responsible', auth.memberName)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error

    return Response.json({ tasks: (data || []).map(normalizeTaskRow) })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load tasks') },
      { status: 500 }
    )
  }
}
