import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

/**
 * Chi è "in focus" per Oggi: contatti legati a un ente di Tourism Intelligence,
 * a una mappa, o con un'opportunità aperta fuori dalle vendite generiche
 * (tourism, distribuzione, agency). Ogni fonte che non si legge (tabella non
 * ancora migrata) viene saltata: l'elenco è un aiuto, non un permesso.
 */
const PAGE = 1000

async function collect(
  run: (from: number, to: number) => PromiseLike<{ data: Array<{ contact_id: string | null }> | null; error: unknown }>
): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) return ids
    for (const row of data || []) if (row.contact_id) ids.push(row.contact_id)
    if (!data || data.length < PAGE) break
  }
  return ids
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const uid = auth.workspaceUserId
    const [tourism, maps, deals] = await Promise.all([
      collect((a, b) => auth.supabase.from('tourism_crm_links').select('contact_id').eq('user_id', uid).range(a, b)),
      collect((a, b) => auth.supabase.from('contact_map_links').select('contact_id').eq('user_id', uid).range(a, b)),
      collect((a, b) =>
        auth.supabase
          .from('deals')
          .select('contact_id')
          .eq('user_id', uid)
          .in('pipeline', ['tourism', 'distribuzione', 'agency'])
          .is('closed_at', null)
          .range(a, b)
      ),
    ])
    const ids = Array.from(new Set([...tourism, ...maps, ...deals]))
    return Response.json({ ids }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load focus contacts') }, { status: 500 })
  }
}
