/**
 * Il percorso unico delle opportunità: deals esteso con pipeline, ruolo,
 * organizzazione, guida, responsabile e prossimo passo. Puro e testato.
 *
 * La pipeline 'vendite' è quella di sempre: la fase segue contacts.status e qui
 * non si cambia. Le altre hanno fasi proprie e non toccano lo stato del contatto.
 */

export const OPPORTUNITY_PIPELINES = ['vendite', 'tourism', 'distribuzione', 'agency'] as const
export type OpportunityPipeline = (typeof OPPORTUNITY_PIPELINES)[number]
export const PIPELINE_LABELS: Record<OpportunityPipeline, string> = {
  vendite: 'Vendite', tourism: 'Tourism', distribuzione: 'Distribuzione', agency: 'Agency',
}

export const OPPORTUNITY_ROLES = ['destinazione', 'distributore', 'cliente_agenzia', 'cliente_mappe'] as const
export type OpportunityRole = (typeof OPPORTUNITY_ROLES)[number]
export const ROLE_LABELS: Record<OpportunityRole, string> = {
  destinazione: 'Destinazione', distributore: 'Distributore', cliente_agenzia: 'Cliente agenzia', cliente_mappe: 'Cliente mappe',
}
export const DEFAULT_ROLE: Record<OpportunityPipeline, OpportunityRole | null> = {
  vendite: null, tourism: 'destinazione', distribuzione: 'distributore', agency: 'cliente_agenzia',
}

/** Fasi delle pipeline nuove. «Firmato» e «attiva» sono due fatti diversi. */
export const OPPORTUNITY_STAGES = ['scoperta', 'qualificata', 'proposta', 'trattativa', 'firmato', 'attivazione', 'attiva', 'persa', 'ferma'] as const
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]
export const STAGE_LABELS: Record<OpportunityStage, string> = {
  scoperta: 'Scoperta', qualificata: 'Qualificata', proposta: 'Proposta', trattativa: 'Trattativa', firmato: 'Accordo firmato',
  attivazione: 'In attivazione', attiva: 'Attiva', persa: 'Persa', ferma: 'Ferma',
}

export type Opportunity = {
  id: string; user_id: string; contact_id: string; title: string; counterparty?: string | null
  stage: string; value?: number | null; quote_id?: string | null; closed_at?: string | null; outcome?: string | null
  created_at: string; updated_at: string
  pipeline: OpportunityPipeline; entity_id?: string | null; role?: OpportunityRole | null; map_ref?: string | null
  agency_project_id?: string | null; owner?: string | null; next_step?: string | null; next_step_due?: string | null
  evidence?: OpportunityEvidence[] | null; potential_value?: number | null; potential_value_source?: string | null
  stage_changed_at?: string | null; signed_at?: string | null; activated_at?: string | null
}
export type OpportunityEvidence = { kind: string; text: string; source_url?: string | null; at?: string | null }

/** Agenti che possono essere responsabili di un'opportunità. */
export const AGENT_OWNERS = ['agent:sales_followup', 'agent:presentations', 'agent:agency', 'agent:distribution'] as const
export const OWNER_LABELS: Record<string, string> = {
  'agent:sales_followup': 'Agente Commerciale', 'agent:presentations': 'Agente Presentazioni',
  'agent:agency': 'Agente Agenzia', 'agent:distribution': 'Agente Distribuzione',
}
export const ownerLabel = (owner: string | null | undefined) => !owner ? 'Da assegnare' : OWNER_LABELS[owner] || owner

const text = (value: unknown, max: number) => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const clean = value.trim().replace(/\s+/g, ' ')
  if (!clean) return null
  if (clean.length > max) throw new Error(`Testo troppo lungo (massimo ${max} caratteri)`)
  return clean
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

export function normalizeOwner(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  const owner = text(value, 120)
  if (owner === undefined) throw new Error('Responsabile non valido')
  if (owner && owner.startsWith('agent:') && !(AGENT_OWNERS as readonly string[]).includes(owner)) throw new Error('Agente responsabile sconosciuto')
  return owner
}

function normalizeEvidence(value: unknown): OpportunityEvidence[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Le prove devono essere una lista (al massimo 50)')
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const body = text(row.text, 500)
    if (!body) throw new Error('Ogni prova deve avere un testo')
    const url = text(row.source_url, 500)
    if (url && !/^https:\/\//.test(url)) throw new Error('La fonte di una prova deve essere un link https')
    return { kind: text(row.kind, 40) || 'nota', text: body, source_url: url || null, at: text(row.at, 40) || null }
  })
}

const STAGE_SET = new Set<string>(OPPORTUNITY_STAGES)

/**
 * Le modifiche ammesse. Per la pipeline vendite la fase non si tocca qui:
 * segue lo stato del contatto, come in tutto il resto del CRM.
 */
export function opportunityPatch(raw: unknown, current: Pick<Opportunity, 'pipeline' | 'stage' | 'signed_at' | 'activated_at'>, now = new Date()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Modifica non valida')
  const input = raw as Record<string, unknown>
  const allowed = new Set(['title', 'role', 'entity_id', 'map_ref', 'owner', 'next_step', 'next_step_due', 'evidence', 'potential_value', 'potential_value_source', 'stage', 'lost_reason'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Campo non modificabile: ${key}`)
  const patch: Record<string, unknown> = {}
  if ('title' in input) { const title = text(input.title, 160); if (!title) throw new Error('Il titolo non può essere vuoto'); patch.title = title }
  if ('role' in input) {
    if (input.role !== null && !(OPPORTUNITY_ROLES as readonly unknown[]).includes(input.role)) throw new Error('Ruolo non valido')
    patch.role = input.role
  }
  if ('entity_id' in input) { if (input.entity_id !== null && !isUuid(input.entity_id)) throw new Error('Ente non valido'); patch.entity_id = input.entity_id }
  if ('map_ref' in input) { const map = text(input.map_ref, 120); if (map === undefined) throw new Error('Guida non valida'); patch.map_ref = map }
  if ('owner' in input) patch.owner = normalizeOwner(input.owner)
  if ('next_step' in input) { const step = text(input.next_step, 300); if (step === undefined) throw new Error('Prossimo passo non valido'); patch.next_step = step }
  if ('next_step_due' in input) {
    if (input.next_step_due === null || input.next_step_due === '') patch.next_step_due = null
    else if (typeof input.next_step_due !== 'string' || Number.isNaN(Date.parse(input.next_step_due))) throw new Error('Scadenza non valida')
    else patch.next_step_due = new Date(input.next_step_due).toISOString()
  }
  if ('evidence' in input) patch.evidence = normalizeEvidence(input.evidence)
  if ('potential_value' in input) {
    const value = input.potential_value === null || input.potential_value === '' ? null : Number(input.potential_value)
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 10_000_000)) throw new Error('Valore potenziale non valido')
    patch.potential_value = value === null ? null : Math.round(value * 100) / 100
  }
  if ('potential_value_source' in input) patch.potential_value_source = text(input.potential_value_source, 200) ?? null
  if ('lost_reason' in input) patch.lost_reason = text(input.lost_reason, 300) ?? null
  if ('stage' in input) {
    if (current.pipeline === 'vendite') throw new Error('Nella pipeline Vendite la fase segue lo stato del contatto: cambiala dalla scheda')
    if (typeof input.stage !== 'string' || !STAGE_SET.has(input.stage)) throw new Error('Fase non valida')
    const stage = input.stage as OpportunityStage
    patch.stage = stage
    const iso = now.toISOString()
    if ((stage === 'firmato' || stage === 'attivazione' || stage === 'attiva') && !current.signed_at) patch.signed_at = iso
    if (stage === 'attiva' && !current.activated_at) patch.activated_at = iso
    // Tornare indietro da attiva toglie l'attivazione, non la firma.
    if (stage !== 'attiva' && current.activated_at && stage !== 'persa') patch.activated_at = null
    // Riportata prima della firma: l'accordo non c'era, e nemmeno l'attivazione (vincolo sul database).
    if (['scoperta', 'qualificata', 'proposta', 'trattativa'].includes(stage) && current.signed_at) { patch.signed_at = null; patch.activated_at = null }
    if (stage === 'persa') { patch.closed_at = iso; patch.outcome = 'lost' }
    else patch.closed_at = null
  }
  if (!Object.keys(patch).length) throw new Error('Nessuna modifica')
  return patch
}

export function newOpportunityRow(raw: unknown, userId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Opportunità non valida')
  const input = raw as Record<string, unknown>
  if (!isUuid(input.contact_id)) throw new Error('Scegli il contatto')
  const pipeline = input.pipeline as OpportunityPipeline
  if (!(OPPORTUNITY_PIPELINES as readonly unknown[]).includes(pipeline) || pipeline === 'vendite') {
    throw new Error('Scegli fra Tourism, Distribuzione e Agency: le trattative di vendita nascono dal contatto')
  }
  const stage = input.stage === undefined ? 'qualificata' : input.stage
  if (typeof stage !== 'string' || !STAGE_SET.has(stage) || stage === 'persa') throw new Error('Fase iniziale non valida')
  const fields = ['title', 'role', 'entity_id', 'map_ref', 'owner', 'next_step', 'next_step_due', 'evidence', 'potential_value', 'potential_value_source']
  const picked: Record<string, unknown> = { stage }
  for (const key of fields) if (key in input) picked[key] = input[key]
  const rest = opportunityPatch(picked, { pipeline, stage: 'scoperta', signed_at: null, activated_at: null })
  return {
    ...rest, user_id: userId, contact_id: input.contact_id, pipeline,
    title: (rest.title as string | undefined) || `Opportunità ${PIPELINE_LABELS[pipeline]}`,
    role: rest.role === undefined ? DEFAULT_ROLE[pipeline] : rest.role, closed_at: null,
  }
}

const DAY = 86400_000
/** Fasi in cui una trattativa ferma va sbloccata: lì un silenzio costa. */
const ACTIVE_STAGES = new Set(['qualificata', 'proposta', 'trattativa', 'firmato', 'attivazione', 'Interested', 'Call booked', 'Quote', 'Waiting', 'Contacted'])
export const STALE_DAYS = 14

export type NextStep = { text: string | null; due: string | null; inherited: boolean }
/** Il prossimo passo: quello dell'opportunità, altrimenti il follow-up del contatto (pipeline vendite). */
export function nextStepOf(deal: Pick<Opportunity, 'next_step' | 'next_step_due' | 'pipeline'>, contact?: { next_followup_at?: string | null; next_action_at?: string | null } | null): NextStep {
  if (deal.next_step || deal.next_step_due) return { text: deal.next_step || null, due: deal.next_step_due || null, inherited: false }
  if (deal.pipeline === 'vendite' && contact) {
    const due = contact.next_followup_at || contact.next_action_at || null
    if (due) return { text: 'Follow-up dal CRM', due, inherited: true }
  }
  return { text: null, due: null, inherited: false }
}

/** Perché un'opportunità è ferma, oppure null. */
export function stuckReason(deal: Opportunity, step: NextStep, now: Date): string | null {
  if (deal.closed_at) return null
  if (!step.text && !step.due) return 'Nessun prossimo passo'
  if (step.due && Date.parse(step.due) < now.getTime() - 3 * DAY) {
    return `Prossimo passo scaduto da ${Math.floor((now.getTime() - Date.parse(step.due)) / DAY)} giorni`
  }
  const since = deal.stage_changed_at || deal.updated_at || deal.created_at
  if (ACTIVE_STAGES.has(deal.stage) && Date.parse(since) < now.getTime() - STALE_DAYS * DAY) {
    return `Ferma in «${STAGE_LABELS[deal.stage as OpportunityStage] || deal.stage}» da ${Math.floor((now.getTime() - Date.parse(since)) / DAY)} giorni`
  }
  return null
}

/**
 * Da tipo di ente di Tourism Intelligence a opportunità. Gli enti del turismo
 * comprano la mappa della destinazione (pipeline `tourism`); chi vende viaggi,
 * soggiorni o trasporti può distribuire le guide (`distribuzione`). Gli altri
 * tipi (tecnologia, fondazioni, "altro") non aprono niente da soli.
 */
const TOURISM_DESTINATION_TYPES = new Set([
  'nto', 'ministry', 'dmo', 'cvb', 'rto', 'local_office', 'municipality', 'development_authority', 'park', 'consortium', 'association',
])
const TOURISM_DISTRIBUTOR_TYPES = new Set([
  'dmc', 'tour_operator', 'travel_agency', 'ota', 'cruise_line', 'ferry_operator', 'transport',
  'accommodation', 'property_manager', 'tourism_supplier', 'attraction',
])

export type TourismOpportunityPlan = { pipeline: 'tourism' | 'distribuzione'; role: OpportunityRole; next_step: string; label: string }

export function tourismOpportunityPlan(typeCode: string | null | undefined): TourismOpportunityPlan | null {
  const code = String(typeCode || '').trim().toLowerCase()
  if (TOURISM_DESTINATION_TYPES.has(code)) {
    return { pipeline: 'tourism', role: 'destinazione', next_step: 'Preparare e mandare la presentazione', label: 'Tourism' }
  }
  if (TOURISM_DISTRIBUTOR_TYPES.has(code)) {
    return { pipeline: 'distribuzione', role: 'distributore', next_step: 'Proporre come distribuire le guide e un pilota', label: 'Distribuzione' }
  }
  return null
}
