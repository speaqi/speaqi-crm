import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { scoreColumns, SosInput } from '@/lib/opportunity-score'

/**
 * Ricalcola lo Speaqi Opportunity Score di tutti gli espositori di una fiera.
 * Serve dopo un cambio dell'algoritmo e per le righe mai calcolate.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Le fiere sono di Tourism Intelligence: solo il titolare' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const fair = String(body.fair || 'ttg-2026').trim().toLowerCase()
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fair)) return Response.json({ error: 'Fiera non valida' }, { status: 400 })

    const rows: Record<string, any>[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await auth.supabase
        .from('trade_fair_exhibitors')
        .select('*')
        .eq('user_id', auth.workspaceUserId)
        .eq('fair', fair)
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < 1000) break
    }

    const now = new Date()
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((row) => ({ ...row, ...scoreColumns(row as unknown as SosInput, now) }))
      const { error } = await auth.supabase.from('trade_fair_exhibitors').upsert(chunk, { onConflict: 'id' })
      if (error) throw error
    }
    return Response.json({ rescored: rows.length })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile ricalcolare i punteggi') }, { status: 500 })
  }
}
