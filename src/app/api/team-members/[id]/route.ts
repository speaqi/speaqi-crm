import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  try {
    const body = await request.json()
    const update: Record<string, unknown> = {}
    if ('name' in body) {
      const name = normalizeText(body.name)
      if (!name) return Response.json({ error: 'Nome non valido' }, { status: 400 })
      update.name = name
    }
    if ('email' in body) update.email = normalizeText(body.email)
    if ('color' in body) update.color = normalizeText(body.color)

    const { data, error } = await auth.supabase
      .from('team_members')
      .update(update)
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ member: data })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Impossibile aggiornare il membro' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const { id } = await params

  const { error } = await auth.supabase
    .from('team_members')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
