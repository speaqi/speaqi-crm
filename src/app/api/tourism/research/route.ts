import { NextRequest } from 'next/server'
import {
  requireTourismOwner,
  tourismBody,
  tourismError,
  tourismResponse
} from '@/lib/server/tourism'
import {
  isUuid,
  safePublicUrl,
  textValue,
  TourismInputError
} from '@/lib/tourism'
import { runSiteResearch, poiGeoJson } from '@/lib/server/tourism-research'
import { createLeadTask } from '@/lib/server/ai-ready'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180
const id = (value: unknown) => {
  if (!isUuid(value)) throw new TourismInputError('ID non valido')
  return value
}
const url = (value: unknown) => {
  const u = safePublicUrl(value)
  if (!u || (new URL(u).port && !['80', '443'].includes(new URL(u).port)))
    throw new TourismInputError('URL pubblica richiesta')
  return u
}
const checked = <T extends { error: unknown }>(result: T): T => {
  if (result.error) throw result.error
  return result
}
const pageOf = (value: string | null) =>
  Math.min(10000, Math.max(0, Math.floor(Number(value) || 0)))

export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase,
    owner = auth.user.id,
    p = request.nextUrl.searchParams
  try {
    if (p.get('view') === 'overview') {
      const pending = checked(
        await sb
          .from('tourism_site_sources')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', owner)
          .eq('qualification_pending', true)
          .eq('excluded', false)
      )
      const checkedSites = checked(
        await sb
          .from('tourism_site_sources')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', owner)
          .not('qualification_checked_at', 'is', null)
      )
      return tourismResponse({
        qualification_pending: pending.count || 0,
        qualification_checked: checkedSites.count || 0,
        ...checked(await sb.rpc('tourism_research_overview')).data,
        worker_available:
          Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
          process.env.TOURISM_RESEARCH_ENABLED !== 'false'
      })
    }
    if (p.get('source_id')) {
      const sourceId = id(p.get('source_id')),
        page = pageOf(p.get('page'))
      const [source, scans, pois] = await Promise.all([
        sb
          .from('tourism_site_sources')
          .select('*')
          .eq('user_id', owner)
          .eq('id', sourceId)
          .maybeSingle(),
        sb
          .from('tourism_site_scans')
          .select(
            'id,state,started_at,finished_at,requests,bytes,duration_ms,changes'
          )
          .eq('user_id', owner)
          .eq('source_id', sourceId)
          .order('finished_at', { ascending: false })
          .limit(4),
        sb
          .from('tourism_poi_candidates')
          .select('*', { count: 'exact' })
          .eq('user_id', owner)
          .eq('source_id', sourceId)
          .order('name')
          .order('id')
          .range(page * 100, page * 100 + 99)
      ])
      checked(source)
      checked(scans)
      checked(pois)
      if (!source.data)
        return tourismResponse({ error: 'Sito non trovato' }, 404)
      if (p.get('format') === 'geojson') {
        if (
          source.data.official_status !== 'confirmed' ||
          source.data.destination_status !== 'confirmed'
        )
          throw new TourismInputError(
            'Confermare prima identità e destinazione del sito'
          )
        const all = []
        for (let offset = 0; offset < 100000; offset += 1000) {
          const result = checked(
            await sb
              .from('tourism_poi_candidates')
              .select('*')
              .eq('user_id', owner)
              .eq('source_id', sourceId)
              .eq('state', 'approved')
              .order('id')
              .range(offset, offset + 999)
          )
          all.push(...(result.data || []))
          if ((result.data || []).length < 1000) break
        }
        return tourismResponse({ geojson: poiGeoJson(all) })
      }
      return tourismResponse({
        source: source.data,
        scans: scans.data,
        pois: pois.data,
        total: pois.count,
        page
      })
    }
    if (p.get('view') === 'review') {
      let query = sb
        .from('tourism_entities')
        .select(
          'id,name,country_code,type_code,status,version,website,details,evidence:tourism_evidence(*)',
          { count: 'exact' }
        )
        .eq('user_id', owner)
        .eq('kind', 'organization')
        .in('status', ['UNVERIFIED', 'NEEDS_REVIEW', 'DISCOVERED'])
      query = query.eq('excluded', p.get('availability') === 'disabled')
      if (p.get('country')) query = query.eq('country_code', p.get('country')!)
      const page = pageOf(p.get('page')),
        result = checked(
          await query
            .order('name')
            .order('id')
            .range(page * 25, page * 25 + 24)
        )
      return tourismResponse({
        entities: result.data,
        total: result.count,
        page
      })
    }
    if (p.get('view') === 'opportunities' || p.get('view') === 'canonical') {
      const table =
        p.get('view') === 'canonical'
          ? 'tourism_canonical_links'
          : 'tourism_project_opportunities'
      const result = checked(
        await sb
          .from(table)
          .select('*', { count: 'exact' })
          .eq('user_id', owner)
          .order('created_at', { ascending: false })
          .limit(200)
      )
      return tourismResponse({ rows: result.data, total: result.count })
    }
    if (p.get('view') === 'export') {
      const rows = []
      for (let offset = 0; offset < 100000; offset += 1000) {
        const result = checked(
          await sb
            .from('tourism_site_sources')
            .select(
              'id,label,url,country_code,official_status,destination_status,enabled,last_scanned_at,last_state,latest_report'
            )
            .eq('user_id', owner)
            .order('id')
            .range(offset, offset + 999)
        )
        rows.push(...(result.data || []))
        if ((result.data || []).length < 1000) break
      }
      const headers = [
        'id',
        'destinazione',
        'sito',
        'paese',
        'identita',
        'destinazione_confermata',
        'controllo_periodico',
        'ultima_scansione',
        'stato',
        'url_sitemap_osservati',
        'url_luoghi_candidati',
        'url_ristoranti_candidati',
        'schede_estratte',
        'con_coordinate',
        'conteggio_completo'
      ]
      const csv = [
        headers,
        ...rows.map((r) => [
          r.id,
          r.label,
          r.url,
          r.country_code,
          r.official_status,
          r.destination_status,
          r.enabled,
          r.last_scanned_at || '',
          r.last_state || 'non_scansionato',
          r.latest_report?.sitemap_urls_seen ?? '',
          r.latest_report?.place_url_candidates ?? '',
          r.latest_report?.restaurant_url_candidates ?? '',
          r.latest_report?.candidates?.length ?? '',
          r.latest_report?.geocoded_candidates ?? '',
          'no'
        ])
      ]
        .map((r) =>
          r
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@-]/, "'$&")
                  .replace(/"/g, '""') +
                '"'
            )
            .join(',')
        )
        .join('\r\n')
      return tourismResponse({ csv })
    }
    const page = pageOf(p.get('page'))
    let query = sb
      .from('tourism_site_sources')
      .select('*', { count: 'exact' })
      .eq('user_id', owner)
    query = query.eq('excluded', p.get('availability') === 'disabled')
    if (p.get('country')) query = query.eq('country_code', p.get('country')!)
    if (p.get('state')) query = query.eq('last_state', p.get('state')!)
    if (p.get('q'))
      query = query.ilike(
        'label',
        '%' +
          p
            .get('q')!
            .replace(/[%_\\]/g, '')
            .slice(0, 100) +
          '%'
      )
    const result = checked(
      await query
        .order('label')
        .order('id')
        .range(page * 50, page * 50 + 49)
    )
    return tourismResponse({
      sources: result.data,
      total: result.count,
      page,
      size: 50
    })
  } catch (error) {
    return tourismError(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase,
    owner = auth.user.id
  try {
    const body = await tourismBody(request)
    if (body.action === 'register_candidates') {
      const result = checked(await sb.rpc('tourism_queue_site_checks'))
      return tourismResponse(result.data)
    }
    if (body.action === 'register') {
      const label = textValue(body.label, 200),
        country = String(body.country_code || '')
      if (label.length < 2 || !/^[A-Z]{2}$/.test(country))
        throw new TourismInputError('Nome e paese richiesti')
      const result = checked(
        await sb
          .from('tourism_site_sources')
          .insert({
            user_id: owner,
            entity_id: body.entity_id ? id(body.entity_id) : null,
            label,
            country_code: country,
            url: url(body.url),
            enabled: false
          })
          .select('*')
          .single()
      )
      return tourismResponse({ source: result.data }, 201)
    }
    if (body.action === 'bulk_review') {
      if (body.confirmed !== true)
        throw new TourismInputError('Confermare il controllo delle fonti')
      const result = checked(
        await sb.rpc('tourism_bulk_review', { p_items: body.items })
      )
      return tourismResponse({ reviewed: result.data })
    }
    if (body.action === 'canonical')
      return tourismResponse({
        id: checked(
          await sb.rpc('tourism_set_canonical', {
            p_duplicate: id(body.duplicate_id),
            p_canonical: id(body.canonical_id),
            p_duplicate_version: body.duplicate_version,
            p_canonical_version: body.canonical_version,
            p_reason: textValue(body.reason, 2000)
          })
        ).data
      })
    if (body.action === 'undo_canonical') {
      checked(
        await sb.rpc('tourism_undo_canonical', { p_link_id: id(body.id) })
      )
      return tourismResponse({ ok: true })
    }
    if (body.action === 'scan')
      return tourismResponse(await runSiteResearch(sb, owner, id(body.id)))
    if (body.action === 'source_settings') {
      if (!Number.isInteger(body.version))
        throw new TourismInputError('Versione richiesta')
      const patch: Record<string, unknown> = {}
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      if (typeof body.excluded === 'boolean') {
        patch.excluded = body.excluded
        patch.exclusion_origin = body.excluded ? 'manual' : ''
        if (body.excluded) {
          patch.enabled = false
          patch.qualification_pending = false
        }
      }
      for (const key of ['interval_days', 'max_requests'])
        if (body[key] !== undefined) {
          if (!Number.isInteger(body[key]))
            throw new TourismInputError('Limite non valido')
          patch[key] = body[key]
        }
      if (
        body.official_status !== undefined ||
        body.destination_status !== undefined
      ) {
        for (const key of ['official_status', 'destination_status'])
          if (body[key] !== undefined) {
            if (
              !['candidate', 'confirmed', 'rejected'].includes(
                String(body[key])
              )
            )
              throw new TourismInputError('Decisione non valida')
            patch[key] = body[key]
          }
        patch.review_url = url(body.review_url)
        patch.review_note = textValue(body.review_note, 2000)
      }
      if (!Object.keys(patch).length)
        throw new TourismInputError('Modifica vuota')
      const result = checked(
        await sb
          .from('tourism_site_sources')
          .update(patch)
          .eq('id', id(body.id))
          .eq('user_id', owner)
          .eq('version', body.version)
          .select('*')
          .maybeSingle()
      )
      if (!result.data)
        return tourismResponse(
          { error: 'Version conflict: ricaricare il sito' },
          409
        )
      return tourismResponse({ source: result.data })
    }
    if (body.action === 'review_poi') {
      const result = checked(
        await sb
          .from('tourism_poi_candidates')
          .select('source_id')
          .eq('id', id(body.id))
          .eq('user_id', owner)
          .single()
      )
      if (!result.data) throw new TourismInputError('Scheda non trovata')
      const source = checked(
        await sb
          .from('tourism_site_sources')
          .select('official_status,destination_status')
          .eq('id', result.data.source_id)
          .eq('user_id', owner)
          .single()
      ).data
      if (
        !source ||
        source.official_status !== 'confirmed' ||
        source.destination_status !== 'confirmed'
      )
        throw new TourismInputError(
          'Confermare identità e destinazione del sito'
        )
      if (!['approved', 'rejected'].includes(String(body.state)))
        throw new TourismInputError('Decisione non valida')
      const reuse = String(body.reuse_status || 'unknown')
      if (!['unknown', 'authorized', 'open'].includes(reuse))
        throw new TourismInputError('Permesso non valido')
      if (
        body.state === 'approved' &&
        (reuse === 'unknown' ||
          !body.reuse_url ||
          textValue(body.review_note, 2000).length < 10)
      )
        throw new TourismInputError(
          'Per approvare servono verifica della scheda e fonte della licenza o autorizzazione al riuso'
        )
      checked(
        await sb
          .from('tourism_poi_candidates')
          .update({
            state: body.state,
            reuse_status: reuse,
            reuse_url: body.reuse_url ? url(body.reuse_url) : null,
            review_note: textValue(body.review_note, 2000),
            reviewed_by: owner,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', body.id)
          .eq('user_id', owner)
      )
      return tourismResponse({ ok: true })
    }
    if (body.action === 'opportunity') {
      const fields = {
        entity_id: id(body.entity_id),
        title: textValue(body.title, 200),
        project_kind: String(body.project_kind || 'destination_map'),
        source_url: url(body.source_url),
        rationale: textValue(body.rationale, 3000),
        responsible: textValue(body.responsible, 200),
        next_action: textValue(body.next_action, 1000)
      }
      const result = checked(
        await sb
          .from('tourism_project_opportunities')
          .insert({ ...fields, user_id: owner })
          .select('*')
          .single()
      )
      return tourismResponse({ opportunity: result.data }, 201)
    }
    if (body.action === 'opportunity_update') {
      if (!Number.isInteger(body.version))
        throw new TourismInputError('Versione richiesta')
      const patch: Record<string, unknown> = {}
      if (body.stage !== undefined) patch.stage = String(body.stage)
      for (const key of ['responsible', 'next_action'])
        if (body[key] !== undefined) patch[key] = textValue(body[key], 1000)
      if (body.project_status !== undefined) {
        patch.project_status = body.project_status || null
        patch.platform_project_url = body.platform_project_url
          ? url(body.platform_project_url)
          : null
      }
      const result = checked(
        await sb
          .from('tourism_project_opportunities')
          .update(patch)
          .eq('id', id(body.id))
          .eq('user_id', owner)
          .eq('version', body.version)
          .select('*')
          .maybeSingle()
      )
      if (!result.data)
        return tourismResponse(
          { error: 'Version conflict: ricaricare opportunità' },
          409
        )
      return tourismResponse({ opportunity: result.data })
    }
    if (body.action === 'task') {
      const entityId = id(body.entity_id)
      const e = checked(
        await sb
          .from('tourism_entities')
          .select('status')
          .eq('user_id', owner)
          .eq('id', entityId)
          .single()
      ).data
      const link = checked(
        await sb
          .from('tourism_crm_links')
          .select('contact_id')
          .eq('user_id', owner)
          .eq('entity_id', entityId)
          .maybeSingle()
      ).data
      if (!e || e.status !== 'VERIFIED' || !link)
        throw new TourismInputError(
          'Organizzazione verificata e collegata al CRM richiesta'
        )
      const due = String(body.due_at || ''),
        note = textValue(body.note, 2000),
        key = id(body.request_id)
      if (
        !Number.isFinite(Date.parse(due)) ||
        Date.parse(due) < Date.now() - 60000 ||
        note.length < 10
      )
        throw new TourismInputError('Data futura e prossimo passo richiesti')
      const task = await createLeadTask(sb, owner, {
        leadId: link.contact_id,
        action: 'wait',
        dueAt: new Date(due).toISOString(),
        note,
        idempotencyKey: `tourism:${entityId}:${key}`
      })
      return tourismResponse(
        { task_id: task.id, contact_id: link.contact_id },
        201
      )
    }
    throw new TourismInputError('Azione non valida')
  } catch (error) {
    return tourismError(error)
  }
}
