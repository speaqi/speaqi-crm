import { officeRows } from './office-read'
import { selectByIdChunks } from './http'
import { loadMapsStatus, type MapsStatus } from './maps-status'
import { findMapRow } from '../command-center'
import { buildDirectorPlan, type PlanContact, type PlanInput, type PlanQuote } from '../office/director-plan'
import { nextStepOf, stuckReason, type Opportunity } from '../opportunities'

/**
 * Lettura del percorso unico: trattative aperte con contatto, preventivi, ente
 * e stato della guida collegata. Una query per tabella, mai una per riga:
 * le trattative aperte sono più di mille.
 */
type Admin = any
const CONTACT_COLUMNS = 'id,name,company,email,score,priority,email_open_count,email_click_count,next_followup_at,next_action_at,responsible,status'

export async function loadOpenOpportunities(admin: Admin, userId: string, options: { maps?: () => Promise<MapsStatus> } = {}): Promise<PlanInput[]> {
  const deals = await officeRows<Opportunity>(admin, userId, 'deals', '*', (q) => q.is('closed_at', null))
  const contactIds = [...new Set(deals.map((d) => d.contact_id))]
  const entityIds = [...new Set(deals.map((d) => d.entity_id).filter((id): id is string => !!id))]
  const [contacts, quotes, entities] = await Promise.all([
    selectByIdChunks<PlanContact>(contactIds, 200, (ids, range) =>
      admin.from('contacts').select(CONTACT_COLUMNS).eq('user_id', userId).in('id', ids).order('id').range(range.from, range.to)),
    selectByIdChunks<PlanQuote>(contactIds, 200, (ids, range) =>
      admin.from('quotes').select('id,contact_id,status,total_amount,sent_at').eq('user_id', userId).in('contact_id', ids).order('id').range(range.from, range.to)),
    selectByIdChunks<{ id: string; name: string }>(entityIds, 200, (ids, range) =>
      admin.from('tourism_entities').select('id,name').eq('user_id', userId).in('id', ids).order('id').range(range.from, range.to)),
  ])
  // Lo stato delle guide si legge solo se qualche opportunità ne nomina una.
  const maps = deals.some((d) => d.map_ref) ? await (options.maps || loadMapsStatus)().catch(() => null) : null
  const contactById = new Map(contacts.map((c) => [c.id, c]))
  const entityById = new Map(entities.map((e) => [e.id, e.name]))
  const quotesByContact = new Map<string, PlanQuote[]>()
  for (const quote of quotes) if (quote.contact_id) quotesByContact.set(quote.contact_id, [...(quotesByContact.get(quote.contact_id) || []), quote])
  return deals.map((deal) => ({
    deal: { ...deal, pipeline: deal.pipeline || 'vendite' },
    contact: contactById.get(deal.contact_id) || null,
    quotes: quotesByContact.get(deal.contact_id) || [],
    entityName: deal.entity_id ? entityById.get(deal.entity_id) || null : null,
    mapStage: deal.map_ref ? (maps ? findMapRow(maps.rows, deal.map_ref)?.stage || null : null) : undefined,
  }))
}

export async function loadDirectorPlan(admin: Admin, userId: string, now = new Date(), options: { maps?: () => Promise<MapsStatus> } = {}) {
  return buildDirectorPlan(await loadOpenOpportunities(admin, userId, options), now)
}

export type OpportunityRow = Opportunity & {
  contact: PlanContact | null; entity_name: string | null; map_stage: string | null | undefined
  next: { text: string | null; due: string | null; inherited: boolean }; stuck: string | null
}

/** L'elenco della pagina /opportunita, filtrato sul server. */
export function filterOpportunities(inputs: PlanInput[], filters: { pipeline?: string | null; owner?: string | null; view?: string | null; q?: string | null }, now = new Date()): OpportunityRow[] {
  const needle = (filters.q || '').trim().toLowerCase()
  return inputs.map((input) => {
    const next = nextStepOf(input.deal, input.contact)
    return { ...input.deal, contact: input.contact, entity_name: input.entityName || null, map_stage: input.mapStage, next, stuck: stuckReason(input.deal, next, now) }
  }).filter((row) => {
    if (filters.pipeline && row.pipeline !== filters.pipeline) return false
    if (filters.owner === 'none' ? !!row.owner : filters.owner && row.owner !== filters.owner) return false
    if (filters.view === 'stuck' && !row.stuck) return false
    if (filters.view === 'overdue' && !(row.next.due && Date.parse(row.next.due) < now.getTime())) return false
    if (filters.view === 'to_activate' && !(row.signed_at && !row.activated_at)) return false
    if (needle && ![row.title, row.contact?.name, row.contact?.company, row.contact?.email, row.entity_name, row.map_ref]
      .some((value) => String(value || '').toLowerCase().includes(needle))) return false
    return true
  }).sort((a, b) => {
    const da = a.next.due ? Date.parse(a.next.due) : Infinity
    const db = b.next.due ? Date.parse(b.next.due) : Infinity
    return (b.stuck ? 1 : 0) - (a.stuck ? 1 : 0) || da - db || b.updated_at.localeCompare(a.updated_at)
  })
}
