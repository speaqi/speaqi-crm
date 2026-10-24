import { formatEuroPlain } from '../command-center'
import {
  OWNER_LABELS, PIPELINE_LABELS, STAGE_LABELS, nextStepOf, stuckReason,
  type Opportunity, type OpportunityStage,
} from '../opportunities'

/**
 * Il piano del giorno del Direttore: quali opportunità lavorare, quali
 * sbloccare, quali partner attivare. Tutto deterministico, nessun modello:
 * il punteggio pesa evidenze, valore, tempi e lavoro necessario, e ogni voce
 * dice perché è lì.
 */

export type PlanContact = {
  id: string; name: string; company?: string | null; email?: string | null; score?: number | null; priority?: number | null
  email_open_count?: number | null; email_click_count?: number | null
  next_followup_at?: string | null; next_action_at?: string | null; responsible?: string | null
}
export type PlanQuote = { contact_id: string | null; status: string; total_amount: number | null; sent_at?: string | null }
export type PlanInput = {
  deal: Opportunity; contact: PlanContact | null; quotes: PlanQuote[]
  /** Stato della guida collegata (map_ref), quando c'è: online, su_speaqi, pronta, in_lavorazione, oppure null se non trovata. */
  mapStage?: string | null; entityName?: string | null
}
export type PlanItem = {
  deal_id: string; contact_id: string; name: string; organization: string | null; pipeline: string; stage: string
  score: number; value: number | null; value_source: string; owner: string; next_step: string; due: string | null
  reasons: string[]; missing: string[]; stuck: string | null; map_ref: string | null
}
export type DirectorPlan = { work: PlanItem[]; unblock: PlanItem[]; activate: PlanItem[]; maps: PlanItem[]; open: number; stuck: number }

const DAY = 86400_000
export const PLAN_LIST_SIZE = 5

function valueOf(input: PlanInput): { value: number | null; source: string } {
  const quotes = input.quotes.filter((q) => q.status !== 'cancelled' && q.status !== 'draft')
  const quote = Math.max(0, ...quotes.map((q) => Number(q.total_amount) || 0))
  if (input.deal.value) return { value: Number(input.deal.value), source: 'valore della trattativa' }
  if (quote > 0) return { value: quote, source: 'preventivo' }
  if (input.deal.potential_value) return { value: Number(input.deal.potential_value), source: input.deal.potential_value_source || 'stima' }
  return { value: null, source: 'non stimato' }
}

/** Il lavoro che manca prima del prossimo passo: più ne manca, più costa. */
function missingWork(input: PlanInput): string[] {
  const { deal, contact } = input
  const missing: string[] = []
  if (!contact?.email) missing.push('email del contatto')
  if (deal.pipeline === 'tourism' && !deal.entity_id) missing.push('ente nel catalogo Tourism')
  if (deal.map_ref && input.mapStage !== 'online') missing.push(`guida «${deal.map_ref}» da preparare`)
  if ((deal.stage === 'proposta' || deal.stage === 'trattativa') && !input.quotes.some((q) => q.status !== 'cancelled')) missing.push('preventivo')
  return missing
}

export function scoreOpportunity(input: PlanInput, now: Date) {
  const { deal, contact } = input
  const reasons: string[] = []
  const evidence = Array.isArray(deal.evidence) ? deal.evidence.length : 0
  let proof = evidence * 2
  if (evidence) reasons.push(`${evidence} ${evidence === 1 ? 'prova' : 'prove'} raccolte`)
  const leadScore = Number(contact?.score) || 0
  if (leadScore >= 60) { proof += leadScore / 25; reasons.push(`punteggio lead ${leadScore}`) }
  const clicks = Math.min(5, Number(contact?.email_click_count) || 0)
  const opens = Math.min(5, Number(contact?.email_open_count) || 0)
  if (clicks) { proof += clicks * 0.5; reasons.push(`${clicks} clic sulle email`) } else if (opens) proof += opens * 0.2
  const priority = Number(contact?.priority) || 0
  if (priority >= 2) { proof += priority; reasons.push(priority === 3 ? 'contatto in cima (supertop)' : 'priorità alta') }

  const { value, source } = valueOf(input)
  const valueWeight = value ? Math.log10(value + 10) : 1

  let urgency = 1
  const step = nextStepOf(deal, contact)
  if (step.due) {
    const due = Date.parse(step.due)
    if (due < now.getTime()) { urgency += 1.5; reasons.push('prossimo passo già scaduto') }
    else if (due < now.getTime() + 2 * DAY) { urgency += 1; reasons.push('prossimo passo entro due giorni') }
  }
  if (deal.stage === 'Call booked') { urgency += 1.5; reasons.push('chiamata fissata') }
  if (['Quote', 'proposta', 'trattativa'].includes(deal.stage)) { urgency += 1; reasons.push('proposta sul tavolo') }
  if (input.quotes.some((q) => q.status === 'sent')) { urgency += 1; reasons.push('preventivo in attesa di risposta') }
  if (deal.signed_at && !deal.activated_at) { urgency += 2; reasons.push('accordo firmato, partner non ancora attivo') }

  const missing = missingWork(input)
  const effort = 1 + missing.length * 0.5
  const score = Math.round(((1 + proof) * valueWeight * urgency / effort) * 100) / 100
  return { score, reasons, missing, value, valueSource: source, step }
}

function item(input: PlanInput, now: Date): PlanItem {
  const scored = scoreOpportunity(input, now)
  const { deal, contact } = input
  return {
    deal_id: deal.id, contact_id: deal.contact_id, name: contact?.name || deal.title,
    organization: input.entityName || contact?.company || deal.counterparty || null,
    pipeline: deal.pipeline || 'vendite', stage: deal.stage, score: scored.score, value: scored.value, value_source: scored.valueSource,
    owner: deal.owner ? OWNER_LABELS[deal.owner] || deal.owner : contact?.responsible || 'Da assegnare',
    next_step: scored.step.text || 'Da decidere', due: scored.step.due, reasons: scored.reasons, missing: scored.missing,
    stuck: stuckReason(deal, scored.step, now), map_ref: deal.map_ref || null,
  }
}

const byScore = (a: PlanItem, b: PlanItem) => b.score - a.score || (b.value || 0) - (a.value || 0) || a.deal_id.localeCompare(b.deal_id)

export function buildDirectorPlan(inputs: PlanInput[], now: Date, size = PLAN_LIST_SIZE): DirectorPlan {
  const open = inputs.filter((input) => !input.deal.closed_at)
  const items = open.map((input) => item(input, now))
  const activateIds = new Set(open.filter((input) => input.deal.signed_at && !input.deal.activated_at).map((input) => input.deal.id))
  const signedAt = new Map(open.map((input) => [input.deal.id, input.deal.signed_at || '']))
  const activate = items.filter((row) => activateIds.has(row.deal_id))
    .sort((a, b) => (signedAt.get(a.deal_id) || '').localeCompare(signedAt.get(b.deal_id) || ''))
  const rest = items.filter((row) => !activateIds.has(row.deal_id))
  const stuck = rest.filter((row) => row.stuck)
  // La guida entra nel piano solo quando serve a un'opportunità aperta.
  const maps = items.filter((row) => row.map_ref && row.missing.some((m) => m.startsWith('guida'))).sort(byScore)
  return {
    work: rest.filter((row) => !row.stuck).sort(byScore).slice(0, size),
    unblock: stuck.sort(byScore).slice(0, size),
    activate: activate.slice(0, size),
    maps: maps.slice(0, size),
    open: open.length, stuck: stuck.length,
  }
}

const euro = (value: number | null) => value ? formatEuroPlain(Math.round(value)) : null
const dueText = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' }) : null
function line(row: PlanItem) {
  const who = row.organization && row.organization !== row.name ? `${row.name} (${row.organization})` : row.name
  const stage = STAGE_LABELS[row.stage as OpportunityStage] || row.stage
  const value = euro(row.value)
  const head = `${who} · ${PIPELINE_LABELS[row.pipeline as keyof typeof PIPELINE_LABELS] || row.pipeline} · ${stage}${value ? ` · ${value}` : ''}`
  const step = `${row.next_step}${row.due ? ` (${dueText(row.due)})` : ''} — ${row.owner}`
  const why = [...row.reasons.slice(0, 2), ...(row.missing.length ? [`manca: ${row.missing.join(', ')}`] : [])].join('; ')
  return { head, step, why }
}

/** Il piano in righe: per il report, Telegram e la risposta allo stato. */
export function directorPlanLines(plan: DirectorPlan): string[] {
  const lines = [`Opportunità aperte: ${plan.open}, ferme: ${plan.stuck}.`]
  const section = (title: string, rows: PlanItem[], extra: (row: PlanItem) => string | null = () => null) => {
    if (!rows.length) return
    lines.push('', title)
    rows.forEach((row, index) => {
      const { head, step, why } = line(row)
      lines.push(`${index + 1}. ${head}`, `   → ${step}`)
      const more = extra(row)
      if (more) lines.push(`   ${more}`)
      else if (why) lines.push(`   perché: ${why}`)
    })
  }
  section('Da lavorare oggi', plan.work)
  section('Da sbloccare', plan.unblock, (row) => row.stuck)
  section('Partner da attivare', plan.activate, () => 'accordo firmato: verificare consegna e prime scansioni')
  section('Guide che servono a un’opportunità', plan.maps, (row) => row.missing.find((m) => m.startsWith('guida')) || null)
  if (!plan.work.length && !plan.unblock.length && !plan.activate.length) lines.push('', 'Niente da segnalare oggi.')
  return lines
}

/**
 * Una priorità mappe del lunedì diventa proposta solo se serve a
 * un'opportunità aperta: la guida è nominata (map_ref), oppure l'ente o la
 * destinazione dell'opportunità è la stessa città.
 */
export function mapPrioritySupported(priority: { city: string; map_slug: string | null; target_id: string }, inputs: PlanInput[]) {
  const key = (value: string | null | undefined) => (value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const city = key(priority.city)
  const slug = key(priority.map_slug)
  return inputs.some(({ deal, entityName }) => {
    if (deal.closed_at) return false
    if (deal.entity_id && deal.entity_id === priority.target_id) return true
    const ref = key(deal.map_ref)
    if (ref && (ref === city || (slug && ref === slug) || ref.startsWith(`${city} `) || ref.split(' ').includes(city))) return true
    const entity = key(entityName)
    return !!city && !!entity && entity.split(' ').includes(city)
  })
}
