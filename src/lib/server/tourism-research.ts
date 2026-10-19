import type { SupabaseClient } from '@supabase/supabase-js'
import { crawlTourismSite } from './tourism-site-crawler'
import {
  inventoryChanges,
  type SiteReport,
  type SiteSource
} from '../tourism-research'

export async function runSiteResearch(
  supabase: SupabaseClient,
  owner: string,
  sourceId: string | null = null
) {
  const { data, error } = await supabase.rpc('tourism_claim_site', {
    p_source_id: sourceId,
    p_owner: owner
  })
  if (error) throw error
  if (!data)
    return {
      skipped: true,
      reason:
        'Nessun sito disponibile: non dovuto, già in corso o limite giornaliero raggiunto.'
    }
  const source = data as SiteSource & { lease_token: string }
  const report = await crawlTourismSite(source.url, {
    maxRequests: source.qualification_pending
      ? Math.min(10, source.max_requests)
      : source.max_requests
  })
  const changes = inventoryChanges(source.latest_report, report)
  const { data: scanId, error: finishError } = await supabase.rpc(
    'tourism_finish_site',
    {
      p_source_id: source.id,
      p_token: source.lease_token,
      p_report: report,
      p_changes: changes
    }
  )
  if (finishError) throw finishError
  return { source_id: source.id, scan_id: scanId, report, changes }
}

export function poiGeoJson(
  rows: {
    name: string
    latitude: number | null
    longitude: number | null
    source_url: string
    category: string
    reuse_status: string
    reuse_url: string | null
    state: string
  }[]
) {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter(
        (p) =>
          p.state === 'approved' &&
          p.reuse_status !== 'unknown' &&
          p.latitude !== null &&
          p.longitude !== null
      )
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
        properties: {
          name: p.name,
          category: p.category,
          source_url: p.source_url,
          reuse_status: p.reuse_status,
          reuse_url: p.reuse_url
        }
      }))
  }
}
