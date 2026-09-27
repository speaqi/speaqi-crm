import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { resolveStopPorts } from '@/lib/server/shipping-ports'
import {
  ItineraryStopRole,
  parseDepartureDates,
  parseItineraryText,
  ParsedStop,
} from '@/lib/shipping-itineraries'

/**
 * Itinerari delle compagnie di navigazione: una crociera o una linea con le sue
 * tappe in ordine. Le tappe arrivano o gia' strutturate (dall'anteprima della
 * pagina, dove si puo' correggere il porto riconosciuto) o come testo incollato
 * (`stops_text`, comodo da script). In entrambi i casi il porto lo decide il
 * server: un `port_id` viene verificato dalla RPC, un nome viene riconosciuto o
 * diventa un porto nuovo.
 */

const ITINERARY_SELECT =
  'id, company_id, name, ship, nights, season, departure_dates, source_url, notes, active, created_at, updated_at, ' +
  'company:shipping_companies(id, name, slug), ' +
  'stops:shipping_itinerary_stops(id, position, day, port_id, role, arrival, departure, overnight, notes, port:shipping_ports(id, slug, name, country))'

const ROLES: ItineraryStopRole[] = ['embark', 'call', 'disembark', 'turnaround']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MAX_STOPS = 120

function text(value: unknown, max: number) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

function sortStops(itinerary: any) {
  return { ...itinerary, stops: [...(itinerary.stops || [])].sort((a, b) => a.position - b.position) }
}

type StopInput = ParsedStop & { port_id: string | null }

function stopsFromBody(body: any): StopInput[] | { error: string } {
  if (typeof body.stops_text === 'string' && body.stops_text.trim()) {
    return parseItineraryText(body.stops_text).stops.map((stop) => ({ ...stop, port_id: null }))
  }
  if (!Array.isArray(body.stops)) return { error: 'Servono le tappe' }
  const stops: StopInput[] = []
  for (const raw of body.stops) {
    if (!raw || typeof raw !== 'object') continue
    const portId = text(raw.port_id, 40)
    const name = text(raw.name, 120)
    if (!portId && !name) return { error: 'Ogni tappa ha bisogno di un porto' }
    const day = Number(raw.day)
    const arrival = text(raw.arrival, 5)
    const departure = text(raw.departure, 5)
    if ((arrival && !TIME.test(arrival)) || (departure && !TIME.test(departure))) {
      return { error: `Orario non valido nella tappa ${name || stops.length + 1}` }
    }
    stops.push({
      port_id: portId,
      line: name || '',
      name: name || '',
      alt: text(raw.alt, 120),
      country: text(raw.country, 2)?.toUpperCase() || null,
      day: Number.isInteger(day) && day >= 1 && day <= 400 ? day : null,
      role: ROLES.includes(raw.role) ? raw.role : 'call',
      arrival,
      departure,
      overnight: raw.overnight === true,
    })
  }
  return stops
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const params = request.nextUrl.searchParams
    const companyId = params.get('company_id')
    const portId = params.get('port_id')

    let query = auth.supabase
      .from('shipping_itineraries')
      .select(ITINERARY_SELECT)
      .eq('user_id', auth.workspaceUserId)
      .order('name', { ascending: true })
    if (companyId) query = query.eq('company_id', companyId)
    if (portId) {
      const { data: stopRows, error: stopError } = await auth.supabase
        .from('shipping_itinerary_stops')
        .select('itinerary_id')
        .eq('user_id', auth.workspaceUserId)
        .eq('port_id', portId)
      if (stopError) throw stopError
      const ids = Array.from(new Set((stopRows || []).map((row: { itinerary_id: string }) => row.itinerary_id)))
      if (!ids.length) return Response.json({ itineraries: [] })
      query = query.in('id', ids)
    }

    const { data, error } = await query
    if (error) throw error
    return Response.json({ itineraries: (data || []).map(sortStops) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare gli itinerari') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const companyId = text(body.company_id, 40)
    const name = text(body.name, 160)
    if (!companyId) return Response.json({ error: 'Compagnia mancante' }, { status: 400 })
    if (!name) return Response.json({ error: "Dai un nome all'itinerario" }, { status: 400 })

    const stops = stopsFromBody(body)
    if ('error' in stops) return Response.json({ error: stops.error }, { status: 400 })
    if (!stops.length) return Response.json({ error: 'Nessuna tappa riconosciuta' }, { status: 400 })
    if (stops.length > MAX_STOPS) return Response.json({ error: `Al massimo ${MAX_STOPS} tappe` }, { status: 400 })

    const dates = parseDepartureDates(body.departure_dates)
    if (dates.invalid.length) {
      return Response.json({ error: `Date non valide: ${dates.invalid.join(', ')}` }, { status: 400 })
    }
    const nights = body.nights === undefined || body.nights === null || body.nights === '' ? null : Number(body.nights)
    if (nights !== null && (!Number.isInteger(nights) || nights < 0 || nights > 400)) {
      return Response.json({ error: 'Numero di notti non valido' }, { status: 400 })
    }

    // Le tappe senza porto scelto passano dal riconoscimento per nome (e creano i porti nuovi).
    const toResolve = stops.filter((stop) => !stop.port_id)
    const resolved = toResolve.length
      ? await resolveStopPorts(auth.supabase, auth.workspaceUserId, toResolve)
      : { portIds: [], created: [] }
    let cursor = 0
    const payloadStops = stops.map((stop, index) => ({
      position: index + 1,
      day: stop.day,
      port_id: stop.port_id || resolved.portIds[cursor++],
      role: stop.role,
      arrival: stop.arrival,
      departure: stop.departure,
      overnight: stop.overnight,
      notes: null,
    }))

    const { data: savedId, error: saveError } = await auth.supabase.rpc('save_shipping_itinerary', {
      p_itinerary: {
        id: text(body.id, 40),
        company_id: companyId,
        name,
        ship: text(body.ship, 120),
        nights,
        season: text(body.season, 80),
        departure_dates: dates.dates,
        source_url: text(body.source_url, 500),
        notes: text(body.notes, 2000),
        active: body.active !== false,
      },
      p_stops: payloadStops,
    })
    if (saveError) {
      const status = saveError.code === 'P0002' ? 404 : saveError.code === '22023' ? 400 : 500
      return Response.json({ error: saveError.message }, { status })
    }

    const { data, error } = await auth.supabase
      .from('shipping_itineraries')
      .select(ITINERARY_SELECT)
      .eq('id', savedId as string)
      .single()
    if (error) throw error
    return Response.json(
      { itinerary: sortStops(data), created_ports: resolved.created },
      { status: body.id ? 200 : 201 }
    )
  } catch (error) {
    return Response.json({ error: errorMessage(error, "Impossibile salvare l'itinerario") }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })
    const { data, error } = await auth.supabase
      .from('shipping_itineraries')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Itinerario non trovato' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, "Impossibile eliminare l'itinerario") }, { status: 500 })
  }
}
