import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDemoWork } from '../src/lib/server/office-work-demo'
import { FakeSupabase } from './fake-supabase'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import type { OfficeWorkItem } from '../src/lib/office-work'

const user = '11111111-1111-4111-8111-111111111111'
const workId = '22222222-2222-4222-8222-222222222222'
const ledger = '33333333-3333-4333-8333-333333333333'
const work = { id: workId, user_id: user, agent_id: 'demo_builder', action: 'create_demo', payload: { city: 'Buenos Aires', slug: 'buenos-aires' }, checkpoint: {}, lease_token: 'lease' } as unknown as OfficeWorkItem
const context = { agent: { ...OFFICE_AGENT_DEFINITIONS.demo_builder, user_id: user }, runId: 'run', reserve: async (n: number) => { assert.equal(n, 900); return ledger }, assertActive: async () => {} } as AgentContext

test('riserva prima del job e attende la ricevuta senza ripetere la spesa', async () => {
  const db = new FakeSupabase({ office_budget_ledger: [{ id: ledger, user_id: user, agent_id: 'demo_builder', reserved_cents: 900, actual_cents: null }] }, {
    office_work_transition: () => ({}), settle_agent_budget: () => null,
  })
  let calls = 0
  const bridge = (async (_path: string, body: { request_id: string }) => {
    calls++; assert.equal(body.request_id, workId)
    return calls === 1 ? { job_id: `office-demo-${workId}`, done: false }
      : { job_id: `office-demo-${workId}`, done: true, result: { slug: 'buenos-aires', city: 'Buenos Aires', complete: true,
        point_count: 10, theme_count: 7, google_usd: 1, theme_usd: 0.5, map_ai_usd: 2 } }
  }) as never
  const first = await createDemoWork(context, work, db, bridge)
  assert.equal(first.reason_code, 'demo_running'); assert.equal(first.checkpoint?.demo_ledger_id, ledger)
  const second = await createDemoWork(context, { ...work, checkpoint: first.checkpoint! }, db, bridge)
  assert.equal(second.status, 'succeeded'); assert.equal(second.result?.point_count, 10)
  const settlement = db.calls.find((c) => c.rpc === 'settle_agent_budget')
  assert.equal(settlement?.args.p_actual_cents, 350)
})

test('una ricevuta incompleta non viene dichiarata riuscita', async () => {
  const db = new FakeSupabase({ office_budget_ledger: [{ id: ledger, user_id: user, agent_id: 'demo_builder', reserved_cents: 900, actual_cents: null }] }, { settle_agent_budget: () => null })
  const bridge = (async () => ({ job_id: `office-demo-${workId}`, done: true, result: { slug: 'buenos-aires', city: 'Buenos Aires', complete: false,
    point_count: 8, theme_count: 7, google_usd: 1, theme_usd: 0.5, map_ai_usd: 2 } })) as never
  assert.equal((await createDemoWork(context, { ...work, checkpoint: { demo_ledger_id: ledger } }, db, bridge)).status, 'blocked')
})

test('la migrazione consente la demo senza cambiare le azioni precedenti', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const { readFile } = await import('node:fs/promises')
  const db = new PGlite()
  try {
    await db.exec(await readFile('supabase/migrations/20261031153410_office_demo_work.sql', 'utf8'))
    const result = await db.query<{ demo: boolean; legacy: boolean; bad: boolean }>("select public.office_work_action_allowed('demo_builder','create_demo') as demo, public.office_work_action_allowed('mymaps_builder','import_mymaps') as legacy, public.office_work_action_allowed('demo_builder','send_email') as bad")
    assert.deepEqual(result.rows[0], { demo: true, legacy: true, bad: false })
  } finally { await db.close() }
})

test('una spesa superiore alla riserva viene registrata e richiede verifica', async () => {
  const db = new FakeSupabase({ office_budget_ledger: [{ id: ledger, user_id: user, agent_id: 'demo_builder', reserved_cents: 900, actual_cents: null }] }, { settle_agent_budget: () => null })
  const bridge = (async () => ({ job_id: `office-demo-${workId}`, done: true, result: { slug: 'buenos-aires', city: 'Buenos Aires', complete: true,
    point_count: 10, theme_count: 7, google_usd: 3, theme_usd: 2, map_ai_usd: 5 } })) as never
  const result = await createDemoWork(context, { ...work, checkpoint: { demo_ledger_id: ledger } }, db, bridge)
  assert.equal(result.reason_code, 'demo_cost_overrun')
  assert.equal(db.calls.find((c) => c.rpc === 'settle_agent_budget')?.args.p_actual_cents, 1000)
})

test('accetta la mappa esistente senza chiedere una copia né ridurre i luoghi già presenti', async () => {
  const db = new FakeSupabase({ office_budget_ledger: [{ id: ledger, user_id: user, agent_id: 'demo_builder', reserved_cents: 900, actual_cents: null }] }, { settle_agent_budget: () => null })
  const bridge = (async () => ({ job_id: `office-demo-${workId}`, done: true, result: { slug: 'buenos-aires', city: 'Buenos Aires', complete: true,
    point_count: 12, theme_count: 7, google_usd: 0, theme_usd: 0.5, map_ai_usd: 0 } })) as never
  const result = await createDemoWork(context, { ...work, checkpoint: { demo_ledger_id: ledger } }, db, bridge)
  assert.equal(result.status, 'succeeded'); assert.equal(result.result?.map_slug, 'buenos-aires'); assert.equal(result.result?.point_count, 12)
})
