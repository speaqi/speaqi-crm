import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { loadMapsStatus } from '@/lib/server/maps-status'
import { findMapRow, normalizeForSearch, searchPattern } from '@/lib/command-center'

/**
 * GET ?q=: "chi e' questo?" su tutto il workspace, liste separate comprese.
 * Contatti (nome, azienda, email, telefono), enti di Tourism Intelligence e
 * mappe. Il set di lavoro del browser non basta: il cliente di una fattura
 * puo' stare nella lista holding.
 */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth

  const q = request.nextUrl.searchParams.get('q') || ''
  const pattern = searchPattern(q)
  if (!pattern) return Response.json({ contacts: [], entities: [], maps: [] })

  try {
    const [contactsRes, entitiesRes, maps] = await Promise.all([
      admin
        .from('contacts')
        .select('id, name, company, email, phone, status, contact_scope, category, billing_city')
        .eq('user_id', userId)
        .or(`name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
        .order('updated_at', { ascending: false })
        .limit(12),
      admin
        .from('tourism_entities')
        .select('id, name, kind, country_code, link:tourism_crm_links(contact_id)')
        .eq('user_id', userId)
        .ilike('name', pattern)
        .in('kind', ['organization', 'place'])
        .limit(8),
      loadMapsStatus(),
    ])
    if (contactsRes.error) throw contactsRes.error

    const needle = normalizeForSearch(q)
    const mapHits = maps.rows.filter((row) => normalizeForSearch(row.name).includes(needle) || (row.speaqi_slug || '').includes(needle))
    const exact = findMapRow(maps.rows, q)
    if (exact && !mapHits.includes(exact)) mapHits.unshift(exact)

    return Response.json({
      contacts: contactsRes.data || [],
      entities: (entitiesRes.data || []).map((e: any) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        country_code: e.country_code,
        contact_id: Array.isArray(e.link) ? e.link[0]?.contact_id || null : e.link?.contact_id || null,
      })),
      maps: mapHits.slice(0, 6),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Ricerca non riuscita') }, { status: 500 })
  }
}
