import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { decideOfficeOutput } from '@/lib/server/office-output-decision'
import { officeOutputIsNotice, type InboxDocument, type InboxResult } from '@/lib/office-inbox'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checked = (result: any) => { if (result.error) throw result.error; return result.data }

/** Coda paginata e stato attuale dei documenti, anche per rapporti di versioni precedenti. */
export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const raw = request.nextUrl.searchParams.get('offset') || '0'
    if (!/^\d{1,6}$/.test(raw) || Number(raw) > 100_000) return Response.json({ error: 'Pagina non valida' }, { status: 400 })
    const offset = Number(raw)
    const listed = await admin.from('office_agent_outputs').select('*', { count: 'exact' }).eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).order('id').range(offset, offset + 49)
    if (listed.error?.code === 'PGRST103') {
      const count = await admin.from('office_agent_outputs').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending')
      if (count.error) throw count.error
      return Response.json({ outputs: [], total: count.count || 0, offset })
    }
    const outputs = checked(listed) || []
    const ids = [...new Set<string>(outputs.filter((output: any) => output.target_table === 'tourism_decks' && UUID.test(output.target_id || ''))
      .map((output: any) => output.target_id))]
    const decks = ids.length ? checked(await admin.from('tourism_decks').select('id,title,status,version').eq('user_id', userId).in('id', ids)) : []
    const byId = new Map<string, InboxDocument>((decks || []).map((deck: InboxDocument) => [deck.id, deck]))
    return Response.json({ outputs: outputs.map((output: any) => ({ ...output,
      document: output.target_table === 'tourism_decks' ? byId.get(output.target_id) || null : null })), total: listed.count || 0, offset })
  })
}

/** Ogni approvazione usa il servizio comune; i letti passano dalla RPC dedicata senza effetti sui lavori. */
export async function POST(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const body = await request.json().catch(() => null)
    if (!body || Object.keys(body).some((key) => !['ids', 'action'].includes(key)) || !['acknowledge', 'approved', 'rejected'].includes(body.action)
      || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 50 || body.ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))
      || new Set(body.ids).size !== body.ids.length) return Response.json({ error: 'Seleziona da 1 a 50 voci e un’azione valida' }, { status: 400 })
    if (body.action === 'acknowledge') {
      const result = await admin.rpc('acknowledge_office_outputs', { p_user_id: userId, p_output_ids: body.ids })
      if (['42883', 'PGRST202'].includes(result.error?.code || '')) return Response.json({ error: 'Archiviazione in aggiornamento. Gli avvisi restano nella coda.' }, { status: 503 })
      return Response.json({ results: checked(result) })
    }
    const outputs = checked(await admin.from('office_agent_outputs').select('id,kind,body,status').eq('user_id', userId).in('id', body.ids)) || []
    const byId = new Map<string, any>(outputs.map((output: any) => [output.id, output]))
    const results: InboxResult[] = []
    for (const id of body.ids) {
      const output = byId.get(id)
      if (!output || output.status !== 'pending') { results.push({ id, ok: false, error: 'Voce non trovata o già gestita. Aggiorna la coda.' }); continue }
      if (officeOutputIsNotice(output)) { results.push({ id, ok: false, error: 'Questo è un avviso: usa “Segna come letto”.' }); continue }
      try {
        const result = await decideOfficeOutput(admin, userId, id, body.action)
        results.push(result.ok ? { id, ok: true } : { id, ok: false, error: result.error })
      } catch { results.push({ id, ok: false, error: 'Decisione non completata: aggiorna la coda prima di riprovare.' }) }
    }
    return Response.json({ results })
  })
}
