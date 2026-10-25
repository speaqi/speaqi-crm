import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateAutomationOutcome, nextOfficeBudgetCheck, officeWorkSpec, validateWorkPayload, type OfficeWorkItem, type WorkOutcome } from '../src/lib/office-work'
import { runOfficeWorker, type OfficeWorkStore, type WorkEvent } from '../src/lib/server/office-work'
import { runJob, type SchedulerDeps } from '../src/lib/server/automation-scheduler'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'

const OWNER = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-25T10:00:00Z')
function work(patch: Partial<OfficeWorkItem> = {}): OfficeWorkItem {
  return { id: ID, user_id: OWNER, order_id: ID, deal_id: null, agent_id: 'director', action: 'interpret_order', source_key: 'test:order:1', origin: 'order',
    payload: { order_id: ID }, payload_version: 1, status: 'ready', priority: 90, available_at: NOW.toISOString(), phase: null,
    checkpoint: {}, result: {}, result_summary: null, reason_code: null, reason: null, required_action: null, responsible: null, next_check_at: null,
    lease_token: null, lease_until: null, attempt_count: 0, max_attempts: 3, last_run_id: null, revision: 1,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...patch }
}
function fakeStore(items = [work()]) {
  let active = true
  const rows = items.map((item) => structuredClone(item))
  const transitions: Array<{ id: string; patch: unknown }> = []
  const links: string[] = []
  const events: WorkEvent[] = []
  const delivered: Array<{ status: string; error: string | null }> = []
  const store: OfficeWorkStore = {
    enqueue: async (_user, _spec) => rows[0],
    async claim(userId, limit) {
      const claimed = rows.filter((row) => row.user_id === userId && row.status === 'ready').slice(0, limit)
      for (const row of claimed) { row.status = 'running'; row.lease_token = `lease-${row.id}`; row.attempt_count++ }
      return structuredClone(claimed)
    },
    active: async () => active, heartbeat: async () => active,
    async transition(id, _token, patch) {
      assert.ok(active, 'un processo scaduto non può completare il lavoro')
      const row = rows.find((item) => item.id === id)!
      Object.assign(row, patch); transitions.push({ id, patch }); return structuredClone(row)
    },
    linkRun: async (_id, _token, runId) => { links.push(runId) },
    recover: async () => ({}), seedOrders: async () => ({}), uncertainRun: async () => false,
    openState: async () => ({ blocked: rows.filter((row) => ['blocked', 'waiting_owner'].includes(row.status)).length,
      waiting: rows.filter((row) => ['waiting', 'ready', 'running'].includes(row.status)).length }),
    async claimEvents() { const pending = events.filter((event) => event.status === 'pending'); for (const event of pending) event.status = 'sending'; return pending },
    async finishEvent(id, _token, status, error) { events.find((event) => event.id === id)!.status = status; delivered.push({ status, error }) },
  }
  return { store, rows, links, transitions, events, delivered, expire() { active = false } }
}
function fakeRunner(mode?: string) {
  let calls = 0
  const run: any = async (agentId: string, handler: any, options: any) => {
    calls++
    const row: any = { id: 'run-1', agent_id: agentId, user_id: OWNER, status: 'done', summary: '', error: null }
    if (mode === 'disabled' || mode === 'running') return { skipped: mode, run: row }
    if (mode === 'budget') return { run: { ...row, status: 'skipped_budget' }, error: 'Budget esaurito' }
    if (mode === 'uncertain') return { run: { ...row, status: 'failed' }, error: 'Riserva mantenuta: esito incerto' }
    try {
      await options.assertActive()
      const value = await handler({ agent: { ...OFFICE_AGENT_DEFINITIONS[agentId], user_id: OWNER }, runId: row.id,
        reserve: async () => { await options.assertActive(); return 'ledger' }, settle: async () => {},
        addOutput: async () => { await options.assertActive(); return 'output' }, log() {} })
      return { run: { ...row, summary: value?.summary || '' } }
    } catch (error) { return { run: { ...row, status: 'failed' }, error: error instanceof Error ? error.message : 'errore' } }
  }
  return { run, calls: () => calls }
}
const options = { enabled: true, admin: {}, heartbeatMs: 0, deliverNotifications: false, now: () => NOW }

test('azioni chiuse, identificativi e payload impediscono deleghe libere e Napoli', () => {
  assert.throws(() => officeWorkSpec({ agent_id: 'director', action: 'send_email', source_key: 'bad' }), /non ammesso/)
  assert.throws(() => officeWorkSpec({ agent_id: 'director', action: 'interpret_order', source_key: '' }), /Chiave/)
  assert.throws(() => validateWorkPayload('director', 'interpret_order', { enabled: true }), /Campo/)
  assert.throws(() => validateWorkPayload('presentations', 'prepare_presentation', { entity_id: 'foreign' }), /Identificativo/)
  for (const slug of ['napolimap', 'naples', '%6eapoli']) assert.throws(() => validateWorkPayload('mymaps_builder', 'import_mymaps', { city: slug }), /Napoli/)
  assert.equal(officeWorkSpec({ agent_id: 'mymaps_builder', action: 'import_mymaps', source_key: 'map:1', payload: { slug: 'marsiglia' } }).payload?.slug, 'marsiglia')
})

test('due worker concorrenti consumano una volta sola e il risultato resta consultabile', async () => {
  const db = fakeStore(); const runner = fakeRunner()
  const execute = async (): Promise<WorkOutcome> => ({ status: 'succeeded', result: { report_id: ID }, result_summary: 'Rapporto persistito' })
  const [first, second] = await Promise.all([runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run, execute }),
    runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run, execute })])
  assert.equal(runner.calls(), 1)
  assert.equal(db.links.length, 1)
  assert.equal(db.rows[0].status, 'succeeded')
  assert.equal(first.results.length + second.results.length, 1)
  const replay = await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run, execute })
  assert.equal(replay.outcome, 'skipped'); assert.equal(runner.calls(), 1)
})

test('agente spento oppure occupato lascia il lavoro persistente in attesa', async () => {
  for (const mode of ['disabled', 'running']) {
    const db = fakeStore(); const runner = fakeRunner(mode)
    const result = await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run })
    assert.equal(result.outcome, 'skipped'); assert.equal(db.rows[0].status, 'waiting')
    assert.equal(db.rows[0].reason_code, mode === 'disabled' ? 'agent_disabled' : 'agent_busy')
    assert.ok(db.rows[0].next_check_at); assert.equal(runner.calls(), 1)
  }
})

test('budget finito e operazione incerta sono blocchi, senza rialzo del tetto né retry cieco', async () => {
  for (const mode of ['budget', 'uncertain']) {
    const db = fakeStore(); const runner = fakeRunner(mode)
    const result = await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run })
    assert.equal(result.outcome, 'blocked'); assert.equal(db.rows[0].status, 'blocked')
    assert.equal(db.rows[0].reason_code, mode === 'budget' ? 'budget_exhausted' : 'reconciliation_required')
    if (mode === 'budget') { assert.equal(db.rows[0].phase, 'ready'); assert.equal(db.rows[0].next_check_at, '2026-10-25T23:00:00.000Z') }
    await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run })
    assert.equal(runner.calls(), 1)
  }
})

test('il budget si ricontrolla al confine del calendario italiano, compreso il cambio ora', () => {
  assert.equal(nextOfficeBudgetCheck(new Date('2026-10-24T12:00:00Z')), '2026-10-24T22:00:00.000Z')
  assert.equal(nextOfficeBudgetCheck(NOW), '2026-10-25T23:00:00.000Z')
  assert.equal(nextOfficeBudgetCheck(NOW, 'week'), '2026-10-25T23:00:00.000Z')
  assert.equal(nextOfficeBudgetCheck(NOW, 'month'), '2026-10-31T23:00:00.000Z')
  assert.equal(nextOfficeBudgetCheck(new Date('2026-03-29T12:00:00Z')), '2026-03-29T22:00:00.000Z')
})

test('l’importazione delle vecchie code precede recupero e presa del worker', async () => {
  const db = fakeStore([]); const steps: string[] = []
  db.store.seedOrders = async () => { steps.push('seed') }
  db.store.importQueue = async () => { steps.push('import'); return { imported: 1, blocked: 0 } }
  db.store.recover = async () => { steps.push('recover') }
  db.store.claim = async (_user, limit) => { steps.push('claim'); assert.equal(limit, 10); return [] }
  const result = await runOfficeWorker(OWNER, { ...options, store: db.store, limit: 20 })
  assert.deepEqual(steps, ['seed', 'import', 'recover', 'claim'])
  assert.deepEqual(result.imported, { imported: 1, blocked: 0 })
})

test('lease scaduta impedisce al vecchio processo una nuova riserva o il completamento', async () => {
  const db = fakeStore(); const runner = fakeRunner(); let reserved = false
  const result = await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run,
    execute: async (ctx) => { db.expire(); await ctx.reserve(1); reserved = true; return { status: 'succeeded', result: { bad: true } } } })
  assert.equal(reserved, false); assert.equal(db.transitions.length, 0)
  assert.equal(result.results[0].outcome, 'skipped')
})

test('lease scaduta fra controllo e commit non diventa un falso fallimento del worker', async () => {
  const db = fakeStore(); const runner = fakeRunner(); let writes = 0
  db.store.transition = async () => { writes++; throw new Error('Presa in carico scaduta') }
  const result = await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run,
    execute: async () => ({ status: 'succeeded', result: { report_id: ID } }) })
  assert.equal(result.outcome, 'skipped'); assert.equal(writes, 1)
})

test('report informativo senza ricevuta non diventa un lavoro riuscito', async () => {
  const db = fakeStore(); const runner = fakeRunner()
  await runOfficeWorker(OWNER, { ...options, store: db.store, run: runner.run,
    execute: async () => ({ status: 'succeeded', result_summary: 'Ho passato il lavoro' }) })
  assert.equal(db.rows[0].status, 'blocked'); assert.match(db.rows[0].reason!, /riferimento verificabile/)
})

test('schema non ancora applicato conserva un blocco leggibile, worker spento non chiama il database', async () => {
  const db = fakeStore(); db.store.seedOrders = async () => { throw { code: 'PGRST202' } }
  assert.equal((await runOfficeWorker(OWNER, { ...options, store: db.store })).outcome, 'blocked')
  let touched = false; db.store.seedOrders = async () => { touched = true }
  assert.equal((await runOfficeWorker(OWNER, { ...options, enabled: false, store: db.store })).outcome, 'skipped')
  assert.equal(touched, false)
})

test('consegna Telegram incerta non si ripete e non cambia il risultato verificato', async () => {
  const db = fakeStore([]); let sends = 0
  db.events.push({ id: 'event', user_id: OWNER, work_id: ID, event_key: 'result:1', lease_token: 'event-lease', telegram_chat_id: 'allowed',
    body: { message: 'Risultato verificato' }, status: 'pending' })
  const opts = { ...options, store: db.store, deliverNotifications: true, sendEvent: async () => { sends++; return { ok: false, error: 'timeout' } } }
  await runOfficeWorker(OWNER, opts); await runOfficeWorker(OWNER, opts)
  assert.equal(sends, 1); assert.equal(db.events[0].status, 'uncertain'); assert.equal(db.delivered.length, 1)
})

test('pianificatore registra gli esiti applicativi e segnala soltanto i veri fallimenti', async () => {
  for (const outcome of ['blocked', 'skipped', 'succeeded', 'failed'] as const) {
    let saved: any; let alerts = 0
    const deps: SchedulerDeps = { baseUrl: 'http://localhost', secret: 'test',
      fetch: async () => Response.json({ outcome, reason: 'motivo verificabile' }), claim: async () => true,
      finish: async (_job, _slot, result) => { saved = result }, alert: async () => { alerts++ } }
    await runJob(deps, { name: `work-outcome-${outcome}`, cron: '* * * * *', description: 'test', steps: [{ path: '/api/automation/office-work' }] }, NOW.toISOString())
    assert.equal(saved.outcome, outcome); assert.equal(saved.ok, outcome !== 'failed'); assert.equal(alerts, outcome === 'failed' ? 1 : 0)
  }
  assert.equal(aggregateAutomationOutcome(['skipped', 'blocked', 'failed']), 'failed')
})
