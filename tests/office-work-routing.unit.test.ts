import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import sharp from 'sharp'
import { createDirectorOrder, processDirectorOrder } from '../src/lib/server/office-director-orders'
import { executeOfficeWork, interpretOrderWork, planProposalWorks } from '../src/lib/server/office-work-handlers'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext, callModel } from '../src/lib/server/office-agents'
import type { OfficeWorkItem } from '../src/lib/office-work'
import { FakeSupabase } from './fake-supabase'
import { officeMapSlot } from '../src/lib/office/maps'

const OWNER = '11111111-1111-4111-8111-111111111111'
const ORDER = '22222222-2222-4222-8222-222222222222'
function context(id = 'director'): AgentContext {
  return { agent: { ...OFFICE_AGENT_DEFINITIONS[id], user_id: OWNER }, runId: 'run',
    reserve: async () => { throw Error('Nessuna spesa prevista') }, settle: async () => {}, addOutput: async () => 'output', log() {} }
}
function work(patch: Partial<OfficeWorkItem> = {}): OfficeWorkItem {
  return { id: ORDER, user_id: OWNER, order_id: ORDER, deal_id: null, agent_id: 'director', action: 'interpret_order', origin: 'order',
    source_key: 'order:fixture:interpret', payload: { order_id: ORDER }, payload_version: 1, status: 'running', priority: 80,
    available_at: '2026-10-25T12:00:00Z', phase: 'ready', checkpoint: {}, result: {}, result_summary: null,
    reason_code: null, reason: null, required_action: null, responsible: null, next_check_at: null,
    lease_token: ORDER, lease_until: '2026-10-25T12:01:30Z', attempt_count: 1, max_attempts: 5, last_run_id: null,
    revision: 1, created_at: '2026-10-25T12:00:00Z', updated_at: '2026-10-25T12:00:00Z', ...patch }
}

test('schema non ancora applicato: ordine salvato e riprendibile senza lavoro volatile', async () => {
  const before = process.env.OFFICE_WORKER_ENABLED
  process.env.OFFICE_WORKER_ENABLED = 'true'
  const db = new FakeSupabase({ office_director_orders: [{ id: ORDER, user_id: OWNER, status: 'received', text: 'come va?', attachments: [] }] }, {
    office_work_enqueue: () => { throw { code: 'PGRST202', message: 'schema cache' } },
  })
  try {
    const answer = await processDirectorOrder(db, OWNER, ORDER)
    assert.equal(answer.status, 'received')
    assert.match(answer.reply!, /ripreso automaticamente/)
    assert.match(db.tables.office_director_orders[0].reply, /ripreso automaticamente/)
    assert.deepEqual(db.calls.map((call) => call.rpc), ['office_work_enqueue'])
    assert.equal(db.tables.office_agent_runs, undefined)
  } finally { if (before === undefined) delete process.env.OFFICE_WORKER_ENABLED; else process.env.OFFICE_WORKER_ENABLED = before }
})

test('proposte del piano: soltanto deleghe tipizzate e attesa della decisione collegata', () => {
  const outputs = [
    { id: 'map-proposal', kind: 'proposal', status: 'pending', body: { action: 'build_map', recipient_agent_id: 'mymaps_builder', city: 'Marsiglia' } },
    { id: 'wrong-agent', kind: 'proposal', status: 'pending', body: { action: 'build_map', recipient_agent_id: 'presentations' } },
    { id: 'approved', kind: 'proposal', status: 'approved', body: { action: 'build_map', recipient_agent_id: 'mymaps_builder' } },
    { id: 'free-action', kind: 'proposal', status: 'pending', body: { action: 'publish', recipient_agent_id: 'mymaps_builder' } },
  ]
  const children = planProposalWorks(work({ action: 'agent_run' }), outputs)
  assert.equal(children.length, 1)
  assert.equal(children[0].action, 'import_mymaps')
  assert.equal(children[0].status, 'waiting_owner')
  assert.equal(children[0].source_output_id, 'map-proposal')
  assert.equal(children[0].approval_output_id, 'map-proposal')
})

test('chiave assente: interpretazione bloccata prima di qualsiasi effetto e riprendibile', async () => {
  const before = [process.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY_OFFICE]
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY_OFFICE
  const db = new FakeSupabase({ office_director_orders: [{ id: ORDER, user_id: OWNER, text: 'ordine', attachments: [] }] })
  try {
    const answer = await interpretOrderWork(context(), work(), db)
    assert.equal(answer.status, 'blocked')
    assert.equal(answer.reason_code, 'configuration')
    assert.equal(answer.phase, 'ready')
    assert.equal(db.calls.length, 0)
  } finally {
    for (const [index, key] of ['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_OFFICE'].entries()) {
      if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]
    }
  }
})

test('report senza fonti: blocco certo correggibile, senza effetto incerto', async () => {
  const db = new FakeSupabase({ office_agent_outputs: [{ id: 'report', user_id: OWNER, run_id: 'run', body: { feeds_checked: 0 } }] }, {
    office_work_transition: () => ({}),
  })
  const answer = await executeOfficeWork(context('news_watch'), work({ agent_id: 'news_watch', action: 'agent_run' }), db,
    { handler: async () => ({ summary: 'Nessuna fonte configurata.' }) })
  assert.equal(answer.status, 'blocked')
  assert.equal(answer.reason_code, 'sources_missing')
  assert.equal(answer.phase, 'result_saved')
})

test('foto: il worker non vede ricevuto finché gli allegati non sono salvati', async () => {
  const db = new FakeSupabase({ office_director_orders: [] }) as FakeSupabase & { storage: any }
  let duringUpload: any
  db.storage = { getBucket: async () => ({ data: { id: 'office-director' } }), from: () => ({ upload: async () => {
    duringUpload = structuredClone(db.tables.office_director_orders[0]); return { error: null }
  } }) }
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  const order = await createDirectorOrder(db, OWNER, { source: 'web', text: 'Leggi il contatto', files: [{ name: 'contatto.jpg', buffer: photo }] })
  assert.equal(duringUpload.status, 'working')
  assert.equal(duringUpload.interpretation.intake, 'attachments')
  assert.equal(order.status, 'received')
  assert.equal(order.attachments.length, 1)
  assert.equal(order.interpretation, null)
})

test('turno My Maps persistente importa gli incarichi, senza secondo consumatore della coda', async () => {
  const db = new FakeSupabase({}, { office_work_import_queue: () => ({ imported: 1, adopted: 0, blocked: 0 }) })
  const answer = await executeOfficeWork(context('mymaps_builder'), work({ agent_id: 'mymaps_builder', action: 'agent_run' }), db)
  assert.equal(answer.status, 'succeeded')
  assert.deepEqual(answer.result, { queue_import: { imported: 1, adopted: 0, blocked: 0 } })
  assert.deepEqual(db.calls.map((call) => call.rpc), ['office_work_import_queue'])
})

test('turni Qualità e Presentazioni conservano monitoraggio e recupero senza consumare le deleghe', async () => {
  for (const id of ['maps_quality', 'presentations']) {
    const db = new FakeSupabase({}, { office_work_import_queue: () => ({ imported: 1 }), office_work_transition: () => ({}) })
    const ctx = context(id)
    ctx.agent = { ...ctx.agent, settings: { queue: [{ source_output_id: 'proposal', entity_id: 'entity', slug: 'marsiglia' }] } }
    let called = 0
    const answer = await executeOfficeWork(ctx, work({ agent_id: id, action: 'agent_run' }), db, { handler: async (scoped) => {
      called++
      assert.deepEqual(scoped.agent.settings.queue, [])
      return { summary: 'Controllo periodico concluso.' }
    } })
    assert.equal(called, 1)
    assert.equal(answer.status, 'succeeded')
    assert.equal(db.calls.filter((call) => call.rpc === 'office_work_import_queue').length, 1)
    assert.equal((ctx.agent.settings.queue as any[]).length, 1)
  }
})

test('turno Lingue monitora solo le mappe senza delega già importata nel registro', async () => {
  const ctx = context('languages_voice')
  const monitor = { map_id: 'monitor-map' }
  ctx.agent = { ...ctx.agent, settings: { queue: ['monitor-string', monitor,
    { map_id: 'delegated', source_output_id: 'proposal' }, { map_id: 'order-map', origin: 'director_order' }] } }
  const db = new FakeSupabase({}, { office_work_transition: () => ({}) })
  const answer = await executeOfficeWork(ctx, work({ agent_id: 'languages_voice', action: 'agent_run' }), db, { handler: async (scoped) => {
    assert.deepEqual(scoped.agent.settings.queue, ['monitor-string', monitor])
    return { summary: 'Monitoraggio delle lingue concluso.' }
  } })
  assert.equal(answer.status, 'succeeded')
  assert.equal((ctx.agent.settings.queue as any[]).length, 4)
})

test('una correzione del testo usa lo stesso ordine e il testo aggiornato', async () => {
  const db = new FakeSupabase({ office_director_orders: [{ id: ORDER, user_id: OWNER, status: 'received', text: 'mappa?', attachments: [] }] }, {
    office_work_transition: () => ({}),
  })
  let prompt = ''
  const answer = await interpretOrderWork(context(), work({ payload: { order_id: ORDER, text: 'controlla la mappa di Marsiglia' }, payload_version: 2 }), db, {
    model: (async (_ctx, options) => { prompt = options.input; return { text: JSON.stringify({ intent: 'check_map', city: 'Marsiglia' }),
      costCents: 0, tokensIn: 0, tokensOut: 0, citations: [] } }) as typeof callModel,
  })
  assert.match(prompt, /controlla la mappa di Marsiglia/)
  assert.equal(answer.children?.[0].order_id, ORDER)
  assert.equal(answer.children?.[0].action, 'check_map')
  assert.equal(db.tables.office_director_orders.length, 1)
})

test('risposta del modello illeggibile: costo concluso e testo correggibile sullo stesso lavoro', async () => {
  const db = new FakeSupabase({ office_director_orders: [{ id: ORDER, user_id: OWNER, status: 'received', text: 'ordine', attachments: [] }] }, {
    office_work_transition: () => ({}),
  })
  const answer = await interpretOrderWork(context(), work(), db, { model: (async () => ({ text: '{', costCents: 1,
    tokensIn: 10, tokensOut: 1, citations: [] })) as typeof callModel })
  assert.equal(answer.status, 'blocked')
  assert.equal(answer.reason_code, 'needs_information')
  assert.equal(answer.phase, 'result_saved')
})

test('bridge assente: nessun effetto incerto e il lavoro resta riprendibile dopo la configurazione', async () => {
  const before = process.env.OFFICE_BRIDGE_SECRET
  delete process.env.OFFICE_BRIDGE_SECRET
  try {
    const answer = await executeOfficeWork(context('mymaps_builder'), work({ agent_id: 'mymaps_builder', action: 'import_mymaps',
      payload: { slug: 'marsiglia', city: 'Marsiglia' } }), new FakeSupabase())
    assert.equal(answer.status, 'blocked')
    assert.equal(answer.phase, 'ready')
    assert.equal(answer.reason_code, 'configuration')
  } finally { if (before === undefined) delete process.env.OFFICE_BRIDGE_SECRET; else process.env.OFFICE_BRIDGE_SECRET = before }
})

test('My Maps: la ricevuta di una fonte o versione precedente non chiude il nuovo lavoro', async () => {
  const before = process.env.OFFICE_BRIDGE_SECRET
  process.env.OFFICE_BRIDGE_SECRET = 'x'.repeat(32)
  const slot = officeMapSlot(new Date())
  const db = new FakeSupabase({ office_agent_outputs: [{ id: 'old-output', user_id: OWNER, agent_id: 'mymaps_builder', run_id: 'old-run',
    target_id: 'marsiglia', output_key: `mymaps:${slot}:work:${ORDER}:v1`, body: { source: 'sourceA', cost_cents: 0, created: 10 } }] }, {
    office_work_transition: () => ({}),
  })
  let calls = 0
  const fetcher = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    assert.equal(JSON.parse(String(init?.body)).source, 'sourceB')
    return Response.json({ slug: 'marsiglia', requested_slug: 'marsiglia', city: 'Marsiglia', source: 'sourceB', read: 3, created: 2,
      existing: 1, duplicates: 0, skipped: 0, remaining: 0, ready: false, cost_cents: 0 })
  })
  const ctx = context('mymaps_builder')
  ctx.reserve = async () => 'ledger'
  ctx.addOutput = async (input) => {
    db.tables.office_agent_outputs.push({ id: 'new-output', user_id: OWNER, agent_id: 'mymaps_builder', run_id: ctx.runId,
      output_key: input.key, ...input })
    return 'new-output'
  }
  try {
    const answer = await executeOfficeWork(ctx, work({ agent_id: 'mymaps_builder', action: 'import_mymaps', payload_version: 2,
      payload: { slug: 'marsiglia', city: 'Marsiglia', source: 'sourceB' } }), db)
    assert.equal(calls, 1)
    assert.equal(answer.status, 'succeeded')
    assert.deepEqual(answer.output_ids, ['new-output'])
  } finally { fetcher.mock.restore(); if (before === undefined) delete process.env.OFFICE_BRIDGE_SECRET; else process.env.OFFICE_BRIDGE_SECRET = before }
})
