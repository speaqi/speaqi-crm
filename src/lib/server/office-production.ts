import { normalizeProduction, normalizeProductionJob, normalizeProductionPlan, type ProductionAction, type ProductionJob, type ProductionOverview, type ProductionPlan } from '../office/production'
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

export type ProductionCommandResult =
  | { ok: true; plan: ProductionPlan }
  | { ok: true; job: ProductionJob }
  | { ok: false; status: number; error: string }

/**
 * Un comando della sala di controllo. `dry_run` chiede a StudioMap se parte e quanto costa;
 * senza, lo avvia — e la stessa richiesta ripetuta (stesso `request_id`) ne legge lo stato.
 * 400 di StudioMap = rifiutato prima di spendere, col motivo; ogni altro errore = esito da
 * verificare in StudioMap (Lavorazioni), mai un nuovo tentativo automatico.
 */
export async function officeProductionCommand(input: { request_id: string; slug: string; action: ProductionAction; dry_run: boolean }): Promise<ProductionCommandResult> {
  if (!process.env.OFFICE_BRIDGE_SECRET) return { ok: false, status: 503, error: 'Manca OFFICE_BRIDGE_SECRET: l’Ufficio non può comandare StudioMap.' }
  try {
    const raw = await officeStudioRequest('/api/office/production/run',
      { request_id: input.request_id, slug: input.slug, action: input.action, ...(input.dry_run ? { dry_run: true } : {}) }, 30_000)
    if (input.dry_run) {
      const plan = normalizeProductionPlan(raw, input.action)
      return plan ? { ok: true, plan } : { ok: false, status: 502, error: 'StudioMap ha risposto in una forma inattesa.' }
    }
    cache = null
    const job = normalizeProductionJob(raw)
    return job ? { ok: true, job } : { ok: false, status: 502, error: 'StudioMap ha risposto in una forma inattesa: controlla Lavorazioni prima di riprovare.' }
  } catch (error) {
    if (error instanceof OfficeStudioError && error.status === 400) {
      // «StudioMap HTTP 400 — <motivo>: esito…» → il solo motivo, scritto da StudioMap per chi legge.
      const reason = error.message.replace(/^StudioMap HTTP 400\s*—\s*/, '').replace(/: esito da verificare prima di riprovare$/, '')
      return { ok: false, status: 409, error: reason || 'StudioMap ha rifiutato il comando.' }
    }
    if (error instanceof OfficeStudioError && error.status === 404) return { ok: false, status: 503, error: 'StudioMap non ha ancora i comandi dell’Ufficio: va aggiornato.' }
    const message = error instanceof Error ? error.message : 'errore sconosciuto'
    return { ok: false, status: 502, error: input.dry_run ? `StudioMap non risponde (${message.slice(0, 160)}).`
      : `Esito incerto (${message.slice(0, 160)}): controlla Lavorazioni in StudioMap prima di riprovare.` }
  }
}
