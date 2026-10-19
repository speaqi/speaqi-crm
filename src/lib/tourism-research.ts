/** Catalog discovery is separate from verified identity and permission to reuse content. */
export const DESTINATION_TYPES = [
  'nto',
  'rto',
  'dmo',
  'local_office',
  'cvb',
  'consortium',
  'park',
  'association',
  'foundation',
  'development_authority',
  'network',
  'chamber'
] as const
export type PoiCandidate = {
  source_url: string
  name: string
  category: string
  latitude: number | null
  longitude: number | null
  address: string | null
  evidence_kind: 'jsonld' | 'html' | 'link'
}
export type SiteReport = {
  sitemap?: {
    status: 'found' | 'not_found' | 'unavailable'
    documents: { url: string; kind: 'index' | 'urlset'; urls: number }[]
    enumeration_complete: boolean
    all_site_pages_confirmed: false
    pending_documents: number
    sampled_catalogue_links_missing: number | null
  }
  target_check?: import('./tourism-site-qualification').TargetCheck
  schema_version: 1
  site_url: string
  fetched_at: string
  state: 'completed' | 'partial' | 'blocked' | 'failed'
  title: string
  destination_signals: string[]
  languages: string[]
  map_detected: boolean
  catalogue_pages: { url: string; label: string; category: string }[]
  sitemap_urls_seen: number
  place_url_candidates: number
  restaurant_url_candidates: number
  declared_lists: { url: string; count: number; label: string }[]
  candidates: PoiCandidate[]
  geocoded_candidates: number
  requests: number
  bytes: number
  duration_ms: number
  sample_limited: boolean
  count_note: string
  errors: { url: string; message: string }[]
  receipts: { url: string; status: number; bytes: number; hash: string }[]
}
export type SiteSource = {
  excluded?: boolean
  qualification_pending?: boolean
  id: string
  entity_id: string | null
  url: string
  label: string
  country_code: string
  official_status: 'candidate' | 'confirmed' | 'rejected'
  destination_status: 'candidate' | 'confirmed' | 'rejected'
  review_url: string | null
  review_note: string
  enabled: boolean
  interval_days: number
  max_requests: number
  next_run_at: string
  last_scanned_at: string | null
  last_state: string | null
  version: number
  latest_report: SiteReport | null
}
export const COST_ASSUMPTIONS = {
  currency: 'EUR',
  kind: 'planning_assumptions_not_supplier_quotes',
  http_per_1000: [0.5, 3] as const,
  browser_per_1000: [5, 15] as const,
  optional_ai_per_1000: [1, 5] as const,
  note: 'Ipotesi di budget modificabili, non tariffe verificate né costi già sostenuti. Esclusi sviluppo, manutenzione, revisione umana, licenze, IVA e storage a lungo termine.'
}
export function estimateCrawlCost(
  sites: number,
  pagesPerSite: number,
  browserShare = 0,
  aiShare = 0,
  changedShare = 1
) {
  for (const n of [sites, pagesPerSite])
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000)
      throw new Error('Volume non valido')
  for (const n of [browserShare, aiShare, changedShare])
    if (!Number.isFinite(n) || n < 0 || n > 1)
      throw new Error('Quota non valida')
  const requests = Math.ceil(sites * pagesPerSite * changedShare)
  const unit = (index: 0 | 1) =>
    ((1 - browserShare) * COST_ASSUMPTIONS.http_per_1000[index] +
      browserShare * COST_ASSUMPTIONS.browser_per_1000[index] +
      aiShare * COST_ASSUMPTIONS.optional_ai_per_1000[index]) /
    1000
  return {
    sites,
    pages_per_site: pagesPerSite,
    requests,
    browser_share: browserShare,
    ai_share: aiShare,
    changed_share: changedShare,
    low_eur: Math.round(requests * unit(0) * 100) / 100,
    high_eur: Math.round(requests * unit(1) * 100) / 100,
    assumptions: COST_ASSUMPTIONS
  }
}
export function inventoryChanges(
  previous: SiteReport | null,
  next: SiteReport
) {
  if (!previous)
    return {
      baseline: true,
      added: next.candidates.length,
      removed: null,
      comparable: false
    }
  const key = (p: PoiCandidate) => `${p.source_url}|${p.name.toLowerCase()}`
  const before = new Set(previous.candidates.map(key)),
    after = new Set(next.candidates.map(key))
  // A bounded sample cannot prove that an item disappeared from the actual website.
  return {
    baseline: false,
    added: [...after].filter((k) => !before.has(k)).length,
    not_observed_again: [...before].filter((k) => !after.has(k)).length,
    removed: null,
    comparable: !previous.sample_limited && !next.sample_limited
  }
}
