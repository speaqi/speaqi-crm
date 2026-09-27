import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildPortIndex,
  CORE_PORTS,
  newPortFromStop,
  ParsedStop,
  resolvePort,
  ShippingPort,
} from '@/lib/shipping-itineraries'

const PORT_COLUMNS = 'id, slug, name, country, unlocode, aliases, latitude, longitude, notes'

// I porti di base si scrivono una volta per workspace: dopo la prima riuscita
// non serve rifare il controllo a ogni richiesta.
const seededWorkspaces = new Set<string>()

/** Crea i porti di base che mancano. Non tocca quelli gia' presenti, anche se modificati. */
export async function ensureCorePorts(supabase: SupabaseClient, userId: string) {
  if (seededWorkspaces.has(userId)) return
  const { data, error } = await supabase.from('shipping_ports').select(PORT_COLUMNS).eq('user_id', userId)
  if (error) throw error
  const existing = (data || []) as ShippingPort[]
  const slugs = new Set(existing.map((row) => row.slug))
  // Un porto di base unito a un altro vive come alias di quello: non va ricreato.
  const index = buildPortIndex(existing.map((row) => ({ ...row, aliases: row.aliases || [] })))
  const missing = CORE_PORTS
    .filter((port) => !slugs.has(port.slug) && !resolvePort(index, { name: port.name, alt: null }))
    .map((port) => ({ ...port, user_id: userId }))
  if (missing.length) {
    const inserted = await supabase
      .from('shipping_ports')
      .upsert(missing, { onConflict: 'user_id,slug', ignoreDuplicates: true })
    if (inserted.error) throw inserted.error
  }
  seededWorkspaces.add(userId)
}

export async function loadShippingPorts(supabase: SupabaseClient, userId: string): Promise<ShippingPort[]> {
  await ensureCorePorts(supabase, userId)
  const { data, error } = await supabase
    .from('shipping_ports')
    .select(PORT_COLUMNS)
    .eq('user_id', userId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []).map((row: any) => ({
    ...row,
    aliases: row.aliases || [],
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  }))
}

/**
 * Lega ogni tappa letta dal testo a un porto, creando quelli che non esistono.
 * Restituisce anche i porti nuovi, per dirlo a chi ha incollato l'itinerario:
 * un nome scritto male diventa un porto nuovo, e va visto subito.
 */
export async function resolveStopPorts(supabase: SupabaseClient, userId: string, stops: ParsedStop[]) {
  const ports = await loadShippingPorts(supabase, userId)
  const index = buildPortIndex(ports)
  const created: ShippingPort[] = []
  const portIds: string[] = []

  for (const stop of stops) {
    let port = resolvePort(index, stop)
    if (!port) {
      const draft = newPortFromStop(stop)
      let slug = draft.slug
      for (let attempt = 2; ports.some((existing) => existing.slug === slug); attempt += 1) slug = `${draft.slug}-${attempt}`
      const { data, error } = await supabase
        .from('shipping_ports')
        .insert({ ...draft, slug, user_id: userId })
        .select(PORT_COLUMNS)
        .single()
      if (error) throw error
      port = { ...(data as ShippingPort), aliases: (data as ShippingPort).aliases || [] }
      ports.push(port)
      created.push(port)
      // Il porto appena creato deve servire anche alle righe successive dello stesso testo.
      Object.assign(index, buildPortIndex(ports))
    }
    portIds.push(port.id)
  }

  return { portIds, created }
}
