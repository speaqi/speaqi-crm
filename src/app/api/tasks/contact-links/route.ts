import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const { data, error } = await auth.supabase.from('todo_contact_links')
    .select('task_id,contact:contacts(*)').eq('user_id', auth.user.id)
  if (error) return Response.json({ error: errorMessage(error, 'Collegamenti non disponibili') }, { status: 500 })
  return Response.json({ links: data || [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  try {
    const body = await request.json()
    if (!body.task_id || typeof body.task_id !== 'string') return Response.json({ error: 'Attività non valida' }, { status: 400 })
    const { data, error } = await auth.supabase.rpc('activate_todo_contact', { p_task_id: body.task_id, p_contact_id: body.contact_id || null })
    if (error) throw error
    return Response.json(data)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile attivare il contatto') }, { status: 500 })
  }
}
