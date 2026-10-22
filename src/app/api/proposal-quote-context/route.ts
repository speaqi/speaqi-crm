import type { NextRequest } from 'next/server'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import { proposalQuoteContext } from '@/lib/server/proposal-quote-context'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'preventivi')
  if (areaError) return areaError
  if (!auth.isAdmin || auth.user.id !== auth.workspaceUserId) return Response.json({ error: 'Riservato al proprietario del workspace' }, { status: 403 })
  const type = request.nextUrl.searchParams.get('type')
  const id = request.nextUrl.searchParams.get('id') || ''
  if (type !== 'agency' && type !== 'tourism') return Response.json({ error: 'Tipo di proposta non valido' }, { status: 400 })
  try {
    return Response.json(await proposalQuoteContext(auth.supabase, auth.workspaceUserId, type, id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return Response.json({ error: 'Proposta non trovata o modello non disponibile' }, { status: 404 })
  }
}
