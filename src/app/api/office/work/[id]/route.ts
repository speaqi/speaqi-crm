import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { validateWorkPayload } from '@/lib/office-work'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const schemaMissing = (error: { code?: string } | null) => !!error && ['42P01', '42703', '42883', 'PGRST205', 'PGRST204', 'PGRST202'].includes(error.code || '')
const reasonText: Record<string, string> = {
  busy: 'Il lavoro è già in esecuzione. Aspetta il suo esito prima di modificarlo.',
  revision_conflict: 'Il lavoro è cambiato: aggiorna i dati prima di riprovare.',
  reconciliation_required: 'L’esito precedente è incerto: occorre verificarlo prima di riprendere.',
  already_terminal: 'Questo lavoro è già concluso e non può essere modificato.',
}
function publicRow(row: Record<string, unknown>) {
  const { lease_token: _lease, delivery_token: _delivery, checkpoint: _checkpoint, ...value } = row
  return value
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    if (!UUID.test(id)) return Response.json({ error: 'Lavoro non valido' }, { status: 400 })
    const found = await admin.from('office_work_items').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
    if (schemaMissing(found.error)) return Response.json({ supported: false, work: null })
    if (found.error) throw found.error
    if (!found.data) return Response.json({ error: 'Lavoro non trovato' }, { status: 404 })
    const [attempts, dependencies, outputLinks, events] = await Promise.all([
      admin.from('office_work_attempts').select('*').eq('user_id', userId).eq('work_id', id).order('created_at', { ascending: false }).limit(20),
      admin.from('office_work_dependencies').select('*').eq('user_id', userId).eq('work_id', id).limit(50),
      admin.from('office_work_outputs').select('*').eq('user_id', userId).eq('work_id', id).limit(50),
      admin.from('office_work_events').select('*').eq('user_id', userId).eq('work_id', id).order('created_at', { ascending: false }).limit(20),
    ])
    for (const result of [attempts, dependencies, outputLinks, events]) if (result.error) throw result.error
    const outputIds = (outputLinks.data || []).map((link: { output_id: string }) => link.output_id)
    const outputs = outputIds.length ? await admin.from('office_agent_outputs').select('id,title,status,kind,target_table,target_id')
      .eq('user_id', userId).in('id', outputIds) : { data: [], error: null }
    if (outputs.error) throw outputs.error
    return Response.json({ supported: true, work: publicRow(found.data), attempts: (attempts.data || []).map(publicRow),
      dependencies: dependencies.data || [], outputs: outputs.data || [], events: (events.data || []).map(publicRow) })
  })
}

/** Correzioni e ripresa passano da una RPC con controllo di versione e stato. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { id } = await context.params
    if (!UUID.test(id)) return Response.json({ error: 'Lavoro non valido' }, { status: 400 })
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['action', 'payload', 'expected_revision'].includes(key))
      || !['cancel', 'resume', 'update_payload'].includes(body.action)
      || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0
      || (body.action !== 'update_payload' && body.payload !== undefined)) {
      return Response.json({ error: 'Richiesta di modifica non valida' }, { status: 400 })
    }
    const found = await admin.from('office_work_items').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
    if (schemaMissing(found.error)) return Response.json({ error: 'Il registro dei lavori è in aggiornamento. Riprova più tardi.' }, { status: 503 })
    if (found.error) throw found.error
    if (!found.data) return Response.json({ error: 'Lavoro non trovato' }, { status: 404 })
    if (found.data.status === 'waiting_owner' && body.action !== 'cancel') {
      return Response.json({ error: 'Il lavoro aspetta una decisione sulla proposta: correggerlo non sostituisce l’approvazione.', reason: 'approval_required' }, { status: 409 })
    }
    const patch: Record<string, unknown> = { expected_revision: body.expected_revision }
    if (body.action === 'update_payload') {
      const allowed = new Set(['source', 'city', 'slug', 'website', 'entity_id', 'destination_id', 'target', 'brief', 'text'])
      if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)
        || Object.keys(body.payload).length === 0 || Object.keys(body.payload).some((key) => !allowed.has(key))) {
        return Response.json({ error: 'Puoi correggere soltanto i dati richiesti dal lavoro.' }, { status: 400 })
      }
      try { validateWorkPayload(found.data.agent_id, found.data.action, { ...found.data.payload, ...body.payload }) }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Dati non validi' }, { status: 400 }) }
      patch.payload = body.payload
    }
    const result = await admin.rpc('office_work_owner_action', { p_user_id: userId, p_work_id: id, p_action: body.action, p_patch: patch })
    if (schemaMissing(result.error)) return Response.json({ error: 'Il registro dei lavori è in aggiornamento. Riprova più tardi.' }, { status: 503 })
    if (result.error) throw result.error
    if (!result.data?.work) return Response.json({ error: reasonText[result.data?.reason] || 'Lavoro non trovato o non modificabile.',
      reason: result.data?.reason }, { status: result.data?.reason === 'not_found' ? 404 : 409 })
    return Response.json({ work: publicRow(result.data.work), notice: body.action === 'cancel' ? 'Lavoro annullato.'
      : body.action === 'update_payload' ? 'Dati aggiornati. Il lavoro riprende dopo il controllo dei prerequisiti.'
        : 'Ripresa richiesta. Il lavoro resta soggetto a interruttore, dipendenze e budget.' })
  })
}
