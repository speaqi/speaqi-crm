import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterProduction, normalizeProduction, normalizeProductionJob, normalizeProductionPlan, productionActionFor, productionOrder, productionQuestion, productionReply, productionStudioLink, looksLikeProductionQuestion, isProductionAction, isProductionSlug, isRequestId, PRODUCTION_PHASES } from '../src/lib/office/production'
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

test('Napoli è una città come le altre: in sola lettura solo ciò che StudioMap segna protetto', () => {
  const data = normalizeProduction({ rows: [row('napolimap', 'Guida', { phases: phases({ intro: 'todo' }), next: { phase: 'intro', text: 'Scrivere' }, writing_usd: 3 }),
    row('golfo', 'Naples', { phases: phases({ checks: 'partial' }), protected: true })] }, STUDIO)
  assert.ok(data.available)
  if (!data.available) return
  const [napoli, protetta] = data.rows
  assert.equal(napoli.protected, false); assert.equal(napoli.next?.phase, 'intro'); assert.equal(napoli.writing_usd, 3)
  assert.equal(protetta.protected, true); assert.equal(protetta.next, null); assert.equal(protetta.writing_usd, null)
  assert.equal(productionOrder(protetta, 'checks'), null)
  assert.equal(productionOrder(napoli, 'checks'), 'Controlla la mappa di Guida')
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

test('ogni fase ha il suo comando; le città protette e le fasi concluse nessuno', () => {
  const phase = (key: string, state: string) => ({ key, state, detail: '' }) as any
  const row = { protected: false }
  assert.equal(productionActionFor(row, phase('texts', 'partial')), 'write_texts')
  assert.equal(productionActionFor(row, phase('themes', 'todo')), 'write_guide')
  assert.equal(productionActionFor(row, phase('intro', 'todo')), 'write_guide')
  assert.equal(productionActionFor(row, phase('speaqi', 'todo')), 'publish')
  assert.equal(productionActionFor(row, phase('live', 'partial')), 'go_live')
  assert.equal(productionActionFor(row, phase('live', 'todo')), null)
  assert.equal(productionActionFor(row, phase('places', 'todo')), null)
  assert.equal(productionActionFor(row, phase('texts', 'done')), null)
  assert.equal(productionActionFor({ protected: true }, phase('texts', 'partial')), null)
})

test('comando, slug e identificativo si accettano solo nella forma chiusa', () => {
  assert.equal(isProductionAction('publish'), true); assert.equal(isProductionAction('delete'), false)
  assert.equal(isProductionSlug('marseille-shadow'), true); assert.equal(isProductionSlug('../x'), false)
  assert.equal(isRequestId('11111111-1111-4111-8111-111111111111'), true); assert.equal(isRequestId('abc'), false)
})

test('piano e stato di StudioMap si leggono con prudenza', () => {
  const plan = normalizeProductionPlan({ plan: { name: 'Marsiglia', allowed: true, reason: '3 temi', estimate_usd: 1.594, estimate_max_usd: 1, warning: '' }, credit_usd: 12 }, 'write_guide')
  assert.deepEqual(plan, { action: 'write_guide', name: 'Marsiglia', allowed: true, reason: '3 temi', estimate_usd: 1.59, estimate_max_usd: 1.59, warning: null, credit_usd: 12 })
  assert.equal(normalizeProductionPlan({ plan: { allowed: 'si' } }, 'publish'), null)
  assert.deepEqual(normalizeProductionJob({ done: false, phase: '2/4 Punti…', last: 'x'.repeat(400) })?.last?.length, 300)
  assert.equal(normalizeProductionJob({ job_id: 'x' }), null)
})

test('le domande sulla produzione: città riconosciuta, quadro generale, mai un ordine', () => {
  const rows = [{ slug: 'amalfi', name: 'Amalfi' }, { slug: 'costiera', name: 'Costiera Amalfitana' }, { slug: 'lisbona', name: 'Lisbona' }]
  assert.deepEqual(productionQuestion('Cosa manca a Lisbona?', rows), { kind: 'city', slug: 'lisbona' })
  assert.deepEqual(productionQuestion('a che punto è la Costiera Amalfitana', rows), { kind: 'city', slug: 'costiera' })
  assert.deepEqual(productionQuestion('A che punto sono le mappe?', rows), { kind: 'all' })
  assert.deepEqual(productionQuestion('quali città sono pronte', rows), { kind: 'all' })
  assert.equal(productionQuestion('Controlla la mappa di Lisbona', rows), null)
  assert.equal(productionQuestion('Come stiamo?', rows), null)
  assert.equal(productionQuestion('come va la pipeline', rows), null)
  assert.equal(looksLikeProductionQuestion('Prepara la presentazione per Lisbona'), false)
  assert.equal(looksLikeProductionQuestion('cosa manca a Lisbona'), true)
})

test('la risposta su una città dice fatto, manca e prossimo passo, coi numeri di StudioMap', () => {
  const data = normalizeProduction({ credit_usd: 8, rows: [
    row('lisbona', 'Lisbona', { phases: phases({ themes: 'partial', speaqi: 'todo', live: 'todo' }), next: { phase: 'themes', text: 'Scrivere i temi (5/8 temi)' }, writing_usd: 1.2 }),
    row('roma', 'Roma')] }, STUDIO)
  const city = productionReply(data, { kind: 'city', slug: 'lisbona' }, 'https://crm.speaqi.com/ufficio')
  assert.match(city, /^Lisbona — 5\/8 fasi\./)
  assert.match(city, /Manca: Temi \(d-themes\), Su Speaqi \(d-speaqi\), Online \(d-live\)\./)
  assert.match(city, /Prossimo passo: Scrivere i temi \(5\/8 temi\)\./)
  assert.match(city, /circa 1,20 \$/)
  const all = productionReply(data, { kind: 'all' }, 'https://crm.speaqi.com/ufficio')
  assert.match(all, /2 città, 1 online, 1 in produzione/)
  assert.match(all, /• Lisbona 5\/8 — Scrivere i temi/)
  assert.match(productionReply({ available: false, reason: 'StudioMap non risponde.' }, { kind: 'all' }, 'x'), /Non riesco a leggere StudioMap/)
})

test('il comando verso StudioMap: piano, rifiuto col motivo, esito incerto senza ritentare', async () => {
  const { officeProductionCommand } = await import('../src/lib/server/office-production')
  const previous = { secret: process.env.OFFICE_BRIDGE_SECRET, url: process.env.OFFICE_STUDIOMAP_URL, fetch: globalThis.fetch }
  process.env.OFFICE_BRIDGE_SECRET = 'segreto-di-prova-lungo-almeno-32-caratteri'
  delete process.env.OFFICE_STUDIOMAP_URL
  const calls: Array<{ url: string; body: any; auth: string | null }> = []
  let reply: () => Response = () => Response.json({})
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') })
    return reply()
  }) as typeof fetch
  const input = { request_id: '11111111-1111-4111-8111-111111111111', slug: 'marsiglia', action: 'write_guide' as const }
  try {
    reply = () => Response.json({ plan: { name: 'Marsiglia', allowed: true, reason: '3 temi', estimate_usd: 0.8, estimate_max_usd: 1.4, warning: null }, credit_usd: 20 })
    const planned = await officeProductionCommand({ ...input, dry_run: true })
    assert.ok(planned.ok && 'plan' in planned && planned.plan.estimate_max_usd === 1.4)
    assert.equal(calls[0].url, 'https://studiomap.speaqi.com/api/office/production/run')
    assert.deepEqual(calls[0].body, { ...input, dry_run: true })
    assert.equal(calls[0].auth, 'Bearer segreto-di-prova-lungo-almeno-32-caratteri')

    reply = () => Response.json({ job_id: 'x', done: false, phase: 'Scrivere temi e presentazione', last: 'Avvio', error: null }, { status: 202 })
    const started = await officeProductionCommand({ ...input, dry_run: false })
    assert.ok(started.ok && 'job' in started && started.job.done === false)
    assert.equal('dry_run' in calls[1].body, false)

    reply = () => Response.json({ error: 'Credito OpenRouter insufficiente (2.10 $): ricarica e riprova.' }, { status: 400 })
    const refused = await officeProductionCommand({ ...input, dry_run: false })
    assert.deepEqual(refused, { ok: false, status: 409, error: 'Credito OpenRouter insufficiente (2.10 $): ricarica e riprova.' })

    reply = () => Response.json({ error: 'boom' }, { status: 500 })
    const uncertain = await officeProductionCommand({ ...input, dry_run: false })
    assert.ok(!uncertain.ok && uncertain.status === 502 && /Esito incerto/.test(uncertain.error) && /Lavorazioni/.test(uncertain.error))
    assert.equal(calls.length, 4, 'nessun ritentativo automatico')

    delete process.env.OFFICE_BRIDGE_SECRET
    const off = await officeProductionCommand({ ...input, dry_run: true })
    assert.ok(!off.ok && off.status === 503)
    assert.equal(calls.length, 4)
  } finally {
    globalThis.fetch = previous.fetch
    if (previous.secret) process.env.OFFICE_BRIDGE_SECRET = previous.secret; else delete process.env.OFFICE_BRIDGE_SECRET
    if (previous.url) process.env.OFFICE_STUDIOMAP_URL = previous.url
  }
})

test('campus: la fotografia per il 3D porta città, comando, sistema e la giornata, senza link', async () => {
  const { officeSceneSnapshot, officeSceneProduction } = await import('../src/lib/office-scene')
  const phases = (states: string) => ['places', 'texts', 'themes', 'intro', 'routes', 'checks', 'speaqi', 'live'].map((key, i) => ({ key, state: states[i] === 'd' ? 'done' : states[i] === 'p' ? 'partial' : 'todo', detail: 'x' }))
  const row = (slug: string, states: string, extra: object = {}) => ({ slug, name: slug, protected: false, live: states[7] === 'd', public_url: 'https://guides.speaqi.com/x', places: 10,
    phases: phases(states), done: [...states].filter((c) => c === 'd').length, next: states === 'dddddddd' ? null : { phase: 'texts', text: 'Scrivere i testi' }, error: null, writing_usd: 1, ...extra })
  const production = { available: true, generated_at: '2026-11-12T08:00:00Z', studio_url: 'https://studiomap.speaqi.com', credit_usd: 3.5,
    totals: { cities: 4, live: 2, live_behind: 1, in_progress: 1, places: 40, writing_usd: 1 },
    rows: [row('napoli', 'dddddddd', { protected: true }), row('roma', 'dddddddd'), row('capri', 'dddddpdd'), row('lisbona', 'dptttttt', { error: 'invio fallito' })] } as never
  const scene = officeSceneProduction(production)!
  assert.ok(scene.available)
  // Prima chi è in produzione, poi le online con arretrati, poi le allineate; la protetta in fondo.
  assert.deepEqual(scene.cities.map((c) => c.slug), ['lisbona', 'capri', 'roma', 'napoli'])
  assert.equal(scene.cities[0].phases, 'dptttttt'); assert.equal(scene.cities[0].error, true)
  assert.equal(JSON.stringify(scene).includes('http'), false)
  assert.deepEqual(officeSceneProduction({ available: false, reason: 'giù' }), { available: false, reason: 'giù' })
  assert.equal(officeSceneProduction(null), null)
  const run = (id: string, started_at: string) => ({ id, agent_id: 'director', user_id: 'u', started_at, finished_at: null, status: 'done', summary: id, items_created: 1, cost_cents_reserved: 0, cost_cents_actual: 0, error: null, details: {} })
  const overview = { agents: [], runs: [run('sera', '2026-11-12T20:00:00Z'), run('mattina', '2026-11-12T07:30:00Z'), run('ieri', '2026-11-11T21:00:00Z'), run('notte', '2026-11-11T23:30:00Z')], outputs: [], pending_count: 0,
    totals: { day_actual: 0, day_reserved: 0, week_actual: 0, week_reserved: 0, month_actual: 0, month_reserved: 0 }, active_agents: 0 } as never
  const snapshot = officeSceneSnapshot(overview, '2026-11-12T21:00:00Z', { production,
    command: { slug: 'lisbona', name: 'Lisbona', action: 'write_texts', phase: 'Testi', last: '', done: false, error: null },
    system: { schedulerOn: true, schedulerJobs: 'backup', lastBackupAt: null, backupOk: null } })
  // La giornata è quella di Roma: le 23:30 UTC di ieri sono già oggi, le 21:00 UTC no.
  assert.deepEqual(snapshot.day.map((r) => r.id), ['notte', 'mattina', 'sera'])
  assert.equal(snapshot.command?.label, 'Scrivi i testi')
  assert.equal(snapshot.system?.schedulerJobs, 'backup')
  assert.equal(officeSceneSnapshot(overview).production, null)
})
