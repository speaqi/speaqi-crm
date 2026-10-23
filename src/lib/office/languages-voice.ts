/**
 * Agente 03 — Lingue e voce. Logica pura: quali mappe lavorare, cosa lanciare col
 * budget che resta, come raccontarlo. La pipeline delle traduzioni sta su Speaqi
 * (`/maps/:id/studiomap/translations/fill`): qui si decide solo se e cosa chiamare.
 */
import { officeIsNaples } from './director'

export type LanguagesQueueEntry = { key: string; map_id: string; city: string | null; map_slug: string | null; source_output_id: string | null }

export type CoverageCounts = { missing: number; failed: number; outdated: number; stuck: number; processing: number; done: number }
export type TranslationsSummary = { languages: string[]; points: number; text: CoverageCounts; audio: CoverageCounts }
export type FillEstimate = { text_usd: number; audio_usd: number; total_usd: number; tts_minutes?: number; deferred?: boolean }
export type FillDryRun = { text: number; audio: number; estimate?: FillEstimate | null }

/** Quello che si cerca di prenotare, in ordine: tutto, poi solo i testi. */
export type LaunchOption = { mode: 'all' | 'text'; audio: boolean; cents: number; pairs: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const LANGUAGES_INCLUDE = ['missing', 'failed', 'stuck'] as const
export const MAX_MAPS_PER_NIGHT = 6

/** La coda la scrive il Direttore (proposte approvate) o il titolare a mano: si accettano entrambe le forme. */
export function languagesQueue(raw: unknown): { entries: LanguagesQueueEntry[]; rejected: Array<{ entry: unknown; reason: string }> } {
  const entries: LanguagesQueueEntry[] = []; const rejected: Array<{ entry: unknown; reason: string }> = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const mapId = String(row.map_id || row.target_id || '').trim()
    const city = typeof row.city === 'string' ? row.city.trim() || null : null
    const slug = typeof row.map_slug === 'string' ? row.map_slug.trim() || null : null
    if (row.status && !['pending', 'queued'].includes(String(row.status))) continue
    if (row.action && row.action !== 'complete_languages') { rejected.push({ entry: item, reason: 'Azione diversa da «completare le lingue».' }); continue }
    if (officeIsNaples(city, slug, mapId)) { rejected.push({ entry: item, reason: 'Napoli è esclusa: non si traduce e non si genera voce.' }); continue }
    if (!UUID.test(mapId)) { rejected.push({ entry: item, reason: 'Manca l’id Speaqi della mappa.' }); continue }
    if (seen.has(mapId.toLowerCase())) continue
    seen.add(mapId.toLowerCase())
    entries.push({ key: String(row.key || `complete_languages:${mapId}`), map_id: mapId, city, map_slug: slug,
      source_output_id: typeof row.source_output_id === 'string' ? row.source_output_id : null })
  }
  return { entries, rejected }
}

export function usdToCents(usd: number, usdToEur: number) {
  if (!Number.isFinite(usd) || usd <= 0) return 0
  // Arrotonda prima il rumore della virgola mobile (0,11 × 10 = 1,1000000000000001).
  return Math.ceil(Math.round(usd * usdToEur * 100 * 1e6) / 1e6)
}

/**
 * Le opzioni da provare a prenotare. La voce è la parte cara (circa l'80%): se non ci
 * sta tutto, si lanciano i testi, che costano poco, e l'audio aspetta la notte dopo.
 * Senza stima non si lancia niente: non si spende alla cieca.
 */
export function launchOptions(dry: FillDryRun, usdToEur: number): LaunchOption[] {
  const estimate = dry.estimate
  if (!estimate || ![estimate.text_usd, estimate.audio_usd, estimate.total_usd].every((n) => Number.isFinite(n) && n >= 0)) return []
  const options: LaunchOption[] = []
  if (dry.text + dry.audio > 0) options.push({ mode: 'all', audio: true, cents: usdToCents(estimate.total_usd, usdToEur), pairs: dry.text + dry.audio })
  if (dry.text > 0 && dry.audio > 0) options.push({ mode: 'text', audio: false, cents: usdToCents(estimate.text_usd, usdToEur), pairs: dry.text })
  return options
}

export function coverageTotal(c: CoverageCounts) {
  return c.missing + c.failed + c.outdated + c.stuck + c.processing + c.done
}

export function percentDone(c: CoverageCounts) {
  const total = coverageTotal(c)
  return total ? Math.round(1000 * c.done / total) / 10 : 0
}

/** Separatore delle migliaia scritto a mano: Node non raggruppa 1240 in it-IT. */
const number = (n: number) => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
export const euro = (cents: number) => `${number(Math.floor(cents / 100))},${String(Math.abs(cents) % 100).padStart(2, '0')} €`

/** «Capri: 11 lingue, testi 1.240/1.260, audio 980/1.260, speso 9,40 € (stima)». */
export function summaryLine(name: string, summary: TranslationsSummary, spentCents: number, launched: string) {
  return `${name}: ${summary.languages.length} lingue, testi ${number(summary.text.done)}/${number(coverageTotal(summary.text))}, `
    + `audio ${number(summary.audio.done)}/${number(coverageTotal(summary.audio))}, speso ${euro(spentCents)} (stima)${launched ? ` — ${launched}` : ''}`
}

/**
 * Il controllo della notte dopo: se l'ultimo lancio non ha fatto salire la quota
 * tradotta, qualcosa si è fermato e va guardato a mano invece di rilanciare.
 */
export function progressCheck(previous: { text: number; audio: number } | null, current: TranslationsSummary) {
  if (!previous) return null
  const text = percentDone(current.text); const audio = percentDone(current.audio)
  if (text > previous.text || audio > previous.audio) return { rose: true, text, audio, note: `Salita da testi ${previous.text}% / audio ${previous.audio}% a ${text}% / ${audio}%.` }
  if (current.text.processing + current.audio.processing > 0) return { rose: false, text, audio, note: 'Ancora in lavorazione su Speaqi (testi in differita): si ricontrolla la notte dopo.' }
  return { rose: false, text, audio, note: `Nessun progresso dall’ultimo lancio (testi ${text}%, audio ${audio}%): controllare su Speaqi prima di spendere ancora.` }
}
