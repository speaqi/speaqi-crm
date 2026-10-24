import { NextRequest } from 'next/server'
import {
  ENTITY_KINDS,
  ENTITY_STATUSES,
  RELATION_LABELS,
  TOURISM_TYPES,
  SCORE_FACTORS,
  safePublicUrl,
  textValue,
  isUuid,
  normalizeEvidence,
  normalizeRecord,
  parseTourismImport,
  TourismInputError,
  tourismSearchFilter
} from '@/lib/tourism'
import {
  requireTourismOwner,
  tourismBody,
  tourismError,
  tourismResponse
} from '@/lib/server/tourism'
import pilot from '@/data/tourism-italy-pilot'

export const dynamic = 'force-dynamic'
const requireId = (value: unknown) => {
  if (!isUuid(value)) throw new TourismInputError('ID non valido')
  return value
}

export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase
  const owner = auth.user.id
  const params = request.nextUrl.searchParams
  try {
    if (params.get('id')) {
      const id = requireId(params.get('id'))
      const [entity, evidence, relations, revisions, links, matches] =
        await Promise.all([
          sb
            .from('tourism_entities')
            .select('*')
            .eq('user_id', owner)
            .eq('id', id)
            .maybeSingle(),
          sb
            .from('tourism_evidence')
            .select('*')
            .eq('user_id', owner)
            .eq('entity_id', id)
            .order('acquired_at', { ascending: false })
            .limit(100),
          sb
            .from('tourism_relations')
            .select('*')
            .eq('user_id', owner)
            .or(`from_id.eq.${id},to_id.eq.${id}`)
            .limit(200),
          sb
            .from('tourism_revisions')
            .select('id,table_name,operation,actor_id,created_at')
            .eq('user_id', owner)
            .eq('record_id', id)
            .order('created_at', { ascending: false })
            .limit(30),
          sb
            .from('tourism_crm_links')
            .select('contact_id')
            .eq('user_id', owner)
            .eq('entity_id', id)
            .maybeSingle(),
          sb
            .from('tourism_crm_matches')
            .select(
              'id,contact_id,rule,score,state,matched_at,contact:contacts(id,name,company,country,status)'
            )
            .eq('user_id', owner)
            .eq('entity_id', id)
            .eq('state', 'candidate')
            .order('score', { ascending: false })
            .limit(5)
        ])
      for (const result of [
        entity,
        evidence,
        relations,
        revisions,
        links,
        matches
      ])
        if (result.error) throw result.error
      if (!entity.data)
        return tourismResponse({ error: 'Entità non trovata' }, 404)
      const neighborIds = [
        ...new Set((relations.data || []).flatMap((r) => [r.from_id, r.to_id]))
      ].filter((v) => v !== id)
      const sourceIds = [
        ...new Set((relations.data || []).map((r) => r.evidence_id))
      ]
      const [neighbors, contact, relationEvidence] = await Promise.all([
        neighborIds.length
          ? sb
              .from('tourism_entities')
              .select('*')
              .eq('user_id', owner)
              .in('id', neighborIds)
          : Promise.resolve({ data: [], error: null }),
        links.data
          ? sb
              .from('contacts')
              .select('id,name,company,email,phone,status,updated_at')
              .eq('user_id', owner)
              .eq('id', links.data.contact_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        sourceIds.length
          ? sb
              .from('tourism_evidence')
              .select('*')
              .eq('user_id', owner)
              .in('id', sourceIds)
          : Promise.resolve({ data: [], error: null })
      ])
      for (const result of [neighbors, contact, relationEvidence])
        if (result.error) throw result.error
      return tourismResponse({
        entity: entity.data,
        evidence: evidence.data,
        relations: relations.data,
        relationEvidence: relationEvidence.data,
        neighbors: neighbors.data,
        revisions: revisions.data,
        contact: contact.data,
        matches: matches.data || []
      })
    }
    if (params.get('view') === 'overview') {
      const { data, error } = await sb.rpc('tourism_overview')
      if (error) throw error
      return tourismResponse(data)
    }
    if (params.get('view') === 'coverage') {
      const { data, error } = await sb.rpc('tourism_catalog_coverage')
      if (error) throw error
      return tourismResponse(data)
    }
    if (params.get('view') === 'graph') {
      if (params.get('focus')) {
        const focus = requireId(params.get('focus'))
        const [center, edges] = await Promise.all([
          sb
            .from('tourism_entities')
            .select('*')
            .eq('user_id', owner)
            .eq('id', focus)
            .maybeSingle(),
          sb
            .from('tourism_relations')
            .select('*', { count: 'exact' })
            .eq('user_id', owner)
            .or(`from_id.eq.${focus},to_id.eq.${focus}`)
            .order('id')
            .limit(200)
        ])
        if (center.error) throw center.error
        if (edges.error) throw edges.error
        if (!center.data)
          return tourismResponse({ error: 'Entità non trovata' }, 404)
        const neighbors = [
          ...new Set((edges.data || []).flatMap((r) => [r.from_id, r.to_id]))
        ].filter((id) => id !== focus)
        const evidenceIds = [
          ...new Set((edges.data || []).map((r) => r.evidence_id))
        ]
        const [entities, evidence] = await Promise.all([
          neighbors.length
            ? sb
                .from('tourism_entities')
                .select('*')
                .eq('user_id', owner)
                .in('id', neighbors)
            : Promise.resolve({ data: [], error: null }),
          evidenceIds.length
            ? sb
                .from('tourism_evidence')
                .select('*')
                .eq('user_id', owner)
                .in('id', evidenceIds)
            : Promise.resolve({ data: [], error: null })
        ])
        if (entities.error) throw entities.error
        if (evidence.error) throw evidence.error
        return tourismResponse({
          entities: [center.data, ...(entities.data || [])],
          relations: edges.data,
          evidence: evidence.data,
          limit: 200,
          total_relations: edges.count,
          has_more: (edges.count || 0) > 200
        })
      }
      const [entities, relations, evidence] = await Promise.all([
        sb
          .from('tourism_entities')
          .select('*')
          .eq('user_id', owner)
          .eq('kind', 'place')
          .order('id')
          .limit(500),
        sb
          .from('tourism_relations')
          .select('*')
          .eq('user_id', owner)
          .order('id')
          .limit(1000),
        sb
          .from('tourism_evidence')
          .select('*')
          .eq('user_id', owner)
          .order('id')
          .limit(1000)
      ])
      for (const r of [entities, relations, evidence])
        if (r.error) throw r.error
      return tourismResponse({
        entities: entities.data,
        relations: relations.data,
        evidence: evidence.data,
        limit: 500
      })
    }
    const page = Math.max(
      0,
      Math.min(100000, Math.floor(Number(params.get('page')) || 0))
    )
    const size = 50
    const crmFilter = params.get('crm') || ''
    if (crmFilter && crmFilter !== 'matched')
      throw new TourismInputError('Filtro CRM non valido')
    // «Fiera» è un tag: gli enti che espongono a quella fiera (trade_fair_exhibitors.entity_id).
    const fairFilter = params.get('fair') || ''
    if (fairFilter && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fairFilter))
      throw new TourismInputError('Fiera non valida')
    let query = sb
      .from('tourism_entities')
      .select(
        `*, evidence:tourism_evidence(*), crm:tourism_crm_links(contact_id), matches:tourism_crm_matches${crmFilter === 'matched' ? '!inner' : ''}(contact_id,score,state)${fairFilter ? ', fairs:trade_fair_exhibitors!inner(fair,hall,stand)' : ''}`,
        { count: 'exact' }
      )
      .eq('user_id', owner)
    if (crmFilter === 'matched') query = query.eq('matches.state', 'candidate')
    if (fairFilter) query = query.eq('fairs.fair', fairFilter)
    const kind = params.get('kind') || 'organization'
    if (!(ENTITY_KINDS as readonly string[]).includes(kind))
      throw new TourismInputError('Tipo entità non valido')
    query = query.eq('kind', kind)
    const availability = params.get('availability') || 'active'
    if (!['active', 'disabled', 'all'].includes(availability))
      throw new TourismInputError('Disponibilità non valida')
    if (availability !== 'all')
      query = query.eq('disabled', availability === 'disabled')
    const target = params.get('target') || ''
    if (target) {
      if (
        ![
          'destination_likely',
          'incoming_likely',
          'mixed',
          'inconclusive'
        ].includes(target)
      )
        throw new TourismInputError('Filtro destinazione non valido')
      query = query.eq('site_qualification->>classification', target)
    }
    const outreach = params.get('outreach') || ''
    if (outreach) {
      if (!['top', 'listed'].includes(outreach))
        throw new TourismInputError('Filtro contatti non valido')
      query =
        outreach === 'top'
          ? query.eq('outreach_priority', 1)
          : query.not('outreach_priority', 'is', null)
    }
    const country = params.get('country')
    if (country) {
      if (!/^[A-Z]{2}$/.test(country))
        throw new TourismInputError('Paese non valido')
      query = query.eq('country_code', country)
    }
    const type = params.get('type')
    if (type) {
      if (!Object.hasOwn(TOURISM_TYPES, type))
        throw new TourismInputError('Categoria non valida')
      query = query.eq('type_code', type)
    }
    const status = params.get('status')
    if (status) {
      if (!(ENTITY_STATUSES as readonly string[]).includes(status))
        throw new TourismInputError('Stato non valido')
      query = query.eq('status', status)
    }
    const search = tourismSearchFilter(params.get('q') || '')
    if (search) query = query.or(search)
    const sortParam = params.get('sort')
    // "Da contattare prima": priorità 1, 2, 3, poi il resto, e dentro A–Z.
    if (sortParam === 'outreach')
      query = query.order('outreach_priority', {
        ascending: true,
        nullsFirst: false
      })
    const sort = sortParam === 'recent' ? 'created_at' : 'name'
    const { data, count, error } = await query
      .order(sort, { ascending: sort === 'name' })
      .order('id')
      .range(page * size, page * size + size - 1)
    if (error) throw error
    return tourismResponse({ entities: data, total: count, page, size })
  } catch (error) {
    return tourismError(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase
  const owner = auth.user.id
  try {
    const body = await tourismBody(request)
    if (body.action === 'set_disabled') {
      if (typeof body.disabled !== 'boolean' || !Number.isInteger(body.version))
        throw new TourismInputError('Versione e decisione richieste')
      const result = await sb.rpc('tourism_toggle_entity', {
        p_entity_id: requireId(body.id),
        p_version: body.version,
        p_disabled: body.disabled
      })
      if (result.error) throw result.error
      return tourismResponse(result.data)
    }
    if (body.action === 'set_outreach') {
      const priority = body.priority
      if (
        !Number.isInteger(body.version) ||
        !(priority === null || [1, 2, 3].includes(priority as number))
      )
        throw new TourismInputError('Versione e priorità (1, 2, 3 o nessuna) richieste')
      const result = await sb.rpc('tourism_set_outreach', {
        p_entity_id: requireId(body.id),
        p_version: body.version,
        p_priority: priority,
        p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null
      })
      if (result.error) throw result.error
      return tourismResponse(result.data)
    }
    if (body.action === 'preview')
      return tourismResponse(parseTourismImport(String(body.text || '')))
    if (
      body.action === 'import' ||
      body.action === 'pilot' ||
      body.action === 'create'
    ) {
      const raw =
        body.action === 'pilot'
          ? pilot.records
          : body.action === 'create'
            ? [body.record]
            : body.records
      if (!Array.isArray(raw) || !raw.length || raw.length > 200)
        throw new TourismInputError('Importare da 1 a 200 record')
      const records = raw.map((r) =>
        normalizeRecord(
          r,
          body.action === 'pilot'
            ? 'pilot'
            : body.action === 'create'
              ? 'manual'
              : 'import'
        )
      )
      const { data, error } = await sb.rpc('tourism_import', {
        p_records: records,
        p_relations: body.action === 'pilot' ? pilot.relations : []
      })
      if (error) throw error
      return tourismResponse(data, 201)
    }
    if (body.action === 'evidence') {
      const entity_id = requireId(body.id)
      const e = normalizeEvidence(body.evidence)
      const { data, error } = await sb
        .from('tourism_evidence')
        .insert({ ...e, entity_id, user_id: owner })
        .select('*')
        .single()
      if (error) throw error
      return tourismResponse({ evidence: data }, 201)
    }
    if (body.action === 'relation') {
      const from_id = requireId(body.id),
        to_id = requireId(body.to_id),
        evidence_id = requireId(body.evidence_id)
      const relation = String(body.relation)
      if (!Object.hasOwn(RELATION_LABELS, relation))
        throw new TourismInputError('Relazione non valida')
      const { data, error } = await sb
        .from('tourism_relations')
        .insert({ user_id: owner, from_id, to_id, relation, evidence_id })
        .select('*')
        .single()
      if (error) throw error
      return tourismResponse({ relation: data }, 201)
    }
    const id = requireId(body.id)
    if (body.action === 'link_existing') {
      if (!Number.isInteger(body.version))
        throw new TourismInputError('Versione richiesta')
      const { data, error } = await sb.rpc('tourism_link_existing', {
        p_entity_id: id,
        p_contact_id: requireId(body.contact_id),
        p_version: body.version
      })
      if (error) throw error
      return tourismResponse(data)
    }
    if (body.action === 'dismiss_match') {
      const { data, error } = await sb
        .from('tourism_crm_matches')
        .update({ state: 'rejected' })
        .eq('user_id', owner)
        .eq('entity_id', id)
        .eq('contact_id', requireId(body.contact_id))
        .eq('state', 'candidate')
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) throw new TourismInputError('Corrispondenza non trovata')
      return tourismResponse({ ok: true })
    }
    if (body.action === 'indicator') {
      if (
        !(String(body.factor) in SCORE_FACTORS) ||
        !Number.isInteger(body.version) ||
        !Number.isInteger(body.value) ||
        Number(body.value) < 0 ||
        Number(body.value) > 100
      )
        throw new TourismInputError('Indicatore o valore non valido')
      const source = safePublicUrl(body.source_url)
      const rationale = textValue(body.rationale, 500)
      if (!source || rationale.length < 2)
        throw new TourismInputError('Fonte e motivazione richieste')
      const { error } = await sb.rpc('tourism_save_indicator', {
        p_entity_id: id,
        p_version: body.version,
        p_factor: body.factor,
        p_value: body.value,
        p_source_url: source,
        p_rationale: rationale
      })
      if (error) throw error
      return tourismResponse({ ok: true })
    }
    if (body.action === 'review') {
      if (!Number.isInteger(body.version) || typeof body.approve !== 'boolean')
        throw new TourismInputError('Versione e decisione richieste')
      const { error } = await sb.rpc('tourism_review', {
        p_entity_id: id,
        p_evidence_id: requireId(body.evidence_id),
        p_version: body.version,
        p_approve: body.approve
      })
      if (error) throw error
      return tourismResponse({ ok: true })
    }
    if (body.action === 'promote') {
      const { data, error } = await sb.rpc('tourism_promote', {
        p_entity_id: id
      })
      if (error) throw error
      return tourismResponse(data)
    }
    if (body.action === 'sync') {
      if (
        !['to_crm', 'from_crm'].includes(String(body.direction)) ||
        !Number.isInteger(body.version)
      )
        throw new TourismInputError('Direzione o versione non valida')
      const { error } = await sb.rpc('tourism_sync', {
        p_entity_id: id,
        p_direction: body.direction,
        p_version: body.version
      })
      if (error) throw error
      return tourismResponse({ ok: true })
    }
    throw new TourismInputError('Azione non valida')
  } catch (error) {
    return tourismError(error)
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await tourismBody(request)
    const id = requireId(body.id)
    if (!Number.isInteger(body.version))
      throw new TourismInputError('Versione richiesta')
    const { data: current, error: readError } = await auth.supabase
      .from('tourism_entities')
      .select('*')
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!current) return tourismResponse({ error: 'Entità non trovata' }, 404)
    const patch: Record<string, unknown> = {}
    if (body.record) {
      const record = normalizeRecord({
        ...current,
        ...(body.record as object),
        evidence: {
          source_url: 'https://crm.speaqi.com/tourism',
          title: 'Modifica manuale',
          fields: ['name']
        }
      })
      const { evidence, kind, ...fields } = record
      void evidence
      if (kind !== current.kind)
        throw new TourismInputError('Tipo entità immutabile')
      Object.assign(patch, fields)
    }
    if (body.status !== undefined) {
      if (
        !['UNVERIFIED', 'NEEDS_REVIEW', 'INACTIVE', 'DUPLICATE'].includes(
          String(body.status)
        )
      )
        throw new TourismInputError('Stato non valido')
      patch.status = body.status
    }
    if (!Object.keys(patch).length)
      throw new TourismInputError('Modifica vuota')
    const { data, error } = await auth.supabase
      .from('tourism_entities')
      .update(patch)
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .eq('version', body.version)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return tourismResponse(
        { error: 'Version conflict: ricaricare la scheda' },
        409
      )
    return tourismResponse({ entity: data })
  } catch (error) {
    return tourismError(error)
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const id = requireId(request.nextUrl.searchParams.get('id'))
    const version = Number(request.nextUrl.searchParams.get('version'))
    if (!Number.isInteger(version) || version < 1)
      throw new TourismInputError('Versione richiesta')
    const { data, error } = await auth.supabase
      .from('tourism_entities')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .eq('version', version)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return tourismResponse(
        { error: 'Version conflict o entità assente' },
        409
      )
    return tourismResponse({ ok: true })
  } catch (error) {
    return tourismError(error)
  }
}
