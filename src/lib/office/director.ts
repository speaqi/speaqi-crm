import { findMapRow as findMapStatus, normalizeForSearch, type MapStatusRow } from '../command-center'
import { salesDraftNumbersAllowed } from './sales-followup'

export type DirectorDestination = { id: string; name: string; aliases?: string[]; guide_status: string; guide_priority: number | null;
  volume: number | null; year: number | null; source: string | null; estimated?: boolean; table: 'tourism_destinations' | 'tourism_hubs' }
export type DirectorCoverage = { map_id: string; done: number; total: number; source: string }
export type DirectorAction = 'build_map' | 'publication_review' | 'complete_languages'
export type DirectorPriority = { key: string; action: DirectorAction; recipient: 'mymaps_builder' | 'maps_quality' | 'languages_voice'; city: string;
  title: string; target_table: string; target_id: string; map_slug: string | null; rank: number; volume: number;
  facts: Record<string, unknown> }

/** Copre anche lo slug storico napolimap e il nome inglese del catalogo. */
export function officeIsNaples(...values: Array<string | null | undefined>) {
  return values.some((value) => {
    let decoded = value || ''
    try { decoded = decodeURIComponent(decoded) } catch { /* Un identificatore malformato non viene decodificato. */ }
    return normalizeForSearch(decoded).split(' ').some((part) => part.startsWith('napoli') || part.startsWith('naples'))
  })
}

export function directorPriorities(input: { destinations: DirectorDestination[]; maps: MapStatusRow[]; coverage: DirectorCoverage[];
  catalogKnown: boolean; speaqiKnown: boolean; suppressed?: string[] }): DirectorPriority[] {
  const candidates: DirectorPriority[] = []
  const suppressed = new Set(input.suppressed || [])
  if (input.catalogKnown && input.speaqiKnown) {
    for (const destination of input.destinations) {
      if (officeIsNaples(destination.name, ...(destination.aliases || [])) || destination.guide_status !== 'planned' || destination.guide_priority !== 1
        || !Number.isFinite(destination.volume) || (destination.volume || 0) <= 0 || !destination.year || !destination.source?.trim() || destination.estimated) continue
      if ([destination.name, ...(destination.aliases || [])].some((name) => findMapStatus(input.maps, name))) continue
      candidates.push({ key: `build_map:${normalizeForSearch(destination.name)}`, action: 'build_map', recipient: 'mymaps_builder',
        city: destination.name, title: `Costruire ${destination.name} da My Maps`, target_table: destination.table, target_id: destination.id,
        map_slug: null, rank: 0, volume: destination.volume!, facts: { volume: destination.volume, year: destination.year, source: destination.source,
          guide_status: destination.guide_status, guide_priority: destination.guide_priority, source_table: destination.table, source_id: destination.id } })
    }
    for (const map of input.maps) {
      if (officeIsNaples(map.name, map.studiomap_slug, map.speaqi_slug)) continue
      if (map.stage === 'pronta' && map.studiomap_slug && !map.speaqi_slug) candidates.push({ key: `publication_review:${map.studiomap_slug}`,
        action: 'publication_review', recipient: 'maps_quality', city: map.name, title: `Pubblicare ${map.name}`, target_table: 'studiomap_maps',
        target_id: map.studiomap_slug, map_slug: map.studiomap_slug, rank: 1, volume: 0,
        facts: { places: map.places, ready_places: map.ready_places, stage: map.stage, source: 'loadMapsStatus',
          nota: 'Il clic accoda la verifica alla Qualità; la pubblicazione resta manuale.' } })
    }
  }
  if (input.speaqiKnown) for (const map of input.maps) {
    if (map.stage !== 'online' || officeIsNaples(map.name, map.studiomap_slug, map.speaqi_slug)) continue
    const coverage = input.coverage.find((row) => row.map_id === map.key)
    if (!coverage || !Number.isFinite(coverage.done) || !Number.isFinite(coverage.total) || coverage.total <= 0 || coverage.done < 0
      || coverage.done > coverage.total || coverage.done / coverage.total >= .9) continue
    candidates.push({ key: `complete_languages:${map.key}`, action: 'complete_languages', recipient: 'languages_voice', city: map.name,
      title: `Completare le lingue di ${map.name}`, target_table: 'speaqi_maps', target_id: map.key, map_slug: map.studiomap_slug || map.speaqi_slug,
      rank: 2, volume: 0, facts: { ...coverage, percent: Math.round(1000 * coverage.done / coverage.total) / 10 } })
  }
  const seen = new Set<string>()
  return candidates.sort((a,b) => a.rank-b.rank || b.volume-a.volume || a.key.localeCompare(b.key)).filter((candidate) => {
    if (suppressed.has(candidate.key) || seen.has(candidate.key)) return false
    seen.add(candidate.key); return true
  })
}

/** Il modello scrive solo righe descrittive; chiavi, ordine e dati restano del codice. */
export function directorReportLines(priority: DirectorPriority, modelLines: unknown): string[] {
  const lines = Array.isArray(modelLines) && modelLines.length >= 3 && modelLines.length <= 5
    && modelLines.every((line) => typeof line === 'string' && line.trim().length > 0 && line.length <= 500) ? modelLines as string[] : null
  if (lines && lines.every((line) => salesDraftNumbersAllowed(line, JSON.stringify(priority)) && !/https?:\/\//i.test(line))) return lines
  const reason = priority.action === 'build_map' ? 'Destinazione prioritaria senza una mappa nel catalogo verificato.'
    : priority.action === 'publication_review' ? 'Mappa pronta in StudioMap e assente dalle guide Speaqi verificate.' : 'Le traduzioni risultano incomplete nella lettura di Speaqi.'
  return [reason, 'Le fonti e i dati usati sono allegati alla proposta.', 'La decisione resta al titolare; nessuna pubblicazione viene eseguita.']
}

export function directorSuppressed(outputs: Array<{ body: Record<string, unknown>; decided_at: string | null }>, now: Date) {
  return outputs.filter((o) => o.decided_at && Date.parse(o.decided_at) > now.getTime() - 28 * 86400_000)
    .map((o) => o.body.action_key).filter((key): key is string => typeof key === 'string')
}
