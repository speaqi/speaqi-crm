import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.supabase
    .from('team_members')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('name', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ members: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const name = normalizeText(body.name)
    if (!name) return Response.json({ error: 'Nome obbligatorio' }, { status: 400 })

    const payload = {
      user_id: auth.user.id,
      name,
      email: normalizeText(body.email),
      color: normalizeText(body.color),
    }

    const { data, error } = await auth.supabase
      .from('team_members')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return Response.json({ error: 'Esiste già un membro con questo nome' }, { status: 409 })
      }
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ member: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Impossibile creare il membro' },
      { status: 500 }
    )
  }
}
