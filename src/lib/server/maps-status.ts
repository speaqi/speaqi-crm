import { mergeMapStatus, type MapStatusRow, type SpeaqiGuideMap, type StudioCatalogEntry } from '@/lib/command-center'

/**
 * Stato delle mappe, letto da fuori: il catalogo di StudioMap (dove le mappe
 * si costruiscono) e le guide pubbliche di Speaqi (dove si vendono).
 *
 * Fail-soft: una fonte che non risponde lascia l'altra, e la pagina dice
 * quale manca invece di rompersi. In memoria per un minuto, cosi' la prima
 * pagina e cento schede aperte non diventano cento chiamate.
 */

const STUDIOMAP_URL = () => process.env.STUDIOMAP_CATALOG_URL || 'https://studiomap.speaqi.com/api/catalog'
const SPEAQI_API = () => (process.env.SPEAQI_PUBLIC_API_URL || 'https://api.speaqi.com/api/v1').replace(/\/$/, '')
const TTL_MS = 60_000
const TIMEOUT_MS = 6_000

export type MapsStatus = {
  rows: MapStatusRow[]
  sources: { studiomap: 'ok' | 'not_configured' | 'error'; speaqi: 'ok' | 'error' }
  fetched_at: string
}

let cache: { at: number; value: MapsStatus } | null = null
let inFlight: Promise<MapsStatus> | null = null

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

async function loadStudioCatalog(): Promise<{ entries: StudioCatalogEntry[] | null; state: MapsStatus['sources']['studiomap'] }> {
  const token = process.env.STUDIOMAP_CATALOG_TOKEN
  if (!token) return { entries: null, state: 'not_configured' }
  try {
    const body = await getJson(STUDIOMAP_URL(), { Authorization: `Bearer ${token}` })
    const list = Array.isArray(body) ? body : Array.isArray(body?.maps) ? body.maps : Array.isArray(body?.cities) ? body.cities : []
    const entries: StudioCatalogEntry[] = list
      .filter((m: any) => m && typeof m.slug === 'string')
      .map((m: any) => ({
        slug: m.slug,
        name: String(m.name || m.slug),
        status: m.status === 'su_speaqi' || m.status === 'pronta' ? m.status : 'in_lavorazione',
        places: Number(m.places) || 0,
        ready_places: Number(m.ready_places) || 0,
        routes: Number(m.routes) || 0,
        speaqi_map_id: typeof m.speaqi_map_id === 'string' ? m.speaqi_map_id : null,
        updated_at: m.updated_at,
      }))
    return { entries, state: 'ok' }
  } catch (error) {
    console.warn('[maps-status] StudioMap non risponde', error instanceof Error ? error.message : error)
    return { entries: null, state: 'error' }
  }
}

async function loadSpeaqiGuides(): Promise<{ maps: SpeaqiGuideMap[] | null; state: MapsStatus['sources']['speaqi'] }> {
  try {
    const body = await getJson(`${SPEAQI_API()}/public/guides/maps`)
    const list = Array.isArray(body?.maps) ? body.maps : []
    const maps: SpeaqiGuideMap[] = list
      .filter((m: any) => m && typeof m.id === 'string')
      .map((m: any) => ({
        id: m.id,
        slug: String(m.slug || ''),
        name: String(m.name || m.slug || ''),
        is_paid: Boolean(m.is_paid),
        price_cents: m.price_cents == null ? null : Number(m.price_cents),
        points: m.points == null ? null : Number(m.points),
      }))
    return { maps, state: 'ok' }
  } catch (error) {
    console.warn('[maps-status] Speaqi non risponde', error instanceof Error ? error.message : error)
    return { maps: null, state: 'error' }
  }
}

export async function loadMapsStatus(): Promise<MapsStatus> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const [studio, speaqi] = await Promise.all([loadStudioCatalog(), loadSpeaqiGuides()])
      const value: MapsStatus = {
        rows: mergeMapStatus(studio.entries, speaqi.maps),
        sources: { studiomap: studio.state, speaqi: speaqi.state },
        fetched_at: new Date().toISOString(),
      }
      // Una lettura con entrambe le fonti giu' non resta in cache: al prossimo giro si riprova.
      if (studio.state !== 'error' || speaqi.state !== 'error') cache = { at: Date.now(), value }
      return value
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export function speaqiMapUrl(slug: string | null): string | null {
  return slug ? `https://guides.speaqi.com/maps/${slug}` : null
}
