import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { loadMapsStatus, speaqiMapUrl } from '@/lib/server/maps-status'
import { clientHeadline, findMapRow, isQuotePaid, MAP_STAGE_LABEL } from '@/lib/command-center'

/**
 * GET: la scheda completa di un cliente, tutto in una risposta. Contatto,
 * trattative, preventivi con firma, fatture con stato SDI, abbonamento,
 * proposte Agency, presentazioni Tourism, mappe (collegate a mano o tramite
 * l'ente di Tourism Intelligence), attivita' da fare, ultimi movimenti.
 *
 * Ogni sezione che non si legge resta vuota: la scheda non cade per un modulo.
 */

const MAP_RELATIONS = ['COVERS', 'MANAGES', 'PROMOTES']

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const { admin, userId } = auth
  const { id } = await params

  try {
    const contactRes = await admin.from('contacts').select('*').eq('user_id', userId).eq('id', id).maybeSingle()
    if (contactRes.error) throw contactRes.error
    if (!contactRes.data) return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    const contact = contactRes.data

    const [dealsRes, quotesRes, projectsRes, tasksRes, activitiesRes, emailsRes, linksRes, tourismLinkRes, maps] = await Promise.all([
      admin.from('deals').select('id, title, counterparty, stage, value, outcome, quote_id, closed_at, created_at').eq('user_id', userId).eq('contact_id', id).order('created_at', { ascending: false }),
      admin
        .from('quotes')
        .select('id, quote_number, title, status, payment_state, total_amount, paid_at, sent_at, accepted_at, created_at, billing_interval, subscription_status, current_period_end, cancel_at_period_end, public_token')
        .eq('user_id', userId)
        .eq('contact_id', id)
        .order('created_at', { ascending: false }),
      admin.from('agency_projects').select('id, title, stage, created_at').eq('user_id', userId).eq('contact_id', id).order('created_at', { ascending: false }),
      admin.from('tasks').select('id, type, due_date, priority, note, status').eq('user_id', userId).eq('contact_id', id).eq('status', 'pending').order('due_date', { ascending: true }).limit(10),
      admin.from('activities').select('id, type, content, created_at').eq('user_id', userId).eq('contact_id', id).order('created_at', { ascending: false }).limit(12),
      admin.from('gmail_messages').select('id, direction, subject, snippet, from_email, sent_at').eq('user_id', userId).eq('contact_id', id).order('sent_at', { ascending: false }).limit(6),
      admin.from('contact_map_links').select('id, map_ref, role, note, created_at').eq('user_id', userId).eq('contact_id', id),
      admin.from('tourism_crm_links').select('entity_id, entity:tourism_entities(id, name, kind)').eq('user_id', userId).eq('contact_id', id),
      loadMapsStatus(),
    ])

    const quotes = quotesRes.data || []
    const quoteIds = quotes.map((q: any) => q.id)
    const projectIds = (projectsRes.data || []).map((p: any) => p.id)
    const entities = (tourismLinkRes.data || []).map((l: any) => l.entity).filter(Boolean)
    const entityIds = entities.map((e: any) => e.id)

    const [signaturesRes, invoicesRes, presentationsRes, decksRes, relationsRes] = await Promise.all([
      quoteIds.length ? admin.from('quote_signatures').select('quote_id, signer_name, channel, signed_at').eq('user_id', userId).in('quote_id', quoteIds) : Promise.resolve({ data: [] as any[] }),
      admin
        .from('invoices')
        .select('id, quote_id, source, status, numero, issue_date, totale, sdi_status, sdi_detail, last_error, sent_at, aruba_env')
        .eq('user_id', userId)
        .or(quoteIds.length ? `contact_id.eq.${id},quote_id.in.(${quoteIds.join(',')})` : `contact_id.eq.${id}`)
        .order('created_at', { ascending: false }),
      projectIds.length ? admin.from('agency_presentations').select('id, project_id, title, status, public_token, approved_at, updated_at').eq('user_id', userId).in('project_id', projectIds) : Promise.resolve({ data: [] as any[] }),
      entityIds.length ? admin.from('tourism_decks').select('id, title, destination, status, public_token, updated_at').eq('user_id', userId).in('entity_id', entityIds) : Promise.resolve({ data: [] as any[] }),
      entityIds.length ? admin.from('tourism_relations').select('to_id, relation').eq('user_id', userId).in('from_id', entityIds).in('relation', MAP_RELATIONS) : Promise.resolve({ data: [] as any[] }),
    ])

    // Mappe: un ente che e' esso stesso un luogo, o un luogo che l'ente copre/gestisce/promuove.
    const placeIds = new Set<string>([...entities.filter((e: any) => e.kind === 'place').map((e: any) => e.id), ...(relationsRes.data || []).map((r: any) => r.to_id)])
    const destinationsRes = placeIds.size
      ? await admin.from('tourism_destinations').select('entity_id, speaqi_map_slug, guide_status, entity:tourism_entities(name)').eq('user_id', userId).in('entity_id', Array.from(placeIds))
      : { data: [] as any[] }

    const mapEntries: Array<Record<string, unknown>> = []
    const seen = new Set<string>()
    const pushMap = (ref: string, origin: 'manual' | 'tourism', extra: Record<string, unknown>) => {
      const row = findMapRow(maps.rows, ref)
      const key = row?.key || `ref:${ref}`
      if (seen.has(key)) return
      seen.add(key)
      mapEntries.push({
        ref,
        origin,
        name: row?.name || ref,
        stage: row?.stage || null,
        stage_label: row ? MAP_STAGE_LABEL[row.stage] : 'Non trovata in StudioMap ne’ su Speaqi',
        places: row?.places ?? null,
        url: speaqiMapUrl(row?.speaqi_slug || null),
        ...extra,
      })
    }
    for (const link of linksRes.data || []) pushMap(link.map_ref, 'manual', { link_id: link.id, role: link.role, note: link.note })
    for (const dest of destinationsRes.data || []) {
      const ref = dest.speaqi_map_slug || (dest as any).entity?.name
      if (ref) pushMap(ref, 'tourism', { destination: (dest as any).entity?.name || null, guide_status: dest.guide_status })
    }

    const signatures = new Map((signaturesRes.data || []).map((s: any) => [s.quote_id, s]))
    const openDeal = (dealsRes.data || []).find((d: any) => !d.closed_at) || null
    const subscription = quotes.find((q: any) => q.billing_interval === 'year' && isQuotePaid(q)) || null

    return Response.json({
      contact,
      headline: clientHeadline({ status: contact.status, openDeal, quotes, signedQuoteIds: signatures.size }),
      deals: dealsRes.data || [],
      quotes: quotes.map((q: any) => ({ ...q, total_amount: Number(q.total_amount) || 0, signature: signatures.get(q.id) || null })),
      subscription: subscription
        ? {
            quote_id: subscription.id,
            status: subscription.subscription_status,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
            amount: Number(subscription.total_amount) || 0,
          }
        : null,
      invoices: (invoicesRes.data || []).map((inv: any) => ({ ...inv, totale: Number(inv.totale) || 0 })),
      agency: (projectsRes.data || []).map((p: any) => ({ ...p, presentations: (presentationsRes.data || []).filter((pr: any) => pr.project_id === p.id) })),
      tourism: { entities, decks: decksRes.data || [] },
      maps: mapEntries,
      maps_sources: maps.sources,
      tasks: tasksRes.data || [],
      activities: activitiesRes.data || [],
      emails: emailsRes.data || [],
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare la scheda') }, { status: 500 })
  }
}
