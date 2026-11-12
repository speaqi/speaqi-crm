import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadOfficeOverview } from '../src/lib/server/office-overview'
import { FakeSupabase } from './fake-supabase'
import { createClient } from '@supabase/supabase-js'

const USER = '11111111-1111-4111-8111-111111111111'

test('il riepilogo conta le decisioni separatamente dagli avvisi senza perderli', async () => {
  const row = (id: string, kind: string, body: object, user = USER) => ({ id, kind, body, user_id: user,
    status: 'pending', agent_id: 'director', created_at: '2026-10-30T12:00:00Z' })
  const db = new FakeSupabase({ office_agents: [], office_agent_runs: [], office_work_items: [], office_agent_outputs: [
    row('decision', 'proposal', {}), row('report', 'report', {}), row('action-report', 'report', { action: 'check' }),
    row('other-workspace', 'proposal', {}, 'other'),
  ] }, { office_budget_summary: () => [] })
  const result = await loadOfficeOverview(db as any, USER)
  assert.equal(result.pending_count, 3)
  assert.equal(result.decision_count, 2)
  assert.equal(result.outputs.length, 3)
})

test('oltre la prima pagina il numero di decisioni arriva da una query dedicata al workspace', async () => {
  const requests: URL[] = []
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); requests.push(url)
    if (url.pathname.includes('/rpc/office_budget_summary')) return Response.json([])
    if (url.pathname.endsWith('/office_agent_outputs')) {
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '0-0/37' } })
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: `o-${i}`, kind: 'report', body: {} }))
      return Response.json(rows, { headers: { 'content-range': '0-49/70' } })
    }
    return Response.json([])
  }
  const db = createClient('https://office-test.invalid', 'test', { global: { fetch: fetcher as typeof fetch } })
  const result = await loadOfficeOverview(db, USER)
  assert.equal(result.pending_count, 70)
  assert.equal(result.decision_count, 37)
  const count = requests.find((url) => url.searchParams.has('or'))!
  assert.equal(count.searchParams.get('user_id'), `eq.${USER}`)
  assert.match(count.searchParams.get('or') || '', /body->>action\.not\.is\.null/)
})
