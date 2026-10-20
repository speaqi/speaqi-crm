import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { normalizeAgencyTemplate, validateAgencyBrief } from '@/lib/agency-deck'
import { runAgencyAgent } from '@/lib/server/agency-deck-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180
const running = new Set<string>()

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin || auth.user.id !== auth.workspaceUserId) return Response.json({ error: 'Speaqi Agency è riservata al proprietario del CRM' }, { status: 403 })
  if (running.has(auth.user.id)) return Response.json({ error: 'Una generazione è già in corso. Attendi il completamento.' }, { status: 409 })
  let brief, template
  try {
    if (Number(request.headers.get('content-length') || 0) > 100000) throw new Error('Richiesta troppo grande')
    const text = await request.text()
    if (text.length > 100000) throw new Error('Richiesta troppo grande')
    const body = JSON.parse(text)
    brief = validateAgencyBrief(body.brief)
    template = normalizeAgencyTemplate(body.template)
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Dati non validi' }, { status: 400 }) }
  running.add(auth.user.id)
  try {
    return Response.json(await runAgencyAgent(brief, template), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    const message = e instanceof Error ? e.message : ''
    return Response.json({ error: /^(Generazione AI|Risposta AI)/.test(message) ? message : 'Generazione non riuscita. La bozza precedente è conservata.' }, { status: 502 })
  } finally { running.delete(auth.user.id) }
}
