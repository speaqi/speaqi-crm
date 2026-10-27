import type { SupabaseClient } from '@supabase/supabase-js'
import { MAP_STAGE_LABEL, findMapRow, normalizeForSearch, searchPattern } from '@/lib/command-center'
import { loadMapsStatus, speaqiMapUrl } from '@/lib/server/maps-status'
import { formatSchedaReply } from '@/lib/office/telegram-commands'

/**
 * /scheda su Telegram: la stessa ricerca della prima pagina (contatti di ogni lista, enti di
 * Tourism Intelligence, mappe), senza modello e senza spesa. Le mappe sono facoltative:
 * se StudioMap o Speaqi non rispondono si risponde con il resto.
 */
export async function telegramSchedaReply(supabase: SupabaseClient, userId: string, query: string, baseUrl: string) {
  const pattern = searchPattern(query)
  if (!pattern) return 'Scrivi almeno due lettere: /scheda SNAV'
  const [contactsRes, entitiesRes, maps] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, company, status')
      .eq('user_id', userId)
      .or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .order('updated_at', { ascending: false })
      .limit(6),
    supabase
      .from('tourism_entities')
      .select('id, name, kind, country_code, link:tourism_crm_links(contact_id)')
      .eq('user_id', userId)
      .ilike('name', pattern)
      .in('kind', ['organization', 'place'])
      .limit(5),
    loadMapsStatus().catch(() => null),
  ])
  if (contactsRes.error) throw contactsRes.error

  const needle = normalizeForSearch(query)
  const rows = maps?.rows || []
  const mapHits = rows.filter((row) => normalizeForSearch(row.name).includes(needle) || (row.speaqi_slug || '').includes(needle))
  const exact = findMapRow(rows, query)
  if (exact && !mapHits.includes(exact)) mapHits.unshift(exact)

  return formatSchedaReply(query, {
    contacts: (contactsRes.data || []) as any[],
    entities: ((entitiesRes.data || []) as any[]).map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      country_code: e.country_code,
      contact_id: Array.isArray(e.link) ? e.link[0]?.contact_id || null : e.link?.contact_id || null,
    })),
    maps: mapHits.slice(0, 5).map((row) => ({
      name: row.name,
      stage_label: MAP_STAGE_LABEL[row.stage],
      url: row.stage === 'online' ? speaqiMapUrl(row.speaqi_slug) : null,
    })),
  }, baseUrl)
}
