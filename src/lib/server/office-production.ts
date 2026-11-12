import { normalizeProduction, type ProductionOverview } from '../office/production'
import { OfficeStudioError, officeStudioRequest } from './office-agents/maps-bridge'

const TTL_MS = 60_000
let cache: { at: number; value: ProductionOverview } | null = null
let pending: Promise<ProductionOverview> | null = null

export function officeStudioOrigin() {
  try { return new URL(process.env.OFFICE_STUDIOMAP_URL || 'https://studiomap.speaqi.com').origin } catch { return 'https://studiomap.speaqi.com' }
}

async function read(fresh: boolean): Promise<ProductionOverview> {
  if (!process.env.OFFICE_BRIDGE_SECRET) return { available: false, reason: 'Manca OFFICE_BRIDGE_SECRET: l’Ufficio non può leggere StudioMap.' }
  try {
    return normalizeProduction(await officeStudioRequest('/api/office/production/read', fresh ? { fresh: true } : {}, 25_000), officeStudioOrigin())
  } catch (error) {
    // Un StudioMap più vecchio non ha ancora la rotta: lo si dice, non è un guasto.
    if (error instanceof OfficeStudioError && error.status === 404) return { available: false, reason: 'StudioMap non ha ancora la sala di controllo: va aggiornato.' }
    if (error instanceof OfficeStudioError) return { available: false, reason: `StudioMap ha risposto ${error.status}: controlla OFFICE_BRIDGE_SECRET e OFFICE_STUDIOMAP_URL.` }
    return { available: false, reason: `StudioMap non risponde (${(error instanceof Error ? error.message : 'errore sconosciuto').slice(0, 160)}).` }
  }
}

/** Una lettura al minuto e una sola per volta; un errore non resta in memoria. Fail-soft: mai un 500 per StudioMap giù. */
export async function loadOfficeProduction(fresh = false): Promise<ProductionOverview> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value
  pending ??= read(fresh).finally(() => { pending = null })
  const value = await pending
  if (value.available) cache = { at: Date.now(), value }
  return value
}
export function forgetOfficeProduction() { cache = null }
