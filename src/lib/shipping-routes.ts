// Mappa delle rotte (/navigazione → Mappa rotte): da un itinerario salvato alle
// frecce sulla mappa del mondo. Modulo puro — nessun Leaflet qui dentro — cosi'
// la geometria si prova senza browser e la pagina resta un disegnatore.
//
// Le linee sono INDICATIVE: collegano i porti nell'ordine dell'itinerario con un
// arco, non seguono la rotta reale della nave (che gira attorno alle coste). Per
// dire "chi va dove, in che ordine" basta; per misurare miglia no.

import type { ItineraryStopRole, ShippingItinerary } from './shipping-itineraries'

export interface LatLng {
  lat: number
  lng: number
}

export interface RoutePoint extends LatLng {
  port_id: string
  name: string
  country: string | null
  position: number
  day: number | null
  role: ItineraryStopRole
  arrival: string | null
  departure: string | null
  overnight: boolean
}

export interface RouteLeg {
  from: RoutePoint
  to: RoutePoint
  /** Lato dell'arco: due tratte uguali di itinerari diversi si aprono a ventaglio invece di sovrapporsi. */
  bend: number
}

/**
 * Colori per itinerario o per compagnia: abbastanza distanti fra loro da
 * distinguersi sulla mappa chiara, e nessuno troppo pallido sul mare.
 */
export const ROUTE_COLORS = [
  '#4f6ef7', '#e8590c', '#0ca678', '#d6336c', '#7048e8',
  '#1098ad', '#f59f00', '#5c940d', '#c2255c', '#364fc7',
  '#e03131', '#2b8a3e', '#ae3ec9', '#087f5b', '#a61e4d',
]

export function routeColor(index: number) {
  return ROUTE_COLORS[((index % ROUTE_COLORS.length) + ROUTE_COLORS.length) % ROUTE_COLORS.length]
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/** Una coordinata valida o null: PostgREST puo' restituire i `numeric` come stringhe. */
export function validLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = toNumber(lat)
  const b = toNumber(lng)
  if (a === null || b === null) return null
  if (a < -90 || a > 90 || b < -180 || b > 180) return null
  return { lat: a, lng: b }
}

/**
 * Le tappe di un itinerario con la loro posizione, in ordine. Le tappe il cui
 * porto non ha coordinate restano fuori dal disegno ma vengono restituite a
 * parte: la pagina deve dire che mancano, non far finta che la rotta sia quella.
 */
export function itineraryPoints(itinerary: Pick<ShippingItinerary, 'stops'>) {
  const points: RoutePoint[] = []
  const missing: Array<{ port_id: string; name: string }> = []
  const stops = [...(itinerary.stops || [])].sort((a, b) => a.position - b.position)
  for (const stop of stops) {
    const port = stop.port as (ShippingItinerary['stops'][number]['port'] & { latitude?: unknown; longitude?: unknown }) | null | undefined
    const coords = port ? validLatLng(port.latitude, port.longitude) : null
    if (!coords) {
      if (!missing.some((row) => row.port_id === stop.port_id)) missing.push({ port_id: stop.port_id, name: port?.name || '?' })
      continue
    }
    points.push({
      ...coords,
      port_id: stop.port_id,
      name: port?.name || '?',
      country: port?.country || null,
      position: stop.position,
      day: stop.day,
      role: stop.role,
      arrival: stop.arrival,
      departure: stop.departure,
      overnight: stop.overnight,
    })
  }
  return { points, missing }
}

/**
 * Le tratte fra tappe consecutive. Due tappe di fila nello stesso porto
 * (Dubai → Dubai, un pernottamento spezzato in due righe) sono una sosta, non
 * una tratta: una freccia da un punto a se' stesso non si disegna.
 */
export function routeLegs(points: RoutePoint[], bend = 1): RouteLeg[] {
  const legs: RouteLeg[] = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (from.port_id === to.port_id) continue
    if (from.lat === to.lat && from.lng === to.lng) continue
    legs.push({ from, to, bend })
  }
  return legs
}

/**
 * La longitudine di `lng` portata a meno di 180° da `reference`. Da Honolulu a
 * Tokyo la strada corta passa per l'antimeridiano: senza questo passaggio la
 * linea attraverserebbe tutto il mondo nell'altro verso.
 */
export function unwrapLng(reference: number, lng: number) {
  let value = lng
  while (value - reference > 180) value -= 360
  while (value - reference < -180) value += 360
  return value
}

/** Latitudine → y di Mercatore (in gradi), la proiezione delle mappe a tasselli. */
export function mercatorY(lat: number) {
  const clamped = Math.max(-85, Math.min(85, lat))
  const rad = (clamped * Math.PI) / 180
  return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180) / Math.PI
}

function fromMercatorY(y: number) {
  return (Math.atan(Math.sinh((y * Math.PI) / 180)) * 180) / Math.PI
}

/**
 * L'arco di una tratta, come elenco di punti da disegnare. E' una curva di
 * Bezier quadratica calcolata sul piano di Mercatore (cosi' a schermo e' un
 * arco pulito a qualunque zoom), con il punto di controllo spostato a sinistra
 * del verso di marcia: andata e ritorno fra gli stessi due porti finiscono su
 * due archi distinti invece che sulla stessa riga.
 */
export function legArc(from: LatLng, to: LatLng, bend = 1, segments = 24): LatLng[] {
  const x0 = from.lng
  const x1 = unwrapLng(from.lng, to.lng)
  const y0 = mercatorY(from.lat)
  const y1 = mercatorY(to.lat)
  const dx = x1 - x0
  const dy = y1 - y0
  const length = Math.hypot(dx, dy)
  if (!length) return [from, to]
  // Normale sinistra (-dy, dx); la curvatura cresce con la tratta ma resta contenuta.
  const offset = 0.16 * bend
  const cx = (x0 + x1) / 2 - dy * offset
  const cy = (y0 + y1) / 2 + dx * offset
  const points: LatLng[] = []
  for (let step = 0; step <= segments; step += 1) {
    const t = step / segments
    const u = 1 - t
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1
    points.push({ lat: fromMercatorY(y), lng: x })
  }
  return points
}

/**
 * Dove mettere la freccia di una tratta e verso dove puntarla. L'angolo e' in
 * gradi a schermo (0 = verso destra, positivo in senso orario, come un
 * `rotate()` CSS). Mercatore conserva gli angoli, quindi vale a ogni zoom.
 */
export function legArrow(arc: LatLng[], at = 0.55): { point: LatLng; angle: number } {
  if (arc.length < 2) return { point: arc[0], angle: 0 }
  const index = Math.min(arc.length - 2, Math.max(0, Math.round(at * (arc.length - 1))))
  const a = arc[index]
  const b = arc[index + 1]
  const dx = b.lng - a.lng
  const dy = mercatorY(b.lat) - mercatorY(a.lat)
  // Lo schermo ha la y verso il basso: una nave che sale verso nord punta a -90°.
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  return { point: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, angle }
}

/** "MSC World Europa", "msc world europa ", "MSC  World-Europa" → la stessa nave. */
export function shipKey(ship: string | null | undefined) {
  return String(ship || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface ShipSummary {
  key: string
  name: string
  company_id: string
  company_name: string
  itinerary_ids: string[]
}

/**
 * Le navi che compaiono negli itinerari, una riga per nave e compagnia, con i
 * suoi itinerari. Due compagnie non condividono una nave nel nostro modello:
 * la chiave include la compagnia, cosi' un nome ripetuto non le fonde.
 */
export function shipsOf(itineraries: Array<Pick<ShippingItinerary, 'id' | 'ship' | 'company_id' | 'company'>>): ShipSummary[] {
  const map = new Map<string, ShipSummary>()
  for (const itinerary of itineraries) {
    const key = shipKey(itinerary.ship)
    if (!key) continue
    const id = `${itinerary.company_id}:${key}`
    const entry = map.get(id) || {
      key: id,
      name: String(itinerary.ship).replace(/\s+/g, ' ').trim(),
      company_id: itinerary.company_id,
      company_name: itinerary.company?.name || '',
      itinerary_ids: [],
    }
    entry.itinerary_ids.push(itinerary.id)
    map.set(id, entry)
  }
  return Array.from(map.values()).sort(
    (a, b) => a.company_name.localeCompare(b.company_name, 'it') || a.name.localeCompare(b.name, 'it')
  )
}

/**
 * Coordinate scritte come capita: "40.8359, 14.2488", "40,8359 14,2488" o un
 * link di Google Maps (".../@40.8359,14.2488,15z"). Prima latitudine, poi
 * longitudine, come le mostra Google Maps quando si tiene premuto un punto.
 */
export function parseCoordinates(text: string): LatLng | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const at = raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) return validLatLng(at[1], at[2])
  // Con la virgola decimale all'italiana i due numeri si separano con spazio o punto e virgola.
  const italian = raw.match(/^(-?\d+,\d+)\s*[;\s]\s*(-?\d+,\d+)$/)
  if (italian) return validLatLng(italian[1].replace(',', '.'), italian[2].replace(',', '.'))
  const plain = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (plain) return validLatLng(plain[1], plain[2])
  return null
}
