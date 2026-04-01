import { NextRequest } from 'next/server'
import { errorMessage, parseLimit } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

class BadRequestError extends Error {}

function parseDateParam(value: string | null, field: string) {
  if (!value) {
    throw new BadRequestError(`Parametro ${field} obbligatorio`)
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestError(`Parametro ${field} non valido`)
  }

  return date.toISOString()
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const start = parseDateParam(request.nextUrl.searchParams.get('start'), 'start')
    const end = parseDateParam(request.nextUrl.searchParams.get('end'), 'end')
    const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 200, 500)

    if (new Date(start).getTime() >= new Date(end).getTime()) {
      return Response.json({ error: 'Intervallo attività non valido' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('activities')
      .select(`
        id,
        user_id,
        contact_id,
        type,
        content,
        metadata,
        created_at,
        contact:contacts (
          id,
          name,
          status,
          priority,
          contact_scope
        )
      `)
      .eq('user_id', auth.user.id)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    return Response.json({ activities: data || [] })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load activities') },
      { status: error instanceof BadRequestError ? 400 : 500 }
    )
  }
}
