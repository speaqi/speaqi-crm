import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'

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
  const areaError = requireArea(auth, 'navigazione')
  if (areaError) return areaError

  try {
    const { data, error } = await auth.supabase
      .from('shipping_companies')
      .select(SELECT)
      .eq('user_id', auth.workspaceUserId)
      .order('name', { ascending: true })

    if (error) throw error

    // Porti toccati dagli itinerari caricati, per compagnia: la pagina li usa per
    // dire "ci arriva" anche quando il catalogo non lo sapeva.
    const [itinerariesResult, stopsResult] = await Promise.all([
      auth.supabase.from('shipping_itineraries').select('id, company_id').eq('user_id', auth.workspaceUserId),
      auth.supabase
        .from('shipping_itinerary_stops')
        .select('itinerary_id, port:shipping_ports(slug)')
        .eq('user_id', auth.workspaceUserId),
    ])
    if (itinerariesResult.error) throw itinerariesResult.error
    if (stopsResult.error) throw stopsResult.error
    const companyOf = new Map<string, string>()
    const counts = new Map<string, number>()
    for (const row of itinerariesResult.data || []) {
      companyOf.set(row.id, row.company_id)
      counts.set(row.company_id, (counts.get(row.company_id) || 0) + 1)
    }
    const portsOf = new Map<string, Set<string>>()
    for (const stop of (stopsResult.data || []) as Array<{ itinerary_id: string; port: { slug: string } | { slug: string }[] | null }>) {
      const companyId = companyOf.get(stop.itinerary_id)
      const port = Array.isArray(stop.port) ? stop.port[0] : stop.port
      if (!companyId || !port?.slug) continue
      const set = portsOf.get(companyId) || new Set<string>()
      set.add(port.slug)
      portsOf.set(companyId, set)
    }

    return Response.json({
      companies: ((data || []) as unknown as Array<{ id: string }>).map((company) => ({
        ...company,
        itinerary_count: counts.get(company.id) || 0,
        itinerary_ports: Array.from(portsOf.get(company.id) || []),
      })),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le compagnie') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'navigazione')
  if (areaError) return areaError

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
