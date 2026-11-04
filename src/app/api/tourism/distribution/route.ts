import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { requireTourismOwner, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createLeadFromInput } from '@/lib/server/lead-ops'
import {
  COMMERCIAL_STATUSES,
  distributionCsv,
  guideLabel,
  MODEL_LABELS,
  parseDistributionFilters,
  type CommercialModel,
  type DistributionRow,
} from '@/lib/tourism-distribution'
import { isUuid } from '@/lib/tourism'

const SELECT =
  'entity_id,score,tier,components,completeness,guide_slugs,volume_potential,model,model_alt,strategic,quick_win,commercial_status,notes,scored_at,' +
  'entity:tourism_entities!inner(name,type_code,country_code,website,email,phone,details)'

/**
 * Speaqi Guides — Distribution Opportunities.
 * GET            elenco filtrato (`?slug=&type=&country=&tier=&model=&status=&contact=&q=&min_score=...`)
 * GET ?summary=1 dashboard e matrice destinazione × categoria × paese
 * GET ?export=1  CSV dei risultati filtrati (fino a 5.000 righe)
 */
export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const params = request.nextUrl.searchParams
  try {
    if (params.get('contacts')) {
      const entityId = params.get('contacts')
      if (!isUuid(entityId)) return tourismResponse({ error: 'ID non valido' }, 400)
      const { data, error } = await auth.supabase
        .from('tourism_distribution_contacts')
        .select('id,full_name,job_title,linkedin_url,email,email_status,decision_maker,source')
        .eq('user_id', auth.workspaceUserId)
        .eq('entity_id', entityId)
        .order('decision_maker', { ascending: false })
        .order('full_name')
      if (error) throw error
      return tourismResponse({ contacts: data || [] })
    }
    if (params.get('summary') === '1') {
      const { data, error } = await auth.supabase.rpc('tourism_distribution_summary')
      if (error) throw error
      return tourismResponse({ summary: data })
    }
    const f = parseDistributionFilters(params)
    // `export=1` scarica il CSV; `export=json` dà le righe (fino a 5.000) alla pagina, che crea il file.
    const exporting = params.get('export') === '1' || params.get('export') === 'json'
    const owner = auth.workspaceUserId
    let ids: string[] | null = null
    if (f.q) {
      const like = `%${f.q.replace(/[%_,()]/g, ' ')}%`
      const { data, error } = await auth.supabase
        .from('tourism_entities')
        .select('id')
        .eq('user_id', owner)
        .or(`name.ilike.${like},website.ilike.${like}`)
        .limit(2000)
      if (error) throw error
      ids = (data || []).map((row: { id: string }) => row.id)
      if (!ids.length) return tourismResponse({ rows: [], total: 0 })
    }
    let query = auth.supabase
      .from('tourism_distribution')
      .select(SELECT, { count: 'exact' })
      .eq('user_id', owner)
      .gte('score', f.minScore)
    if (ids) query = query.in('entity_id', ids)
    if (f.slug) query = query.contains('guide_slugs', [f.slug])
    if (f.tiers.length) query = query.in('tier', f.tiers)
    if (f.model) query = query.eq('model', f.model)
    if (f.status) query = query.eq('commercial_status', f.status)
    if (f.volume) query = query.eq('volume_potential', f.volume)
    if (f.strategic) query = query.eq('strategic', true)
    if (f.quickWin) query = query.eq('quick_win', true)
    if (f.types.length) query = query.in('entity.type_code', f.types)
    if (f.countries.length) query = query.in('entity.country_code', f.countries)
    if (f.contact === 'email') query = query.not('entity.email', 'is', null).neq('entity.email', '')
    if (f.contact === 'phone') query = query.not('entity.phone', 'is', null).neq('entity.phone', '')
    if (f.contact === 'any') query = query.or('email.not.is.null,phone.not.is.null', { referencedTable: 'entity' })
    if (f.contact === 'none') query = query.is('entity.email', null).is('entity.phone', null)
    if (f.sort === 'name') query = query.order('name', { referencedTable: 'entity', ascending: true })
    else if (f.sort === 'completeness') query = query.order('completeness', { ascending: false }).order('score', { ascending: false })
    else query = query.order('score', { ascending: false }).order('entity_id')
    const limit = exporting ? Math.min(f.limit === 50 ? 5000 : f.limit, 5000) : Math.min(f.limit, 200)
    query = query.range(f.offset, f.offset + limit - 1)
    const { data, error, count } = await query
    if (error) throw error
    const rows = (data || []) as unknown as DistributionRow[]
    if (params.get('export') === 'json') return tourismResponse({ rows, total: count ?? rows.length })
    if (exporting) {
      return new Response(distributionCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="speaqi-guides-distribuzione-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      })
    }
    return tourismResponse({ rows, total: count ?? rows.length })
  } catch (error) {
    return tourismError(error)
  }
}

/**
 * POST { action: 'recompute' }                          ricalcola punteggi e fasce
 *      { action: 'status', entity_id, commercial_status, notes? }
 *      { action: 'to_crm', entity_ids: [...] }          contatto + opportunità «Distribuzione» (max 25)
 * Nessuna email parte da qui: «to_crm» crea solo il contatto e il prossimo passo.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.action !== 'string') return tourismResponse({ error: 'Azione non valida' }, 400)
  try {
    if (body.action === 'recompute') {
      const { data, error } = await auth.supabase.rpc('tourism_distribution_recompute')
      if (error) throw error
      return tourismResponse({ result: data })
    }
    if (body.action === 'status') {
      if (!isUuid(body.entity_id)) return tourismResponse({ error: 'ID non valido' }, 400)
      if (!(COMMERCIAL_STATUSES as readonly unknown[]).includes(body.commercial_status))
        return tourismResponse({ error: 'Stato non valido' }, 400)
      const patch: Record<string, unknown> = { commercial_status: body.commercial_status, updated_at: new Date().toISOString() }
      if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 2000) || null
      const { data, error } = await auth.supabase
        .from('tourism_distribution')
        .update(patch)
        .eq('user_id', auth.workspaceUserId)
        .eq('entity_id', body.entity_id)
        .select('entity_id,commercial_status,notes')
        .maybeSingle()
      if (error) throw error
      if (!data) return tourismResponse({ error: 'Prospect non trovato' }, 404)
      return tourismResponse({ row: data })
    }
    if (body.action === 'to_crm') {
      const ids = Array.isArray(body.entity_ids) ? body.entity_ids.filter(isUuid).slice(0, 25) : []
      if (!ids.length) return tourismResponse({ error: 'Scegli almeno un prospect' }, 400)
      const admin = createServiceRoleClient()
      const owner = auth.workspaceUserId
      const { data: rows, error } = await admin
        .from('tourism_distribution')
        .select('entity_id,score,tier,model,guide_slugs,commercial_status,entity:tourism_entities!inner(name,type_code,country_code,website,email,phone)')
        .eq('user_id', owner)
        .in('entity_id', ids)
      if (error) throw error
      const { data: people } = await admin
        .from('tourism_distribution_contacts')
        .select('entity_id,full_name,job_title,email,email_status,decision_maker')
        .eq('user_id', owner)
        .in('entity_id', ids)
      // Il referente migliore: prima chi decide, poi chi ha un'email verificata.
      const best = new Map<string, { full_name: string; job_title: string | null; email: string | null }>()
      const rank = (p: any) => (p.decision_maker ? 2 : 0) + (p.email && p.email_status === 'verified' ? 1 : 0)
      for (const person of (people || []) as any[]) {
        const current = best.get(person.entity_id) as any
        if (!current || rank(person) > rank(current)) best.set(person.entity_id, person)
      }
      const results: { entity_id: string; name: string; ok: boolean; message: string; contact_id?: string }[] = []
      for (const row of (rows || []) as any[]) {
        const entity = row.entity
        const legacyId = `distribution:${row.entity_id}`
        try {
          let contactId: string | null = null
          const existing = await admin.from('contacts').select('id').eq('user_id', owner).eq('legacy_id', legacyId).maybeSingle()
          if (existing.error) throw existing.error
          contactId = existing.data?.id || null
          if (!contactId) {
            const guides = (row.guide_slugs as string[]).map(guideLabel).join(', ')
            const person = best.get(row.entity_id)
            const lead = await createLeadFromInput(admin, owner, {
              name: person?.full_name || entity.name, company: entity.name, email: person?.email || entity.email, phone: entity.phone,
              country: entity.country_code, category: 'Partner distribuzione', source: 'tourism_distribution',
              note: `Speaqi Guides — Distribution Opportunities.${person ? ` Referente: ${person.full_name}${person.job_title ? `, ${person.job_title}` : ''}.` : ''} Punteggio ${row.score}/100 (Tier ${row.tier}). Guide pertinenti: ${guides || 'da definire'}. Modello consigliato: ${MODEL_LABELS[row.model as CommercialModel]}.${entity.website ? ` Sito: ${entity.website}.` : ''}`,
              task_note: 'Primo contatto: proporre come distribuire le guide e un pilota',
            }, {
              legacyId, isPartner: true,
              activity: { content: `Arrivato da Tourism Intelligence (Distribution Opportunities), Tier ${row.tier}.`,
                metadata: { event: 'lead_created', source: 'tourism_distribution', entity_id: row.entity_id } },
            })
            contactId = lead.lead.id
          }
          const deal = await admin.from('deals').insert({
            user_id: owner, contact_id: contactId, pipeline: 'distribuzione', role: 'distributore', stage: 'qualificata',
            title: `Distribuzione · ${entity.name}`, entity_id: row.entity_id,
            next_step: 'Proporre come distribuire le guide e un pilota',
            next_step_due: new Date(Date.now() + 2 * 86400_000).toISOString(),
            evidence: [{ kind: 'tourism_distribution', text: `Tier ${row.tier}, punteggio ${row.score}/100; modello consigliato: ${MODEL_LABELS[row.model as CommercialModel]}.` }],
          })
          if (deal.error && (deal.error as { code?: string }).code !== '23505') throw deal.error
          await auth.supabase
            .from('tourism_distribution')
            .update({ commercial_status: row.commercial_status === 'new' ? 'qualified' : row.commercial_status, updated_at: new Date().toISOString() })
            .eq('user_id', owner)
            .eq('entity_id', row.entity_id)
          results.push({ entity_id: row.entity_id, name: entity.name, ok: true, contact_id: contactId!,
            message: deal.error ? 'Era già in pipeline Distribuzione' : 'Contatto e opportunità creati' })
        } catch (e) {
          results.push({ entity_id: row.entity_id, name: entity.name, ok: false, message: (e as Error).message || 'Non riuscito' })
        }
      }
      return tourismResponse({ results })
    }
    return tourismResponse({ error: 'Azione non valida' }, 400)
  } catch (error) {
    return tourismError(error)
  }
}
