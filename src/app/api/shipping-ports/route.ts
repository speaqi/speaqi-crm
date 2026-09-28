import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { loadShippingPorts, PORT_COLUMNS } from '@/lib/server/shipping-ports'
import { normalizePortWorldPatch } from '@/lib/shipping-ports'
import { countryCode, normalizePortKey } from '@/lib/shipping-itineraries'

/**
 * Porti degli itinerari (/navigazione → Porti). Il GET dice anche chi ci arriva:
 * le compagnie che ci fanno tappa in un itinerario caricato e, per Napoli e
 * Civitavecchia, quelle che il catalogo segna gia' come "ci arriva" anche senza
 * itinerario — altrimenti la vista per porto direbbe meno della pagina compagnie.
 */

const LEGACY_FLAGS: Record<string, 'calls_naples' | 'calls_civitavecchia'> = {
  napoli: 'calls_naples',
  civitavecchia: 'calls_civitavecchia',
}

function cleanAliases(value: unknown, name: string) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/)
  const seen = new Set([normalizePortKey(name)])
  const result: string[] = []
  for (const item of list) {
    const alias = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const key = normalizePortKey(alias)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(alias)
  }
  return result.slice(0, 30)
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const userId = auth.workspaceUserId
    const ports = await loadShippingPorts(auth.supabase, userId)
    const [stopsResult, itinerariesResult, companiesResult] = await Promise.all([
      auth.supabase.from('shipping_itinerary_stops').select('port_id, itinerary_id').eq('user_id', userId),
      auth.supabase.from('shipping_itineraries').select('id, company_id').eq('user_id', userId),
      auth.supabase
        .from('shipping_companies')
        .select('id, name, active, calls_naples, calls_civitavecchia')
        .eq('user_id', userId),
    ])
    if (stopsResult.error) throw stopsResult.error
    if (itinerariesResult.error) throw itinerariesResult.error
    if (companiesResult.error) throw companiesResult.error

    const companyOfItinerary = new Map<string, string>(
      (itinerariesResult.data || []).map((row: { id: string; company_id: string }) => [row.id, row.company_id])
    )
    const companies = companiesResult.data || []
    const usage = new Map<string, { itineraries: Set<string>; companies: Set<string> }>()
    for (const stop of stopsResult.data || []) {
      const entry = usage.get(stop.port_id) || { itineraries: new Set<string>(), companies: new Set<string>() }
      entry.itineraries.add(stop.itinerary_id)
      const companyId = companyOfItinerary.get(stop.itinerary_id)
      if (companyId) entry.companies.add(companyId)
      usage.set(stop.port_id, entry)
    }

    const result = ports.map((port) => {
      const entry = usage.get(port.id)
      const fromItineraries = new Set(entry?.companies || [])
      const flag = LEGACY_FLAGS[port.slug]
      const fromCatalog = flag
        ? companies.filter((company: any) => company.active && company[flag] === true).map((company: any) => company.id)
        : []
      const all = new Set([...Array.from(fromItineraries), ...fromCatalog])
      return {
        ...port,
        itinerary_count: entry?.itineraries.size || 0,
        company_ids: Array.from(all),
        company_ids_from_itineraries: Array.from(fromItineraries),
      }
    })
    return Response.json({ ports: result })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare i porti') }, { status: 500 })
  }
}

/** Modifica un porto: nome, paese, UN/LOCODE, alias, note, regione, statistiche e stato della superguida. */
export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const world = normalizePortWorldPatch(body)
    if ('error' in world) return Response.json({ error: world.error }, { status: 400 })
    const payload: Record<string, unknown> = { ...world.patch, updated_at: new Date().toISOString() }
    const name = body.name === undefined ? undefined : String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (name !== undefined) {
      if (!name) return Response.json({ error: 'Il nome non puo essere vuoto' }, { status: 400 })
      payload.name = name
    }
    if (body.country !== undefined) {
      const raw = String(body.country || '').trim()
      const code = raw ? countryCode(raw) : null
      if (raw && !code) return Response.json({ error: 'Paese non riconosciuto (usa il codice a due lettere, es. IT)' }, { status: 400 })
      payload.country = code
    }
    if (body.unlocode !== undefined) {
      const code = String(body.unlocode || '').replace(/\s+/g, '').toUpperCase()
      if (code && !/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)) return Response.json({ error: 'UN/LOCODE non valido (es. ITNAP)' }, { status: 400 })
      payload.unlocode = code || null
    }
    if (body.notes !== undefined) payload.notes = String(body.notes || '').trim().slice(0, 1000) || null
    if (body.aliases !== undefined) {
      let current = name
      if (current === undefined) {
        const { data } = await auth.supabase.from('shipping_ports').select('name').eq('id', id).maybeSingle()
        current = data?.name || ''
      }
      payload.aliases = cleanAliases(body.aliases, current || '')
    }

    const { data, error } = await auth.supabase
      .from('shipping_ports')
      .update(payload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select(PORT_COLUMNS)
      .maybeSingle()
    if (error) {
      if (error.code === '23514') return Response.json({ error: 'Valori non validi per il porto: un numero di passeggeri vuole il suo anno, e la priorità vale solo per una guida da fare o in lavorazione' }, { status: 400 })
      throw error
    }
    if (!data) return Response.json({ error: 'Porto non trovato' }, { status: 404 })
    return Response.json({ port: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare il porto') }, { status: 500 })
  }
}

/** Unisce un porto doppione in un altro: `{ merge_from, merge_into }`. */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const from = String(body.merge_from || '').trim()
    const into = String(body.merge_into || '').trim()
    if (!from || !into) return Response.json({ error: 'Servono i due porti da unire' }, { status: 400 })
    const { error } = await auth.supabase.rpc('merge_shipping_ports', { p_from: from, p_into: into })
    if (error) {
      const status = error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 500
      return Response.json({ error: error.message }, { status })
    }
    return Response.json({ ok: true, port_id: into })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile unire i porti') }, { status: 500 })
  }
}

/** Cancella un porto che nessun itinerario usa (il vincolo sul database lo impone comunque). */
export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })
    const { data, error } = await auth.supabase
      .from('shipping_ports')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      if (error.code === '23503') {
        return Response.json({ error: 'Il porto e usato da un itinerario: uniscilo a un altro invece di cancellarlo' }, { status: 409 })
      }
      throw error
    }
    if (!data) return Response.json({ error: 'Porto non trovato' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile eliminare il porto') }, { status: 500 })
  }
}
