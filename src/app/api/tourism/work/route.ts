import { NextRequest } from 'next/server'
import {
  requireRouteUser,
  invalidateRouteUserCaches,
} from '@/lib/server/supabase'
import { tourismBody, tourismResponse } from '@/lib/server/tourism'
import { isUuid, TourismInputError } from '@/lib/tourism'
import {
  draftWorkBrief,
  type WorkItem,
  type WorkNote,
} from '@/lib/tourism-work'
import {
  buildWorkDraftRequest,
  takeWorkDraftSlot,
  workDraftText,
} from '@/lib/server/tourism-work-assistant'

const requireId = (value: unknown) => {
  if (!isUuid(value)) throw new TourismInputError('ID non valido')
  return value
}

function failure(error: unknown) {
  const e = error as { code?: string; message?: string }
  const code = e.code || ''
  if (/42P01|PGRST20[245]/.test(code))
    return tourismResponse(
      {
        error:
          'Area lavoro non attivata: applicare lo schema tourism-work al database CRM.',
      },
      503,
    )
  if (/42501/.test(code))
    return tourismResponse({ error: 'Operazione non consentita' }, 403)
  if (/Version conflict/.test(e.message || ''))
    return tourismResponse(
      { error: 'La scheda è cambiata: ricaricala prima di salvare.' },
      409,
    )
  if (/^23|^22|P0001/.test(code) || error instanceof Error)
    return tourismResponse({ error: e.message || 'Dati non validi' }, 400)
  console.error('Tourism work error', { code })
  return tourismResponse({ error: 'Operazione non completata' }, 500)
}
async function authWork(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return { error: auth.error! }
  const { data: identity, error } = await auth.supabase.rpc(
    'tourism_work_identity',
    { p_owner: auth.workspaceUserId },
  )
  if (error) return { error: failure(error) }
  if (!auth.isAdmin && !identity?.member_id)
    return {
      error: tourismResponse(
        { error: 'Accesso Turismo non abilitato dal responsabile' },
        403,
      ),
    }
  return { ...auth, identity }
}
const fields = [
  'kind',
  'title',
  'parent_id',
  'responsible_id',
  'collaborator_ids',
  'stage',
  'next_action',
  'due_on',
  'reason',
  'country_code',
  'segment',
  'shared_context',
  'website',
  'checklist',
]
const pick = (raw: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => Object.hasOwn(raw, k)).map((k) => [k, raw[k]]),
  )

export async function GET(request: NextRequest) {
  const auth = await authWork(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase,
    owner = auth.workspaceUserId,
    params = request.nextUrl.searchParams
  try {
    if (params.has('id')) {
      const id = requireId(params.get('id'))
      const results = await Promise.all([
        sb
          .from('tourism_work_items')
          .select('*')
          .eq('user_id', owner)
          .eq('id', id)
          .maybeSingle(),
        sb
          .from('tourism_work_notes')
          .select('*')
          .eq('user_id', owner)
          .eq('item_id', id)
          .order('created_at', { ascending: false })
          .limit(100),
        sb
          .from('tourism_work_events')
          .select('*')
          .eq('user_id', owner)
          .eq('item_id', id)
          .order('created_at', { ascending: false })
          .limit(100),
        sb
          .from('tourism_work_items')
          .select('*')
          .eq('user_id', owner)
          .eq('parent_id', id)
          .order('due_on')
          .limit(101),
      ])
      for (const r of results) if (r.error) throw r.error
      if (!results[0].data)
        return tourismResponse({ error: 'Scheda non trovata' }, 404)
      return tourismResponse({
        item: results[0].data,
        notes: results[1].data,
        events: results[2].data,
        children: results[3].data?.slice(0, 100),
        children_truncated: (results[3].data?.length || 0) > 100,
      })
    }
    if (params.get('view') === 'sources') {
      if (!auth.isAdmin)
        return tourismResponse(
          { error: 'Solo il proprietario può selezionare nuove fonti' },
          403,
        )
      const q = String(params.get('q') || '')
        .trim()
        .slice(0, 100)
        .replace(/[%_\\]/g, '')
      const results = await Promise.all([
        sb
          .from('tourism_entities')
          .select('id,name,country_code,type_code,kind')
          .eq('user_id', owner)
          .ilike('name', `%${q}%`)
          .order('name')
          .limit(50),
        sb
          .from('tourism_project_opportunities')
          .select('id,title,entity_id,source_url,rationale')
          .eq('user_id', owner)
          .ilike('title', `%${q}%`)
          .order('created_at', { ascending: false })
          .limit(30),
      ])
      for (const r of results) if (r.error) throw r.error
      return tourismResponse({
        entities: results[0].data,
        signals: results[1].data,
      })
    }
    const offset =
      Math.max(0, Math.floor(Number(params.get('page')) || 0)) * 100
    let query = sb
      .from('tourism_work_items')
      .select('*', { count: 'exact' })
      .eq('user_id', owner)
    if (params.get('mine') === 'true')
      query = auth.identity.member_id
        ? query.or(
            `responsible_id.eq.${auth.identity.member_id},collaborator_ids.cs.{${auth.identity.member_id}}`,
          )
        : query.is('responsible_id', null)
    const { data, error, count } = await query
      .order('due_on', { ascending: true, nullsFirst: false })
      .order('id')
      .range(offset, offset + 99)
    if (error) throw error
    let members: unknown[] = [],
      rules: unknown[] = []
    if (auth.isAdmin) {
      const results = await Promise.all([
        sb
          .from('team_members')
          .select('id,name')
          .eq('user_id', owner)
          .order('name'),
        sb
          .from('tourism_work_members')
          .select('member_id,access_kind,enabled')
          .eq('user_id', owner),
        sb
          .from('tourism_work_rules')
          .select('*')
          .eq('user_id', owner)
          .order('name'),
      ])
      for (const r of results) if (r.error) throw r.error
      members = (results[0].data || []).map((m) => ({
        ...m,
        enabled: false,
        access_kind: 'external',
        ...(results[1].data || []).find((p) => p.member_id === m.id),
      }))
      rules = results[2].data || []
    }
    const { data: summary, error: summaryError } = await sb.rpc(
      'tourism_work_summary',
      { p_owner: owner, p_mine: params.get('mine') === 'true' },
    )
    if (summaryError) throw summaryError
    return tourismResponse({
      items: data,
      total: count,
      summary,
      identity: auth.identity,
      is_admin: auth.isAdmin,
      members,
      rules,
      ai_configured: Boolean(process.env.OPENAI_API_KEY),
    })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await authWork(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase,
    owner = auth.workspaceUserId
  try {
    const body = await tourismBody(request)
    if (body.action === 'note' || body.action === 'assist') {
      const id = requireId(body.id)
      const { data: item, error } = await sb
        .from('tourism_work_items')
        .select('*')
        .eq('user_id', owner)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!item) return tourismResponse({ error: 'Scheda non trovata' }, 404)
      if (body.action === 'note') {
        const result = await sb
          .from('tourism_work_notes')
          .insert({
            user_id: owner,
            item_id: id,
            actor_id: auth.user.id,
            body: body.body,
            visibility: body.visibility,
            document_url: body.document_url || '',
          })
          .select('*')
          .single()
        if (result.error) throw result.error
        return tourismResponse({ note: result.data }, 201)
      }
      const { data: notes, error: noteError } = await sb
        .from('tourism_work_notes')
        .select('*')
        .eq('user_id', owner)
        .eq('item_id', id)
        .order('created_at', { ascending: false })
        .limit(10)
      if (noteError) throw noteError
      // Drafts intended for contacts never include internal notes.
      if (body.mode === 'brief')
        return tourismResponse({
          text: draftWorkBrief(item as WorkItem, (notes || []) as WorkNote[]),
          generated: false,
        })
      if (body.mode !== 'draft')
        return tourismResponse({ error: 'Modalità non valida' }, 400)
      const key = process.env.OPENAI_API_KEY
      if (!key)
        return tourismResponse(
          {
            error:
              'OPENAI_API_KEY non configurata. Il riepilogo della scheda resta disponibile.',
          },
          503,
        )
      if (!takeWorkDraftSlot(auth.user.id))
        return tourismResponse(
          { error: 'Attendi un minuto prima di generare un’altra bozza.' },
          429,
        )
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(40_000),
        body: JSON.stringify(
          buildWorkDraftRequest(
            item as WorkItem,
            (notes || []) as WorkNote[],
            process.env.OPENAI_TOURISM_WORK_MODEL || 'gpt-5-mini',
          ),
        ),
      })
      if (!response.ok)
        return tourismResponse(
          { error: 'Generazione AI non disponibile; riprova più tardi.' },
          502,
        )
      const generated = await response.json()
      const text = workDraftText(generated)
      if (!text)
        return tourismResponse(
          { error: 'La generazione non ha restituito una bozza' },
          502,
        )
      return tourismResponse({ text, generated: true })
    }
    if (!auth.isAdmin)
      return tourismResponse(
        { error: 'Solo il proprietario può assegnare attività e accessi' },
        403,
      )
    if (body.action === 'member') {
      const result = await sb.from('tourism_work_members').upsert(
        {
          member_id: requireId(body.member_id),
          user_id: owner,
          access_kind: body.access_kind,
          enabled: body.enabled,
        },
        { onConflict: 'member_id' },
      )
      if (result.error) throw result.error
      invalidateRouteUserCaches()
      return tourismResponse({ ok: true })
    }
    if (body.action === 'handoff') {
      const { error } = await sb.rpc('tourism_work_handoff', {
        p_id: requireId(body.id),
        p_version: body.version,
        p_member: body.responsible_id || null,
        p_collaborators: body.collaborator_ids || [],
      })
      if (error) throw error
      return tourismResponse({ ok: true })
    }
    if (body.action === 'rule') {
      const record = {
        ...pick(body, [
          'name',
          'country_code',
          'segment',
          'member_ids',
          'enabled',
        ]),
        user_id: owner,
      }
      const result = body.id
        ? await sb
            .from('tourism_work_rules')
            .update(record)
            .eq('id', requireId(body.id))
            .eq('user_id', owner)
        : await sb.from('tourism_work_rules').insert(record)
      if (result.error) throw result.error
      return tourismResponse({ ok: true })
    }
    if (body.action === 'assign_entities') {
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100)
        throw new Error('Selezionare da 1 a 100 schede')
      const { data, error } = await sb.rpc('tourism_work_assign_entities', {
        p_ids: body.ids.map(requireId),
        p_member: body.responsible_id || null,
        p_rule: body.rule_id || null,
        p_parent: body.parent_id || null,
        p_next_action: body.next_action,
        p_due_on: body.due_on,
      })
      if (error) throw error
      return tourismResponse({ created: data })
    }
    if (body.action === 'create' || body.action === 'signal') {
      const record = { ...pick(body, fields), user_id: owner } as Record<
        string,
        unknown
      >
      if (body.action === 'signal') {
        const { data: source, error } = await sb
          .from('tourism_project_opportunities')
          .select('id,title,entity_id,source_url')
          .eq('user_id', owner)
          .eq('id', requireId(body.signal_id))
          .single()
        if (error) throw error
        Object.assign(record, {
          title: source.title,
          kind: 'opportunity',
          entity_id: source.entity_id,
          source_opportunity_id: source.id,
          source_key: `signal:${source.id}`,
          website: source.source_url,
          checklist: [
            { label: 'Verificare il segnale e la fonte', done: false },
            {
              label: 'Individuare il referente e i partner pertinenti',
              done: false,
            },
            {
              label: 'Definire il prossimo contatto e registrarne l’esito',
              done: false,
            },
          ],
        })
      }
      const { data, error } = await sb
        .from('tourism_work_items')
        .insert(record)
        .select('*')
        .single()
      if (error?.code === '23505')
        return tourismResponse(
          {
            error:
              'Questa fonte è già stata assegnata. Apri la scheda esistente.',
          },
          409,
        )
      if (error) throw error
      return tourismResponse({ item: data }, 201)
    }
    throw new Error('Azione non valida')
  } catch (error) {
    return failure(error)
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authWork(request)
  if ('error' in auth) return auth.error
  try {
    const body = await tourismBody(request),
      id = requireId(body.id)
    if (!Number.isInteger(body.version) || Number(body.version) < 1)
      throw new Error('Versione richiesta')
    // Assignment always goes through the transactional handoff RPC.
    const patch = pick(
      body,
      auth.isAdmin
        ? fields.filter(
            (k) => !['responsible_id', 'collaborator_ids'].includes(k),
          )
        : ['stage', 'next_action', 'due_on', 'reason', 'checklist'],
    )
    if (body.acknowledge === true)
      patch.acknowledged_at = new Date().toISOString()
    if (!Object.keys(patch).length) throw new Error('Modifica vuota')
    const { data, error } = await auth.supabase
      .from('tourism_work_items')
      .update(patch)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .eq('version', body.version)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return tourismResponse(
        {
          error:
            'Scheda aggiornata da un collega o non disponibile. Ricarica la vista.',
        },
        409,
      )
    return tourismResponse({ item: data })
  } catch (error) {
    return failure(error)
  }
}
