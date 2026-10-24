import assert from 'node:assert/strict'
import { describe, mock, test } from 'node:test'
import { newOpportunityRow, nextStepOf, opportunityPatch, stuckReason, type Opportunity } from '../src/lib/opportunities'
import { buildDirectorPlan, directorPlanBrief, directorPlanLines, inPlay, mapPrioritySupported, scoreOpportunity, type PlanInput } from '../src/lib/office/director-plan'
import { filterOpportunities } from '../src/lib/server/opportunities'
import { selectSalesCandidates } from '../src/lib/office/sales-followup'
import { directorHandler } from '../src/lib/server/office-agents/director'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

const NOW = new Date('2026-10-24T08:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86400_000).toISOString()
const ahead = (days: number) => new Date(NOW.getTime() + days * 86400_000).toISOString()
const UUID = '11111111-1111-4111-8111-111111111111'

function deal(patch: Partial<Opportunity> = {}): Opportunity {
  return { id: `d-${Math.random().toString(36).slice(2, 8)}`, user_id: 'owner', contact_id: 'c1', title: 'Trattativa', stage: 'Interested',
    created_at: ago(5), updated_at: ago(1), stage_changed_at: ago(1), pipeline: 'vendite', closed_at: null, ...patch }
}
const input = (d: Opportunity, patch: Partial<PlanInput> = {}): PlanInput =>
  ({ deal: d, contact: { id: d.contact_id, name: `Contatto ${d.contact_id}`, email: 'x@example.it' }, quotes: [], ...patch })

describe('modifiche alle opportunità', () => {
  test('nelle vendite la fase segue il contatto, fuori si muove con le sue date', () => {
    assert.throws(() => opportunityPatch({ stage: 'proposta' }, { pipeline: 'vendite', stage: 'Interested' }), /segue lo stato del contatto/)
    const signed = opportunityPatch({ stage: 'firmato' }, { pipeline: 'distribuzione', stage: 'trattativa' }, NOW)
    assert.equal(signed.signed_at, NOW.toISOString()); assert.equal(signed.closed_at, null)
    const active = opportunityPatch({ stage: 'attiva' }, { pipeline: 'distribuzione', stage: 'firmato', signed_at: ago(10) }, NOW)
    assert.equal(active.activated_at, NOW.toISOString()); assert.equal(active.signed_at, undefined)
    const back = opportunityPatch({ stage: 'attivazione' }, { pipeline: 'distribuzione', stage: 'attiva', signed_at: ago(10), activated_at: ago(2) }, NOW)
    assert.equal(back.activated_at, null)
    const unsigned = opportunityPatch({ stage: 'trattativa' }, { pipeline: 'distribuzione', stage: 'firmato', signed_at: ago(3), activated_at: null }, NOW)
    assert.equal(unsigned.signed_at, null); assert.equal(unsigned.activated_at, null)
    assert.equal(opportunityPatch({ stage: 'ferma' }, { pipeline: 'distribuzione', stage: 'firmato', signed_at: ago(3) }, NOW).signed_at, undefined)
    const lost = opportunityPatch({ stage: 'persa', lost_reason: 'Budget' }, { pipeline: 'tourism', stage: 'proposta' }, NOW)
    assert.equal(lost.closed_at, NOW.toISOString()); assert.equal(lost.outcome, 'lost')
  })

  test('responsabile, prove e campi estranei', () => {
    assert.throws(() => opportunityPatch({ owner: 'agent:inventato' }, { pipeline: 'tourism', stage: 'qualificata' }), /sconosciuto/)
    assert.equal(opportunityPatch({ owner: 'agent:sales_followup' }, { pipeline: 'vendite', stage: 'New' }).owner, 'agent:sales_followup')
    assert.equal(opportunityPatch({ owner: '' }, { pipeline: 'vendite', stage: 'New' }).owner, null)
    assert.throws(() => opportunityPatch({ evidence: [{ text: 'Bando', source_url: 'http://x.it' }] }, { pipeline: 'tourism', stage: 'scoperta' }), /https/)
    assert.throws(() => opportunityPatch({ user_id: UUID }, { pipeline: 'tourism', stage: 'scoperta' }), /non modificabile/)
    assert.throws(() => opportunityPatch({}, { pipeline: 'tourism', stage: 'scoperta' }), /Nessuna modifica/)
  })

  test('una nuova opportunità nasce fuori dalle vendite, con ruolo e fase di partenza', () => {
    assert.throws(() => newOpportunityRow({ contact_id: UUID, pipeline: 'vendite' }, 'owner'), /Tourism, Distribuzione e Agency/)
    assert.throws(() => newOpportunityRow({ contact_id: 'x', pipeline: 'tourism' }, 'owner'), /contatto/)
    const row = newOpportunityRow({ contact_id: UUID, pipeline: 'distribuzione', next_step: 'Proporre il QR in camera', user_id: 'altro' }, 'owner')
    assert.equal(row.user_id, 'owner'); assert.equal(row.role, 'distributore'); assert.equal((row as Record<string, unknown>).stage, 'qualificata'); assert.equal(row.closed_at, null)
    assert.match(String(row.title), /Distribuzione/)
  })
})

describe('prossimo passo e blocchi', () => {
  test('le vendite ereditano il follow-up del contatto', () => {
    const step = nextStepOf(deal(), { next_followup_at: ahead(1) })
    assert.deepEqual(step, { text: 'Follow-up dal CRM', due: ahead(1), inherited: true })
    assert.equal(nextStepOf(deal({ pipeline: 'tourism' }), { next_followup_at: ahead(1) }).text, null)
  })
  test('ferma: senza passo, passo scaduto da più di tre giorni, fase immobile da due settimane', () => {
    assert.equal(stuckReason(deal(), { text: null, due: null, inherited: false }, NOW), 'Nessun prossimo passo')
    assert.match(String(stuckReason(deal(), { text: 'x', due: ago(5), inherited: false }, NOW)), /scaduto da 5 giorni/)
    assert.equal(stuckReason(deal(), { text: 'x', due: ago(1), inherited: false }, NOW), null)
    assert.match(String(stuckReason(deal({ stage: 'proposta', pipeline: 'tourism', stage_changed_at: ago(20) }), { text: 'x', due: ahead(1), inherited: false }, NOW)), /Proposta» da 20 giorni/)
  })
})

describe('il piano del giorno', () => {
  test('prove, valore e tempi contano; il lavoro che manca pesa', () => {
    const cold = scoreOpportunity(input(deal({ next_step: 'Chiamare', next_step_due: ahead(10) })), NOW)
    const hot = scoreOpportunity(input(deal({ stage: 'Call booked', next_step: 'Chiamare', next_step_due: ahead(1) }),
      { quotes: [{ contact_id: 'c1', status: 'sent', total_amount: 488 }] }), NOW)
    assert.ok(hot.score > cold.score * 3)
    assert.equal(hot.value, 488); assert.equal(hot.valueSource, 'preventivo')
    const noEmail = scoreOpportunity(input(deal({ stage: 'Call booked', next_step: 'x', next_step_due: ahead(1) }), { contact: { id: 'c1', name: 'X' } }), NOW)
    assert.ok(noEmail.missing.includes('email del contatto'))
    assert.ok(noEmail.score < hot.score)
  })

  test('tre liste distinte: firmati da attivare non finiscono fra le altre, le guide solo se servono', () => {
    const inputs = [
      input(deal({ id: 'work', stage: 'Quote', next_step: 'Richiamare', next_step_due: ahead(1) })),
      input(deal({ id: 'stuck', contact_id: 'c2' })),
      input(deal({ id: 'signed', contact_id: 'c3', pipeline: 'distribuzione', stage: 'firmato', signed_at: ago(3), next_step: 'Consegnare il kit', next_step_due: ahead(2) })),
      input(deal({ id: 'map', contact_id: 'c4', pipeline: 'tourism', stage: 'proposta', map_ref: 'marsiglia', next_step: 'Presentazione', next_step_due: ahead(2) }), { mapStage: 'in_lavorazione' }),
      input(deal({ id: 'closed', contact_id: 'c5', closed_at: ago(1) })),
    ]
    const plan = buildDirectorPlan(inputs, NOW)
    assert.equal(plan.open, 4)
    assert.deepEqual(plan.activate.map((r) => r.deal_id), ['signed'])
    assert.deepEqual(plan.unblock.map((r) => r.deal_id), ['stuck'])
    assert.ok(plan.work.some((r) => r.deal_id === 'work') && !plan.work.some((r) => r.deal_id === 'signed'))
    assert.deepEqual(plan.maps.map((r) => r.deal_id), ['map'])
    const lines = directorPlanLines(plan).join('\n')
    assert.match(lines, /Partner da attivare/); assert.match(lines, /guida «marsiglia» da preparare/)
  })

  test('le mappe diventano proposte solo se un’opportunità le chiede', () => {
    const p = { city: 'Marsiglia', map_slug: null, target_id: 'dest' }
    assert.equal(mapPrioritySupported(p, []), false)
    assert.equal(mapPrioritySupported(p, [input(deal({ map_ref: 'Marsiglia' }))]), true)
    assert.equal(mapPrioritySupported(p, [input(deal({ entity_id: 'dest' }))]), true)
    assert.equal(mapPrioritySupported(p, [input(deal({ pipeline: 'tourism' }), { entityName: 'Office de Tourisme Marsiglia' })]), true)
    assert.equal(mapPrioritySupported(p, [input(deal({ map_ref: 'Marsiglia', closed_at: ago(1) }))]), false)
  })

  test('filtri della pagina: pipeline, ferme, da attivare, ricerca', () => {
    const inputs = [input(deal({ id: 'a' })), input(deal({ id: 'b', contact_id: 'c2', pipeline: 'tourism', next_step: 'x', next_step_due: ahead(2) })),
      input(deal({ id: 'c', contact_id: 'c3', pipeline: 'distribuzione', stage: 'firmato', signed_at: ago(1), next_step: 'x', next_step_due: ahead(1) }))]
    assert.deepEqual(filterOpportunities(inputs, { pipeline: 'tourism' }, NOW).map((r) => r.id), ['b'])
    assert.deepEqual(filterOpportunities(inputs, { view: 'stuck' }, NOW).map((r) => r.id), ['a'])
    assert.deepEqual(filterOpportunities(inputs, { view: 'to_activate' }, NOW).map((r) => r.id), ['c'])
    assert.deepEqual(filterOpportunities(inputs, { q: 'contatto c2' }, NOW).map((r) => r.id), ['b'])
    assert.equal(filterOpportunities(inputs, {}, NOW)[0].id, 'a')
  })
})

test('un solo responsabile: il Commerciale non scrive a chi ha un’opportunità affidata ad altri', () => {
  const contact = (id: string) => ({ id, name: id, email: `${id}@example.it`, contact_scope: 'crm', status: 'Interested', priority: 0, created_at: ago(30), updated_at: ago(30), next_followup_at: ago(1) }) as any
  const base = { contacts: [contact('a'), contact('b'), contact('c')], quotes: [], tasks: [], messages: [], signatures: [], pendingContactIds: [] }
  const deals = [
    { id: 'da', contact_id: 'a', title: 'T', stage: 'Interested', created_at: ago(30), updated_at: ago(30), owner: 'Mario' },
    { id: 'db', contact_id: 'b', title: 'T', stage: 'Interested', created_at: ago(30), updated_at: ago(30), owner: 'agent:sales_followup' },
    { id: 'dc', contact_id: 'c', title: 'T', stage: 'Interested', created_at: ago(30), updated_at: ago(30), owner: null },
  ] as any
  const ids = new Set(selectSalesCandidates({ ...base, deals }, NOW).map((c) => c.contact.id))
  assert.equal(ids.has('a'), false); assert.equal(ids.has('b'), true); assert.equal(ids.has('c'), true)
})

test('Direttore: senza opportunità le mappe restano un investimento, senza proposte né spesa', async () => {
  const db = new FakeSupabase({ tourism_destinations: [{ entity_id: 'dest', user_id: 'owner', guide_status: 'planned', guide_priority: 1, intl_arrivals: 1000, arrivals_year: 2025, arrivals_source: 'https://ente.example.it/dati', arrivals_estimated: false }],
    tourism_entities: [{ id: 'dest', user_id: 'owner', name: 'Marsiglia', aliases: [] }], tourism_hubs: [], quotes: [], invoices: [], deals: [], office_agent_runs: [], office_agent_outputs: [] })
  const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.director, user_id: 'owner' } as any, runId: 'run', log() {},
    async reserve() { throw new Error('nessuna spesa attesa') }, async settle() {},
    async addOutput(output) { const row = { id: db.nextId('o'), user_id: 'owner', agent_id: 'director', output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id } }
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('nessuna chiamata attesa') })
  try {
    const result = await directorHandler(db, { now: () => NOW, maps: async () => ({ rows: [], sources: { studiomap: 'ok', speaqi: 'ok' }, fetched_at: NOW.toISOString() } as any),
      coverage: async () => ({ rows: [], warnings: [] }) })(ctx)
    assert.match(String(result?.summary), /0 proposte legate a opportunità, 1 come investimento/)
    assert.equal(db.tables.office_agent_outputs.filter((o) => o.kind === 'proposal').length, 0)
    const weekly = db.tables.office_agent_outputs.find((o) => o.title === 'Priorità della settimana')!
    assert.equal(weekly.body.investimento[0].citta, 'Marsiglia')
    assert.equal(fetch.mock.callCount(), 0)
  } finally { fetch.mock.restore() }
})

test('Direttore: il piano parte su Telegram una volta al giorno e un invio fallito non ferma la corsa', async () => {
  const make = () => new FakeSupabase({ tourism_destinations: [], tourism_entities: [], tourism_hubs: [], quotes: [], invoices: [], deals: [], office_agent_runs: [], office_agent_outputs: [] })
  const ctxFor = (db: FakeSupabase): AgentContext => ({ agent: { ...OFFICE_AGENT_DEFINITIONS.director, user_id: 'owner' } as any, runId: 'run', log() {},
    async reserve() { throw new Error('nessuna spesa attesa') }, async settle() {},
    async addOutput(output) { const row = { id: db.nextId('o'), user_id: 'owner', agent_id: 'director', output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id } })
  const options = { now: () => NOW, maps: async () => ({ rows: [], sources: { studiomap: 'ok', speaqi: 'ok' }, fetched_at: NOW.toISOString() } as any), coverage: async () => ({ rows: [], warnings: [] }) }
  const sent: string[] = []
  const db = make()
  const handler = directorHandler(db, { ...options, notify: async (text) => { sent.push(text); return { ok: true } } })
  let result = await handler(ctxFor(db))
  assert.match(String(result?.summary), /Inviato su Telegram/)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /^\*Piano di oggi — \d{2}\/\d{2}\/\d{4}\*/)
  assert.match(sent[0], /\/ufficio$/)
  result = await handler(ctxFor(db))
  assert.equal(sent.length, 1, 'rilanciare il Direttore non rimanda il piano')
  const other = make()
  result = await directorHandler(other, { ...options, notify: async () => ({ ok: false, error: 'Canale richiesto non disponibile' }) })(ctxFor(other))
  assert.match(String(result?.summary), /Telegram: Canale richiesto non disponibile/)
  assert.equal(other.tables.office_agent_outputs.filter((o) => String(o.title).startsWith('Piano di oggi')).length, 1)
})

test('in gioco: le vendite ferme da 90 giorni escono dal piano, le pipeline nuove restano', () => {
  const old = deal({ updated_at: ago(200), stage_changed_at: ago(200), stage: 'New' })
  assert.equal(inPlay(input(old), NOW), false)
  assert.equal(inPlay(input(old, { contact: { id: 'c1', name: 'X', last_contact_at: ago(10) } }), NOW), true, 'un contatto recente la rimette in gioco')
  assert.equal(inPlay(input(old, { quotes: [{ contact_id: 'c1', status: 'sent', total_amount: 488 }] }), NOW), true, 'un preventivo in attesa la rimette in gioco')
  assert.equal(inPlay(input(deal(), { contact: { id: 'c1', name: 'X', contact_scope: 'holding' } }), NOW), false, 'contatto in attesa: fuori')
  assert.equal(inPlay(input(deal(), { contact: { id: 'c1', name: 'X', hidden: true } }), NOW), false, 'contatto nascosto: fuori')
  assert.equal(inPlay(input(deal({ pipeline: 'tourism', stage: 'scoperta', updated_at: ago(400), stage_changed_at: ago(400) })), NOW), true)
  const plan = buildDirectorPlan([input(old), input(deal({ next_step: 'Chiamare', next_step_due: ahead(1) }))], NOW)
  assert.equal(plan.open, 1); assert.equal(plan.dormant, 1)
  assert.match(directorPlanLines(plan).join('\n'), /Fuori dal piano: 1 trattativa di vendita senza movimenti da 90 giorni/)
})

test('il piano breve sta in poche righe: tre da lavorare, tre da sbloccare', () => {
  const inputs = Array.from({ length: 8 }, (_, i) => input(deal({ id: `w${i}`, contact_id: `c${i}`, next_step: 'Chiamare', next_step_due: ahead(1) })))
    .concat(Array.from({ length: 6 }, (_, i) => input(deal({ id: `s${i}`, contact_id: `s${i}`, stage_changed_at: ago(30) }))))
  const brief = directorPlanBrief(buildDirectorPlan(inputs, NOW))
  assert.equal(brief.filter((l) => /^\d\. /.test(l)).length, 6)
  assert.ok(brief.length <= 12, brief.join('\n'))
  assert.equal(brief[0], 'In gioco: 14 opportunità, 6 ferme.')
})
