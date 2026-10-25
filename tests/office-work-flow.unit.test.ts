/** Integrazione applicativa offline: worker e handler reali, RPC/storage/provider simulati.
 * I lock e le transazioni sono verificati separatamente nelle suite PostgreSQL.
 * Questi casi non attestano autonomia end-to-end del deploy o fonti remote reali.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { OfficeWorkItem, OfficeWorkSpec, WorkOutcome, WorkPatch } from '../src/lib/office-work'
import type { OfficeRun } from '../src/lib/office'
import { runOfficeWorker, type OfficeWorkStore, type WorkExecutor } from '../src/lib/server/office-work'
import { interpretOrderWork } from '../src/lib/server/office-work-handlers'
import { verifyTourismWork, preparePresentationWork } from '../src/lib/server/office-work-tourism'
import { presentationsHandler } from '../src/lib/server/office-agents/presentations'
import type { OfficeStore, callModel } from '../src/lib/server/office-agents'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { DEFAULT_DECK_TEMPLATE, applyVars } from '../src/lib/tourism-deck'
import { FakeSupabase } from './fake-supabase'

const USER = '11111111-1111-4111-8111-111111111111'
const ENTITY = '22222222-2222-4222-8222-222222222222'
const PLACE = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-25T10:00:00Z')
const SITE = 'https://tourisme.example.org'
const identity = 'Visit Marseille è l’ufficio ufficiale del turismo di Marsiglia.'
const coverage = 'Visit Marseille promuove la destinazione turistica di Marsiglia.'
const email = 'Il nostro ufficio risponde all’indirizzo info@tourisme.example.org.'
const page = { url: SITE, text: [identity, coverage, email].join('\n') }
const enrichment = { identity_quote: identity, identity_url: SITE, coverage_relation: 'PROMOTES', coverage_quote: coverage,
  coverage_url: SITE, email: 'info@tourisme.example.org', email_quote: email, email_url: SITE,
  phone: '', phone_quote: '', phone_url: '', decision_maker_type: '', decision_maker_quote: '', decision_maker_url: '' }

function fixture() {
  const works: OfficeWorkItem[] = []
  const db = new FakeSupabase({ office_work_items: works, office_work_dependencies: [], office_director_orders: [], office_agent_outputs: [],
    office_presentation_tasks: [], tourism_decks: [], tourism_evidence: [], office_budget_ledger: [], email_drafts: [],
    tourism_entities: [{ id: ENTITY, user_id: USER, name: 'Visit Marseille', kind: 'organization', country_code: 'FR', aliases: [],
      status: 'UNVERIFIED', disabled: false, website: null, email: null, phone: null }] })
  let clock = new Date(NOW)
  let paid = 0; let generated = 0; let reads = 0
  let websiteReadable = true
  const runs: OfficeRun[] = []
  const enabled = new Map(Object.keys(OFFICE_AGENT_DEFINITIONS).map((id) => [id, true]))
  const activeAgents = new Set<string>()
  const row = (id: string) => works.find((work) => work.id === id)!
  const dependencies = (work: OfficeWorkItem) => db.tables.office_work_dependencies.filter((dep) => dep.work_id === work.id)

  // La fixture rappresenta il confine RPC: non sostituisce i test delle vere funzioni SQL.
  function refresh() {
    for (const work of works) {
      const parents = dependencies(work).map((dep) => row(dep.depends_on_work_id))
      if (parents.some((parent) => parent.status === 'cancelled') && work.status === 'waiting') work.status = 'cancelled'
      if (work.status === 'waiting' && new Date(work.available_at) <= clock && parents.every((parent) => parent.status === 'succeeded')) work.status = 'ready'
    }
    for (const order of db.tables.office_director_orders) {
      const children = works.filter((work) => work.order_id === order.id)
      order.status = children.some((work) => work.status === 'cancelled') ? 'cancelled'
        : children.some((work) => work.status === 'waiting_owner') ? 'waiting_you'
          : children.some((work) => work.status === 'blocked') ? 'blocked'
            : order.planning_closed_at && children.length && children.every((work) => work.status === 'succeeded') ? 'done' : 'working'
    }
  }
  function enqueue(spec: OfficeWorkSpec): OfficeWorkItem {
    const previous = works.find((work) => work.source_key === spec.source_key)
    if (previous) return structuredClone(previous)
    const at = clock.toISOString()
    const work: OfficeWorkItem = { id: spec.id || randomUUID(), user_id: USER, order_id: spec.order_id || null, deal_id: spec.deal_id || null,
      agent_id: spec.agent_id, action: spec.action, origin: spec.origin || 'order', source_key: spec.source_key, payload: spec.payload || {},
      payload_version: 1, status: spec.status || 'ready', priority: spec.priority ?? 90, available_at: spec.available_at || at,
      phase: null, checkpoint: {}, result: {}, result_summary: null, reason_code: null, reason: null, required_action: null,
      responsible: null, next_check_at: null, lease_token: null, lease_until: null, attempt_count: 0, max_attempts: 3,
      last_run_id: null, revision: 1, created_at: at, updated_at: at }
    works.push(work)
    for (const id of spec.depends_on || []) db.tables.office_work_dependencies.push({ user_id: USER, work_id: work.id, depends_on_work_id: id })
    return structuredClone(work)
  }
  function persist(id: string, token: string, patch: WorkPatch): OfficeWorkItem {
    const work = row(id)
    assert.equal(work.lease_token, token)
    assert.equal(work.status, 'running')
    const { children, close_plan, ...changes } = patch
    Object.assign(work, changes)
    for (const child of children || []) enqueue(child)
    if (close_plan && work.order_id) db.tables.office_director_orders.find((order) => order.id === work.order_id)!.planning_closed_at = clock.toISOString()
    refresh()
    return structuredClone(work)
  }
  db.rpcs.office_work_assert_active = ({ p_work_id, p_token }) => row(p_work_id).lease_token === p_token && row(p_work_id).status === 'running'
  db.rpcs.office_work_transition = ({ p_work_id, p_token, p_patch }) => persist(p_work_id, p_token, p_patch)
  db.rpcs.office_work_enqueue = ({ p_spec }) => enqueue(p_spec)
  db.rpcs.claim_office_presentation = ({ p_entity_id, p_destination_id }) => {
    const previous = db.tables.office_presentation_tasks.find((task) => task.entity_id === p_entity_id && task.destination_id === p_destination_id)
    if (previous) return { claimed: false, task: previous }
    const task = { id: randomUUID(), user_id: USER, entity_id: p_entity_id, destination_id: p_destination_id, state: 'claimed' }
    db.tables.office_presentation_tasks.push(task)
    return { claimed: true, task }
  }
  db.rpcs.finish_office_presentation = ({ p_task_id, p_report, p_run_id }) => {
    db.tables.office_presentation_tasks.find((task) => task.id === p_task_id)!.state = 'ready'
    db.tables.office_agent_outputs.push({ id: randomUUID(), user_id: USER, agent_id: 'presentations', run_id: p_run_id,
      kind: 'report', status: 'pending', target_table: 'tourism_decks', target_id: p_task_id, body: p_report })
    return { ready: true }
  }
  db.rpcs.office_work_decide_output = ({ p_output_id, p_status }) => {
    const output = db.tables.office_agent_outputs.find((candidate) => candidate.id === p_output_id)!
    assert.equal(output.status, 'pending')
    output.status = p_status
    const work = row(output.body.work_id)
    if (p_status === 'approved') {
      Object.assign(db.tables.tourism_entities[0], { status: 'VERIFIED', website: output.body.website, email: enrichment.email })
      db.tables.tourism_entities.push({ id: PLACE, user_id: USER, kind: 'place', name: 'Marsiglia', status: 'VERIFIED', disabled: false })
      output.body.result = { entity_id: ENTITY, place_id: PLACE, contact_id: randomUUID() }
      Object.assign(work, { status: 'succeeded', result: output.body.result })
    } else work.status = 'cancelled'
    refresh()
    return { output }
  }
  const store: OfficeWorkStore = {
    enqueue: async (_user, spec) => enqueue(spec),
    async claim(_user, limit) {
      refresh()
      const ready = works.filter((work) => work.status === 'ready').slice(0, limit)
      for (const work of ready) Object.assign(work, { status: 'running', lease_token: randomUUID(), lease_until: new Date(clock.getTime() + 90_000).toISOString(), attempt_count: work.attempt_count + 1 })
      return structuredClone(ready)
    },
    heartbeat: async (id, token) => row(id).lease_token === token,
    active: async (id, token) => row(id).lease_token === token && row(id).status === 'running',
    transition: async (id, token, patch) => persist(id, token, patch),
    linkRun: async (id, _token, runId) => { row(id).last_run_id = runId },
    recover: async () => ({}), seedOrders: async () => ({}), uncertainRun: async (runId) => db.tables.office_budget_ledger.some((ledger) => ledger.run_id === runId && ledger.actual_cents == null),
    openState: async () => ({ blocked: works.filter((work) => ['blocked', 'waiting_owner'].includes(work.status)).length,
      waiting: works.filter((work) => ['waiting', 'ready', 'running'].includes(work.status)).length }),
    claimEvents: async () => [], finishEvent: async () => {},
  }
  const agentStore: OfficeStore = {
    agent: async (id) => ({ ...OFFICE_AGENT_DEFINITIONS[id], user_id: USER, enabled: enabled.get(id)! }),
    async claim(id, _user, key) {
      const old = runs.find((run: any) => run.key === key)
      if (old) return { claimed: false, reason: 'duplicate', run: old }
      const skipped = !enabled.get(id) ? 'disabled' : activeAgents.has(id) ? 'running' : null
      const run = { id: randomUUID(), agent_id: id, user_id: USER, status: skipped ? 'skipped_disabled' : 'running',
        key, started_at: clock.toISOString(), finished_at: null, summary: '', error: null, items_created: 0,
        cost_cents_reserved: 0, cost_cents_actual: 0, details: {} } as OfficeRun
      if (skipped) return { claimed: false, reason: skipped, run }
      runs.push(run); activeAgents.add(id)
      return { claimed: true, reason: 'started', run }
    },
    async reserve(id, runId, cents) {
      const ledger = { id: randomUUID(), agent_id: id, run_id: runId, reserved_cents: cents, actual_cents: null }
      db.tables.office_budget_ledger.push(ledger)
      return ledger.id
    },
    async settle(id, cents) { db.tables.office_budget_ledger.find((ledger) => ledger.id === id)!.actual_cents = cents },
    async output(runId, key, input) {
      const run = runs.find((candidate) => candidate.id === runId)!
      const output = { id: randomUUID(), user_id: USER, agent_id: run.agent_id, run_id: runId, output_key: key, status: 'pending', ...input }
      db.tables.office_agent_outputs.push(output)
      return output.id
    },
    async finish(runId, status, summary, error) {
      const run = runs.find((candidate) => candidate.id === runId)!
      Object.assign(run, { status, summary, error, finished_at: clock.toISOString() }); activeAgents.delete(run.agent_id)
      return run
    },
  }
  const model = (async (ctx, options) => {
    const ledger = await ctx.reserve(1); paid++; await ctx.settle(ledger, 1)
    return { text: options.webSearch ? SITE : JSON.stringify(enrichment), costCents: 1, tokensIn: 10, tokensOut: 10, citations: [] }
  }) as typeof callModel
  const execute: WorkExecutor = async (ctx, work, client) => {
    if (work.action === 'interpret_order') return interpretOrderWork(ctx, work, client, { now: () => clock,
      model: (async (context) => {
        const ledger = await context.reserve(1); paid++; await context.settle(ledger, 1)
        return { text: JSON.stringify({ intent: 'presentation', target: 'Visit Marseille', city: 'Marsiglia' }), costCents: 1, tokensIn: 10, tokensOut: 10, citations: [] }
      }) as typeof callModel })
    if (work.action === 'verify_tourism_entity') return verifyTourismWork(ctx, work, client, { model, readSite: async () => {
      reads++; if (!websiteReadable) throw Error('fonte non disponibile'); return [page]
    } })
    if (work.action === 'prepare_presentation') return preparePresentationWork(ctx, work, client, {
      present: (scoped) => presentationsHandler(scoped, {
        create: (async (_db: any, _user: string, input: any, id: string) => {
          const deck = { id, user_id: USER, entity_id: ENTITY, status: 'draft', version: 1, warnings: [], slides: [],
            input: input.input, notes: input.notes }
          db.tables.tourism_decks.push(deck); return deck
        }) as any,
        generate: (async (_db: any, _viewer: any, deck: any) => {
          generated++
          Object.assign(deck, { status: 'ready', slides: applyVars(DEFAULT_DECK_TEMPLATE, { ente: 'Visit Marseille', destinazione: 'Marsiglia' }) })
          return deck
        }) as any,
      }),
    })
    throw new Error('Azione inattesa nella fixture')
  }
  const tick = () => runOfficeWorker(USER, { enabled: true, admin: db, store, agentStore, execute, now: () => clock,
    heartbeatMs: 0, deliverNotifications: false, limit: 12 })
  function order() {
    const id = randomUUID()
    db.tables.office_director_orders.push({ id, user_id: USER, text: 'Prepara la presentazione per Visit Marseille a Marsiglia',
      source: 'web', status: 'received', attachments: [], planning_closed_at: null })
    enqueue({ agent_id: 'director', action: 'interpret_order', order_id: id, source_key: `order:${id}:interpret`, payload: { order_id: id } })
    return id
  }
  return { db, works, store, agentStore, tick, order, execute, enqueue, row, enabled, activeAgents, model,
    counters: () => ({ paid, generated, reads }),
    readable(value: boolean) { websiteReadable = value },
    nextMinute() { clock = new Date(clock.getTime() + 60_001) },
    async decide(id: string, status: 'approved' | 'rejected') {
      const result = await db.rpc('office_work_decide_output', { p_user_id: USER, p_output_id: id, p_status: status })
      if (result.error) throw result.error
    },
  }
}

test('catena Tourism offline: ordine → verifica/fonti → clic → presentazione pronta → risultato finale', async () => {
  const f = fixture(); const id = f.order()
  await f.tick()
  const verify = f.works.find((work) => work.action === 'verify_tourism_entity')!
  const presentation = f.works.find((work) => work.action === 'prepare_presentation')!
  assert.equal(presentation.status, 'waiting')
  assert.equal(f.db.tables.office_work_dependencies[0].depends_on_work_id, verify.id)
  await f.tick()
  assert.equal(verify.status, 'waiting_owner'); assert.ok(verify.approval_output_id)
  assert.equal(f.db.tables.office_director_orders[0].status, 'waiting_you')
  assert.equal(f.db.tables.tourism_entities[0].status, 'UNVERIFIED')
  assert.equal(f.db.tables.tourism_entities[0].website, null)
  assert.equal(f.counters().generated, 0)
  await f.decide(verify.approval_output_id!, 'approved')
  assert.equal(presentation.status, 'ready')
  assert.notEqual(f.db.tables.office_director_orders[0].status, 'done')
  await f.tick()
  assert.equal(presentation.status, 'succeeded'); assert.ok(presentation.result.deck_id)
  assert.equal(f.db.tables.office_director_orders.find((order) => order.id === id)!.status, 'done')
  assert.equal(f.db.tables.tourism_decks[0].status, 'ready')
  assert.equal(f.db.tables.email_drafts.length, 0)
  const before = f.counters()
  await f.tick()
  assert.deepEqual(f.counters(), before)
  assert.equal(f.counters().generated, 1)
})

test('due ordini simultanei conservano gli incarichi; il Direttore occupato riprende senza nuovo ordine', async () => {
  const f = fixture(); const first = f.order(); const second = f.order()
  await Promise.all([f.tick(), f.tick()])
  assert.equal(f.db.tables.office_director_orders.length, 2)
  const interpretations = f.works.filter((work) => work.action === 'interpret_order')
  assert.equal(interpretations.length, 2)
  assert.ok(interpretations.some((work) => work.status === 'succeeded'))
  f.nextMinute(); await f.tick()
  for (const id of [first, second]) assert.equal(f.works.find((work) => work.order_id === id && work.action === 'interpret_order')!.status, 'succeeded')
  assert.equal(f.works.filter((work) => work.action === 'prepare_presentation').length, 2)
})

test('riavvio dopo il checkpoint delle prove: il nuovo worker ricrea solo la proposta, senza altra ricerca/spesa', async () => {
  const f = fixture(); const id = f.order(); await f.tick()
  const verify = f.works.find((work) => work.action === 'verify_tourism_entity')!
  // Snapshot restituito dalla RPC di recupero dopo una fase già salvata.
  verify.checkpoint = { website: SITE, pages: [page], enrichment, enrichment_attempted: true }
  verify.phase = 'result_saved'
  verify.status = 'ready'; verify.lease_token = null; verify.attempt_count = 1
  const before = f.counters()
  await f.tick()
  assert.equal(verify.status, 'waiting_owner')
  assert.deepEqual(f.counters(), before)
  assert.ok(verify.approval_output_id)
  assert.equal(f.db.tables.office_director_orders.find((order) => order.id === id)!.status, 'waiting_you')
})

test('rifiuto del titolare annulla la catena senza deck, seconda proposta o altra spesa', async () => {
  const f = fixture(); f.order(); await f.tick(); await f.tick()
  const verify = f.works.find((work) => work.action === 'verify_tourism_entity')!
  await f.decide(verify.approval_output_id!, 'rejected')
  const before = f.counters(); await f.tick()
  assert.equal(verify.status, 'cancelled')
  assert.equal(f.works.find((work) => work.action === 'prepare_presentation')!.status, 'cancelled')
  assert.equal(f.db.tables.office_director_orders[0].status, 'cancelled')
  assert.equal(f.db.tables.tourism_decks.length, 0)
  assert.equal(f.db.tables.office_agent_outputs.length, 1)
  assert.deepEqual(f.counters(), before)
})

test('fonte corretta dopo il blocco riprende lo stesso lavoro e lo stesso ordine', async () => {
  const f = fixture(); const id = f.order(); await f.tick()
  const verify = f.works.find((work) => work.action === 'verify_tourism_entity')!
  verify.payload.website = SITE; f.readable(false)
  await f.tick()
  assert.equal(verify.status, 'blocked'); assert.equal(verify.reason_code, 'website_unreadable')
  assert.equal(f.db.tables.tourism_entities[0].status, 'UNVERIFIED')
  // La RPC di correzione restituisce una nuova versione, non un nuovo incarico.
  Object.assign(verify, { payload: { ...verify.payload, website: `${SITE}/contatti` }, payload_version: 2,
    revision: verify.revision + 1, checkpoint: {}, status: 'ready' })
  f.readable(true); await f.tick()
  assert.equal(verify.status, 'waiting_owner')
  assert.equal(verify.order_id, id)
  assert.equal(f.db.tables.office_director_orders.length, 1)
  assert.equal(f.works.filter((work) => work.action === 'verify_tourism_entity').length, 1)
  assert.equal(f.db.tables.office_agent_outputs[0].output_key, `work:${verify.id}:proposal:v2`)
})
