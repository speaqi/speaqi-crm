import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

/**
 * Compagnie di navigazione (/navigazione). Il catalogo lo scrive lo script
 * `npm run shipping:import`; da qui si legge e si correggono gli scali.
 * Una correzione a mano accende `ports_manual`, cosi' un rilancio dello script
 * non la cancella.
 */

const SELECT =
  'id, slug, name, kind, segment, parent_group, hq_city, hq_country, hq_address, website, phone, email, ' +
  'italy_office, contacts, fleet_size, ships, calls_naples, calls_civitavecchia, ports_note, ports_manual, ' +
  'active, sources, contact_id, checked_at, created_at, updated_at'

function portFlag(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined
  if (value === true || value === false || value === null) return value
  return undefined
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('shipping_companies')
      .select(SELECT)
      .eq('user_id', auth.workspaceUserId)
      .order('name', { ascending: true })

    if (error) throw error
    return Response.json({ companies: data || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le compagnie') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const payload: Record<string, unknown> = {}
    const naples = portFlag(body.calls_naples)
    const civitavecchia = portFlag(body.calls_civitavecchia)
    if (naples !== undefined) payload.calls_naples = naples
    if (civitavecchia !== undefined) payload.calls_civitavecchia = civitavecchia
    if (body.ports_note !== undefined) {
      const note = String(body.ports_note || '').replace(/\s+/g, ' ').trim().slice(0, 600)
      payload.ports_note = note || null
    }
    if (!Object.keys(payload).length) return Response.json({ error: 'Niente da aggiornare' }, { status: 400 })
    payload.ports_manual = true
    payload.updated_at = new Date().toISOString()

    const { data, error } = await auth.supabase
      .from('shipping_companies')
      .update(payload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select(SELECT)
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Compagnia non trovata' }, { status: 404 })
    return Response.json({ company: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare') }, { status: 500 })
  }
}
