import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'

type Params = { params: Promise<{ id: string }> }
async function access(request: NextRequest, id: string) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return { error: auth.error }
  let query = auth.supabase.from('contacts').select('id').eq('user_id', auth.workspaceUserId).eq('id', id)
  if (!auth.isAdmin) {
    const filter = contactAssigneeMatchOrFilter(auth.memberName)
    if (!filter) return { error: Response.json({ error: 'Contatto non trovato' }, { status: 404 }) }
    query = query.or(filter)
  }
  const { data, error } = await query.maybeSingle()
  if (error) return { error: Response.json({ error: errorMessage(error, 'Impossibile verificare il contatto') }, { status: 500 }) }
  if (!data) return { error: Response.json({ error: 'Contatto non trovato' }, { status: 404 }) }
  return { auth }
}
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const result = await access(request, id)
  if ('error' in result) return result.error
  const { data, error } = await result.auth.supabase.from('crm_projects').select('*').eq('user_id', result.auth.workspaceUserId).eq('contact_id', id).order('created_at')
  if (error) return Response.json({ error: errorMessage(error, 'Impossibile caricare i progetti') }, { status: 500 })
  return Response.json({ projects: data || [] })
}
async function save(request: NextRequest, { params }: Params, edit: boolean) {
  const { id } = await params
  const result = await access(request, id)
  if ('error' in result) return result.error
  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const status = String(body.status || 'demo')
  const interval = String(body.billing_interval || 'yearly')
  const price = body.price === null || body.price === '' || body.price === undefined ? null : Number(body.price)
  const terms = String(body.terms || '').trim()
  if (!name || name.length > 200 || !['demo','trial','active','suspended','archived'].includes(status) || !['monthly','yearly','custom'].includes(interval) || (price !== null && (!Number.isFinite(price) || price < 0 || price > 9999999999)) || terms.length > 4000)
    return Response.json({ error: 'Controlla nome, stato, costo e condizioni.' }, { status: 400 })
  const patch = { name, status, billing_interval: interval, price, terms }
  let query = edit
    ? result.auth.supabase.from('crm_projects').update(patch).eq('id', String(body.id || '')).eq('user_id', result.auth.workspaceUserId).eq('contact_id', id)
    : result.auth.supabase.from('crm_projects').insert({ ...patch, user_id: result.auth.workspaceUserId, contact_id: id })
  const { data, error } = await query.select('*').maybeSingle()
  if (error) return Response.json({ error: errorMessage(error, 'Impossibile salvare il progetto') }, { status: 500 })
  if (!data) return Response.json({ error: 'Progetto non trovato' }, { status: 404 })
  return Response.json({ project: data }, { status: edit ? 200 : 201 })
}
export async function POST(request: NextRequest, params: Params) { return save(request, params, false) }
export async function PATCH(request: NextRequest, params: Params) { return save(request, params, true) }
