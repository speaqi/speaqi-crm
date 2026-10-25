import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OfficeWorkItem } from '../src/lib/office-work'
import { BudgetExceeded, type AgentContext, type callModel } from '../src/lib/server/office-agents'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { preparePresentationWork, verifyTourismWork } from '../src/lib/server/office-work-tourism'
import { DEFAULT_DECK_TEMPLATE, applyVars } from '../src/lib/tourism-deck'
import { FakeSupabase } from './fake-supabase'

const USER = '11111111-1111-4111-8111-111111111111'
const ENTITY = '22222222-2222-4222-8222-222222222222'
const PLACE = '33333333-3333-4333-8333-333333333333'
const WORK = '44444444-4444-4444-8444-444444444444'
const DECK = '55555555-5555-4555-8555-555555555555'
const SITE = 'https://tourisme.example.org'
const identity = 'Visit Marseille è l’ufficio ufficiale del turismo di Marsiglia.'
const coverage = 'Visit Marseille promuove la destinazione turistica di Marsiglia.'
const email = 'Il nostro ufficio risponde all’indirizzo info@tourisme.example.org.'
const page = { url: SITE, text: [identity, coverage, email].join('\n') }
const answer = { identity_quote: identity, identity_url: SITE, coverage_relation: 'PROMOTES', coverage_quote: coverage, coverage_url: SITE,
  email: 'info@tourisme.example.org', email_quote: email, email_url: SITE, phone: '', phone_quote: '', phone_url: '',
  decision_maker_type: '', decision_maker_quote: '', decision_maker_url: '' }

function fixture(agentId: 'entity_enricher' | 'presentations' = 'entity_enricher') {
  const checkpoints: Array<{ phase: string; checkpoint: Record<string, unknown> }> = []
  const db = new FakeSupabase({ tourism_entities: [{ id: ENTITY, user_id: USER, kind: 'organization', name: 'Visit Marseille', country_code: 'FR',
    status: 'UNVERIFIED', disabled: false, aliases: [], website: SITE, email: null, phone: null }], office_agent_outputs: [] })
  const work = { id: WORK, user_id: USER, order_id: null, agent_id: agentId, action: agentId === 'entity_enricher' ? 'verify_tourism_entity' : 'prepare_presentation',
    payload: { entity_id: ENTITY, city: 'Marsiglia' }, payload_version: 1, checkpoint: {}, lease_token: 'lease', result: {} } as unknown as OfficeWorkItem
  const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS[agentId], user_id: USER }, runId: 'run',
    reserve: async () => 'ledger', settle: async () => {}, log() {},
    async addOutput(output) {
      const row = { id: db.nextId('out'), user_id: USER, agent_id: agentId, status: 'pending', output_key: output.key, ...output }
      db.tables.office_agent_outputs.push(row)
      return row.id
    } }
  const checkpoint = async (phase: string, value: Record<string, unknown>) => { checkpoints.push({ phase, checkpoint: structuredClone(value) }) }
  const model = (async () => ({ text: JSON.stringify(answer), tokensIn: 10, tokensOut: 10, costCents: 1, citations: [] })) as typeof callModel
  return { db, ctx, work, checkpoints, deps: { checkpoint, model, readSite: async () => [page] } }
}

test('verifica puntuale: propone solo prove letterali, non attiva né scrive ente/CRM prima del clic', async () => {
  const f = fixture()
  const before = structuredClone(f.db.tables.tourism_entities)
  const result = await verifyTourismWork(f.ctx, f.work, f.db, f.deps)
  assert.equal(result.status, 'waiting_owner')
  assert.equal(result.approval_output_id, f.db.tables.office_agent_outputs[0].id)
  assert.equal(f.db.tables.office_agent_outputs[0].body.website, SITE)
  assert.equal(f.db.tables.office_agent_outputs[0].body.evidence.identity.quote, identity.replace(/’/g, "'"))
  assert.deepEqual(f.db.tables.tourism_entities, before)
  assert.equal(f.db.calls.some((call) => ['tourism_activate', 'office_enrich_entity', 'tourism_promote'].includes(call.rpc)), false)
  assert.ok(f.checkpoints.some((entry) => entry.phase === 'effect_started'))
})

test('verifica già proposta: ripresa senza nuovo modello; rifiuto annulla senza altra proposta', async () => {
  const f = fixture(); let paid = 0
  const deps = { ...f.deps, model: (async (...args) => { paid++; return f.deps.model(...args) }) as typeof callModel }
  await verifyTourismWork(f.ctx, f.work, f.db, deps)
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, deps)).status, 'waiting_owner')
  f.db.tables.office_agent_outputs[0].status = 'rejected'
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, deps)).status, 'cancelled')
  assert.equal(paid, 1)
  assert.equal(f.db.tables.office_agent_outputs.length, 1)
})

test('sito assente: ricerca e lettura verificano il candidato ma rimandano la scrittura al clic', async () => {
  const f = fixture(); f.db.tables.tourism_entities[0].website = null
  const calls: boolean[] = []
  const model = (async (_ctx, options) => {
    calls.push(!!options.webSearch)
    return { text: options.webSearch ? SITE : JSON.stringify(answer), tokensIn: 10, tokensOut: 10, costCents: 1, citations: [] }
  }) as typeof callModel
  const result = await verifyTourismWork(f.ctx, f.work, f.db, { ...f.deps, model })
  assert.equal(result.status, 'waiting_owner')
  assert.deepEqual(calls, [true, false])
  assert.equal(f.db.tables.tourism_entities[0].website, null)
  assert.equal(f.db.tables.office_agent_outputs[0].body.website, SITE)
})

test('nessuna prova oppure dato inventato: resta bloccato e non diventa VERIFIED', async () => {
  const f = fixture()
  const model = (async () => ({ text: JSON.stringify({ ...answer, identity_quote: 'Visit Marseille è un ente inventato dal modello.' }), tokensIn: 10, tokensOut: 10, costCents: 1, citations: [] })) as typeof callModel
  const result = await verifyTourismWork(f.ctx, f.work, f.db, { ...f.deps, model })
  assert.equal(result.status, 'blocked')
  assert.match(result.reason!, /identifica l’ente/)
  assert.equal(f.db.tables.tourism_entities[0].status, 'UNVERIFIED')
  assert.equal(f.db.tables.office_agent_outputs.length, 0)
})

test('budget esaurito: si propaga al worker e non attiva l’ente con dati parziali', async () => {
  const f = fixture()
  await assert.rejects(verifyTourismWork(f.ctx, f.work, f.db, { ...f.deps, model: async () => { throw new BudgetExceeded() } }), BudgetExceeded)
  assert.equal(f.db.tables.tourism_entities[0].status, 'UNVERIFIED')
  assert.equal(f.db.tables.office_agent_outputs.length, 0)
})

test('chiave mancante: ricerca e verifica restano riprendibili senza segnare un effetto iniziato', async () => {
  const keys = ['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_OFFICE']
  const before = keys.map((key) => process.env[key])
  keys.forEach((key) => { delete process.env[key] })
  try {
    for (const website of [null, SITE]) {
      const f = fixture()
      f.db.tables.tourism_entities[0].website = website
      const result = await verifyTourismWork(f.ctx, f.work, f.db, { checkpoint: f.deps.checkpoint, readSite: f.deps.readSite })
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason_code, 'configuration')
      assert.equal(result.phase, 'result_saved')
      assert.equal(f.checkpoints.some((entry) => entry.phase === 'effect_started'), false)
      assert.equal(f.db.tables.office_agent_outputs.length, 0)
    }
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index] })
  }
})

test('risposta illeggibile salvata: ripresa senza pagare di nuovo lo stesso tentativo', async () => {
  const f = fixture(); let paid = 0
  const deps = { ...f.deps, model: (async () => { paid++; return { text: 'non JSON', tokensIn: 10, tokensOut: 10, costCents: 1, citations: [] } }) as typeof callModel }
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, deps)).status, 'blocked')
  f.work.checkpoint = f.checkpoints.at(-1)!.checkpoint
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, deps)).status, 'blocked')
  assert.equal(paid, 1)
})

test('checkpoint con prove già lette: dopo riavvio ricrea soltanto la proposta mancante', async () => {
  const f = fixture()
  f.work.checkpoint = { website: SITE, pages: [page], enrichment: answer, enrichment_attempted: true }
  const result = await verifyTourismWork(f.ctx, f.work, f.db, { ...f.deps, readSite: async () => { throw Error('non deve leggere') },
    model: async () => { throw Error('non deve pagare') } })
  assert.equal(result.status, 'waiting_owner')
})

test('workspace e Napoli sono ricontrollati prima della ricerca', async () => {
  const f = fixture(); f.work.user_id = 'other'
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, f.deps)).reason_code, 'work_owner_mismatch')
  f.work.user_id = USER; f.work.payload.city = 'Napoli'
  assert.equal((await verifyTourismWork(f.ctx, f.work, f.db, f.deps)).reason_code, 'protected_map')
  assert.equal(f.checkpoints.length, 0)
})

function presentationFixture() {
  const f = fixture('presentations')
  f.db.tables.tourism_entities[0].status = 'VERIFIED'
  f.db.tables.tourism_entities.push({ id: PLACE, user_id: USER, kind: 'place', name: 'Marsiglia', country_code: 'FR', status: 'VERIFIED', disabled: false })
  f.work.payload.destination_id = PLACE
  f.db.tables.office_presentation_tasks = []
  f.db.tables.tourism_decks = []
  return f
}

test('presentazione: recupera il luogo dall’esito della verifica e riusa il servizio con coda di un elemento', async () => {
  const f = presentationFixture(); delete f.work.payload.destination_id
  f.db.tables.office_work_dependencies = [{ user_id: USER, work_id: WORK, depends_on_work_id: 'verification' }]
  f.db.tables.office_work_items = [{ id: 'verification', user_id: USER, status: 'succeeded', result: { entity_id: ENTITY, place_id: PLACE } }]
  let runs = 0
  const result = await preparePresentationWork(f.ctx, f.work, f.db, { ...f.deps, present: () => async (ctx) => {
    runs++
    assert.deepEqual(ctx.agent.settings.queue, [{ entity_id: ENTITY, destination_id: PLACE }])
    f.db.tables.office_presentation_tasks.push({ id: DECK, user_id: USER, entity_id: ENTITY, destination_id: PLACE })
    f.db.tables.tourism_decks.push({ id: DECK, user_id: USER, entity_id: ENTITY, status: 'ready', version: 1,
      slides: applyVars(DEFAULT_DECK_TEMPLATE, { ente: 'Visit Marseille', destinazione: 'Marsiglia' }) })
  } })
  assert.equal(result.status, 'succeeded')
  assert.equal(result.result!.deck_id, DECK)
  assert.equal(runs, 1)
  assert.equal(f.db.tables.tourism_decks[0].status, 'ready')
  assert.equal(f.db.tables.email_drafts?.length || 0, 0)
})

test('presentazione: un tentativo dubbio non ripaga; un deck pronto viene adottato senza generare', async () => {
  const f = presentationFixture()
  f.db.tables.office_presentation_tasks.push({ id: DECK, user_id: USER, entity_id: ENTITY, destination_id: PLACE })
  const deps = { ...f.deps, present: () => async () => { throw Error('non deve generare') } }
  assert.equal((await preparePresentationWork(f.ctx, f.work, f.db, deps)).reason_code, 'presentation_reconciliation')
  f.db.tables.tourism_decks.push({ id: DECK, user_id: USER, entity_id: ENTITY, status: 'failed', slides: [] })
  assert.equal((await preparePresentationWork(f.ctx, f.work, f.db, deps)).reason_code, 'presentation_reconciliation')
  Object.assign(f.db.tables.tourism_decks[0], { status: 'ready', version: 1, slides: applyVars(DEFAULT_DECK_TEMPLATE, {}) })
  assert.equal((await preparePresentationWork(f.ctx, f.work, f.db, deps)).status, 'succeeded')
})

test('presentazione: corsa senza deck o con slide malformate non equivale a successo', async () => {
  const f = presentationFixture()
  const deps = { ...f.deps, present: () => async () => ({ summary: '0 presentazioni, 1 avviso' }) }
  assert.equal((await preparePresentationWork(f.ctx, f.work, f.db, deps)).reason_code, 'presentation_result_missing')
  f.db.tables.office_presentation_tasks.push({ id: DECK, user_id: USER, entity_id: ENTITY, destination_id: PLACE })
  f.db.tables.tourism_decks.push({ id: DECK, user_id: USER, entity_id: ENTITY, status: 'ready', slides: [{ title: 'Inventata' }] })
  assert.equal((await preparePresentationWork(f.ctx, f.work, f.db, deps)).status, 'blocked')
})

test('lease scaduta: nessuna chiamata al modello o uscita dal vecchio worker', async () => {
  const f = fixture(); let paid = 0
  f.db.rpcs.office_work_assert_active = () => false
  await assert.rejects(verifyTourismWork(f.ctx, f.work, f.db, { model: async () => { paid++; throw Error('non deve pagare') }, readSite: f.deps.readSite }), /presa.*scaduta/)
  assert.equal(paid, 0)
  assert.equal(f.db.tables.office_agent_outputs.length, 0)
})
