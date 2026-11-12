import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterProduction, normalizeProduction, productionOrder, productionStudioLink, PRODUCTION_PHASES } from '../src/lib/office/production'
import { loadOfficeOverview } from '../src/lib/server/office-overview'
import { ensureOfficeAgents, forgetEnsuredOfficeAgents, OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { FakeSupabase } from './fake-supabase'

const STUDIO = 'https://studiomap.speaqi.com'
const phases = (overrides: Record<string, string> = {}) => PRODUCTION_PHASES.map((key) => ({ key, state: overrides[key] || 'done', detail: `d-${key}` }))
const row = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({ slug, name, places: 10, phases: phases(), public_url: null, next: null, error: null, writing_usd: null, ...extra })

test('le righe di StudioMap si leggono solo se complete: otto fasi, slug valido', () => {
  const data = normalizeProduction({ generated_at: '2026-11-12T08:00:00Z', credit_usd: 12.345, rows: [
    row('marsiglia', 'Marsiglia', { phases: phases({ themes: 'partial', live: 'todo' }), next: { phase: 'themes', text: 'Scrivere i temi (5/8 temi)' }, writing_usd: 2.129 }),
    row('roma', 'Roma', { public_url: 'https://guides.speaqi.com/maps/romamap' }),
    row('rotta', 'Rotta', { phases: phases().slice(0, 5) }),
    row('../etc', 'Slug finto'),
    row('strana', 'Stato inventato', { phases: phases({ texts: 'boh' }) }),
  ] }, STUDIO)
  assert.ok(data.available)
  if (!data.available) return
  assert.deepEqual(data.rows.map((r) => r.slug), ['marsiglia', 'roma'])
  assert.equal(data.rows[0].done, 6)
  assert.equal(data.rows[0].live, false)
  assert.deepEqual(data.rows[0].next, { phase: 'themes', text: 'Scrivere i temi (5/8 temi)' })
  assert.equal(data.rows[0].writing_usd, 2.13)
  assert.equal(data.rows[1].live, true)
  assert.equal(data.rows[1].next, null)
  assert.deepEqual(data.totals, { cities: 2, live: 1, live_behind: 0, in_progress: 1, places: 20, writing_usd: 2.13 })
  assert.equal(data.credit_usd, 12.35)
})

test('una risposta senza righe dice che non è leggibile, non «zero città»', () => {
  assert.deepEqual(normalizeProduction({ error: 'x' }, STUDIO), { available: false, reason: 'StudioMap ha risposto in una forma inattesa.' })
  assert.equal(normalizeProduction(null, STUDIO).available, false)
})

test('Napoli resta in sola lettura anche se StudioMap non la segna: nessun passo, stima o ordine', () => {
  const data = normalizeProduction({ rows: [row('napolimap', 'Guida', { phases: phases({ intro: 'todo' }), next: { phase: 'intro', text: 'Scrivere' }, writing_usd: 3 }),
    row('golfo', 'Naples', { phases: phases({ checks: 'partial' }) })] }, STUDIO)
  assert.ok(data.available)
  if (!data.available) return
  for (const item of data.rows) {
    assert.equal(item.protected, true); assert.equal(item.next, null); assert.equal(item.writing_usd, null)
    assert.equal(productionOrder(item, 'checks'), null)
  }
  assert.equal(data.totals.in_progress, 0)
})

test('un link pubblico non https e un numero storto si scartano', () => {
  const data = normalizeProduction({ rows: [row('bologna', 'Bologna', { public_url: 'javascript:alert(1)', places: -4, writing_usd: 'tanto' })] }, STUDIO)
  assert.ok(data.available)
  if (!data.available) return
  assert.equal(data.rows[0].public_url, null); assert.equal(data.rows[0].places, 0); assert.equal(data.rows[0].writing_usd, null)
})

test('filtri e ricerca senza accenti; il link porta alla sezione della fase', () => {
  const data = normalizeProduction({ rows: [row('malaga', 'Málaga', { phases: phases({ live: 'todo' }), next: { phase: 'live', text: 'Mettere online' } }),
    row('roma', 'Roma'), row('lisbona', 'Lisbona', { phases: phases({ speaqi: 'partial' }), next: { phase: 'speaqi', text: 'Pubblicare' } })] }, STUDIO)
  assert.ok(data.available)
  if (!data.available) return
  assert.deepEqual(filterProduction(data.rows, 'progress').map((r) => r.slug), ['malaga'])
  assert.deepEqual(filterProduction(data.rows, 'behind').map((r) => r.slug), ['lisbona'])
  assert.deepEqual(filterProduction(data.rows, 'live').map((r) => r.slug), ['roma', 'lisbona'])
  assert.deepEqual(filterProduction(data.rows, 'all', 'malag').map((r) => r.slug), ['malaga'])
  assert.equal(productionStudioLink(STUDIO, 'malaga', 'themes'), 'https://studiomap.speaqi.com/?map=malaga&view=temi')
  assert.equal(productionOrder(data.rows[0], 'checks'), 'Controlla la mappa di Málaga')
  assert.equal(productionOrder(data.rows[0], 'texts'), null)
})

test('il riepilogo legge le corse una volta sola, qualunque sia il numero di agenti', async () => {
  const USER = '11111111-1111-4111-8111-111111111111'
  const agents = ['a', 'b', 'c', 'd'].map((id) => ({ id, user_id: USER, enabled: true }))
  const run = (id: string, agent_id: string, started_at: string) => ({ id, agent_id, user_id: USER, started_at, status: 'done' })
  const db = new FakeSupabase({ office_agents: agents, office_work_items: [], office_agent_outputs: [],
    office_agent_runs: [run('r1', 'a', '2026-11-01T10:00:00Z'), run('r2', 'a', '2026-11-02T10:00:00Z'), run('r3', 'c', '2026-10-30T10:00:00Z')] },
    { office_budget_summary: () => [] })
  let reads = 0
  const from = db.from.bind(db)
  ;(db as any).from = (table: string) => { if (table === 'office_agent_runs') reads++; return from(table) }
  const result = await loadOfficeOverview(db as any, USER)
  assert.equal(reads, 1)
  assert.deepEqual(result.agents.map((agent) => agent.last_run?.id || null), ['r2', null, 'r3', null])
})

test('il registro degli agenti si controlla una volta per processo', async () => {
  const USER = '22222222-2222-4222-8222-222222222222'
  const previous = process.env.AUTOMATION_WORKSPACE_USER_ID
  process.env.AUTOMATION_WORKSPACE_USER_ID = USER
  forgetEnsuredOfficeAgents()
  try {
    const db = new FakeSupabase({ office_agents: [] })
    let calls = 0
    const from = db.from.bind(db)
    ;(db as any).from = (table: string) => { calls++; return from(table) }
    await ensureOfficeAgents(db as any, USER)
    assert.equal(calls, 2)
    await ensureOfficeAgents(db as any, USER)
    await ensureOfficeAgents(db as any, USER)
    assert.equal(calls, 2)
    const rows = await db.from('office_agents').select('id').eq('user_id', USER)
    assert.equal((rows.data || []).length, Object.keys(OFFICE_AGENT_DEFINITIONS).length)
    // Un agente che appartiene a un altro workspace ferma tutto, e il controllo si rifà.
    forgetEnsuredOfficeAgents()
    const foreign = new FakeSupabase({ office_agents: [{ ...OFFICE_AGENT_DEFINITIONS.director, user_id: 'altro' }] })
    await assert.rejects(() => ensureOfficeAgents(foreign as any, USER), /altro workspace/)
  } finally { process.env.AUTOMATION_WORKSPACE_USER_ID = previous; forgetEnsuredOfficeAgents() }
})
