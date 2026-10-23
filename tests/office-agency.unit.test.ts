import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { FakeSupabase } from './fake-supabase'
import { agencyHandler } from '../src/lib/server/office-agents/agency'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { AUTOMATION_JOBS, dueJobs } from '../src/lib/automation-schedule'
import { agencyQueue, agencyServices, agencyTodo } from '../src/lib/office/agency'
import { modelCostCents, OFFICE_MODEL_PRICES } from '../src/lib/office-pricing'
import { loadMaterials } from '../src/lib/server/agency'
import { normalizeSlides } from '../src/lib/agency'

const OWNER = '11111111-1111-4111-8111-111111111111', CONTACT = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-10-23T10:00:00Z'), OLD = '2026-10-01T10:00:00Z'
const brief = 'Un sito, branding e AI. Il brief cita le mappe Speaqi e Napoli.'
const slides = normalizeSlides([{ id: 'cover', kind: 'cover', title: 'Un progetto da costruire insieme' },
  { id: 'solution', kind: 'solution', title: 'Risultati', body: 'Aumento delle vendite del 90%', items: [] },
  { id: 'investment', kind: 'investment', title: 'Investimento', body: 'Costo 9000 euro', items: [{ title: 'Prezzo', value: '9000 €' }] },
  { id: 'closing', kind: 'closing', title: 'I prossimi passi' }])
const savedEnv = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_AGENCY_MODEL: process.env.OPENAI_AGENCY_MODEL, APP_BASE_URL: process.env.APP_BASE_URL, OFFICE_USD_TO_EUR: process.env.OFFICE_USD_TO_EUR }
beforeEach(() => { process.env.OPENAI_API_KEY = 'simulata'; process.env.OPENAI_AGENCY_MODEL = 'gpt-5.1'; process.env.APP_BASE_URL = 'https://crm.example.org'; process.env.OFFICE_USD_TO_EUR = '1' })
afterEach(() => { mock.restoreAll(); for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })

/** Soltanto default del DDL: le funzioni Agency e il trasporto comune restano reali. */
class AgencyDb extends FakeSupabase {
  override from(table: string) {
    const query = super.from(table), insert = query.insert.bind(query)
    query.insert = (raw: any) => {
      const defaults = table === 'agency_projects' ? { assets: [], analysis: {}, stage: 'brief', version: 1, updated_at: NOW.toISOString() }
        : table === 'agency_presentations' ? { status: 'draft', version: 1, approved_at: null, generated_at: null, updated_at: NOW.toISOString(), public_token: 'public-token', error: null, warnings: [] } : {}
      const rows = (Array.isArray(raw) ? raw : [raw]).map((row: any) => ({ ...defaults, ...row }))
      return insert(Array.isArray(raw) ? rows : rows[0])
    }
    return query
  }
}
function fixture(queue: unknown[] = [{ contact_id: CONTACT, brief, services: ['sito', 'branding', 'inventato'] }]) {
  const order: string[] = [], reserves: number[] = [], settlements: any[] = []
  const db = new AgencyDb({ contacts: [{ id: CONTACT, user_id: OWNER, name: 'Cliente', company: 'Cliente srl', email: 'cliente@example.it', contact_scope: 'crm', hidden: false }],
    agency_projects: [], agency_presentations: [], agency_service_categories: [{ user_id: OWNER, slug: 'siti-web', name: 'Siti web', description: '', is_active: true }, { user_id: OWNER, slug: 'branding', name: 'Branding', description: '', is_active: true }],
    deals: [{ id: randomUUID(), user_id: OWNER, contact_id: CONTACT, closed_at: null, created_at: OLD }],
    office_agency_items: [], office_agency_deliveries: [], office_agent_outputs: [], quotes: [], email_drafts: [], activities: [], quote_signatures: [] })
  db.rpcs.claim_office_agency_item = ({ p_key, p_project_id }) => {
    let row = db.tables.office_agency_items.find((r) => r.item_key === p_key)
    if (!row) { row = { id: randomUUID(), user_id: OWNER, item_key: p_key, project_id: p_project_id || randomUUID(), presentation_id: randomUUID(), generation_state: 'pending' }; db.tables.office_agency_items.push(row) }
    return { ...row }
  }
  db.rpcs.claim_office_agency_generation = ({ p_item_id }) => { const row = db.tables.office_agency_items.find((r) => r.id === p_item_id)!; if (row.generation_state !== 'pending') return false; row.generation_state = 'running'; return true }
  db.rpcs.finish_office_agency_generation = ({ p_item_id, p_state }) => { db.tables.office_agency_items.find((r) => r.id === p_item_id)!.generation_state = p_state; return true }
  db.rpcs.create_office_email_draft = (args) => {
    if (db.tables.office_agency_deliveries.some((r) => r.delivery_key === args.p_key)) return { created: false }
    if (db.tables.email_drafts.some((r) => r.contact_id === args.p_contact_id && r.status === 'pending')) return { created: false, reason: 'pending_draft' }
    const id = randomUUID(); db.tables.email_drafts.push({ id, user_id: OWNER, contact_id: args.p_contact_id, body_text: args.p_text, subject: args.p_subject, source: 'office', status: 'pending' }); db.tables.office_agency_deliveries.push({ user_id: OWNER, delivery_key: args.p_key }); return { id, created: true }
  }
  const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.agency, user_id: OWNER, settings: { queue } }, runId: randomUUID(),
    async reserve(cents) { order.push('reserve'); reserves.push(cents); return 'ledger' }, async settle(id, cents, usage) { order.push('settle'); settlements.push({ id, cents, usage }) },
    async addOutput(output) { const id = randomUUID(); db.tables.office_agent_outputs.push({ ...output, id, user_id: OWNER, agent_id: 'agency', output_key: output.key, status: 'pending' }); return id }, log() {} }
  return { db, ctx, order, reserves, settlements, handler: agencyHandler(db, { now: () => NOW }) }
}
function provider(f: ReturnType<typeof fixture>) {
  return mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses', 'nessuna API mappe o altra rete')
    f.order.push('provider'); const body = JSON.parse(String(init?.body))
    assert.equal(body.model, process.env.OPENAI_AGENCY_MODEL); assert.equal(body.max_output_tokens, 12000)
    assert.equal(body.text.format.name, 'agency_presentation'); assert.equal(body.store, false)
    return Response.json({ status: 'completed', usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 500 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ slides, analysis: {}, title: 'Proposta', style: 'editorial' }) }] }] })
  })
}

test('agenzia: coda esclusiva validata, UUID deduplicati, servizi soltanto da categorie attive', () => {
  const parsed = agencyQueue([{ contact_id: CONTACT, brief, services: ['sito'] }, { contact_id: CONTACT, brief, services: [] }, { agency_project_id: OWNER }, { agency_project_id: OWNER, contact_id: CONTACT }, { contact_id: 'x' }])
  assert.equal(parsed.entries.length, 2); assert.equal(parsed.rejected.length, 2); assert.equal(parsed.entries[0].brief, brief)
  assert.deepEqual(agencyServices(['sito', 'SEO', 'GEO', 'nuovo', 'branding'], [{ slug: 'siti-web', is_active: true }, { slug: 'seo-geo', is_active: true }, { slug: 'branding', is_active: false }]), ['siti-web', 'seo-geo'])
})
test('agenzia: registrazione spenta, budget, cron Rome e listino verificato', () => {
  const agent = OFFICE_AGENT_DEFINITIONS.agency
  assert.equal(agent.enabled, false); assert.equal(agent.department, 'agenzia')
  assert.deepEqual([agent.daily_budget_cents, agent.weekly_budget_cents, agent.monthly_budget_cents], [200, 1000, 4000])
  const job = AUTOMATION_JOBS.find((j) => j.name === 'office-agency')!
  assert.equal(job.cron, '15 8 * * 1-5'); assert.equal(job.timeZone, 'Europe/Rome'); assert.equal(job.steps[0].path, '/api/automation/agents/agency/run')
  for (const date of ['2026-10-23T06:15:00Z', '2026-10-26T07:15:00Z']) assert.ok(dueJobs(new Date(date), 'UTC').some((j) => j.name === 'office-agency'))
  assert.ok(!dueJobs(new Date('2026-10-24T06:15:00Z'), 'UTC').some((j) => j.name === 'office-agency'))
  assert.deepEqual(OFFICE_MODEL_PRICES['gpt-5.1'], { input: 1.25, cachedInput: 0.125, output: 10 })
  assert.equal(modelCostCents('gpt-5.1', 1_000_000, 1_000_000), 1125)
  assert.equal(modelCostCents('gpt-5.1', 1_000_000, 0, 1, 1_000_000), 13)
  assert.throws(() => modelCostCents('sconosciuto', 1, 1), /senza listino/)
})
test('contatto → progetto e presentazione unici: callModel riserva prima, salda dai token, mai approva', async () => {
  const f = fixture(), fetch = provider(f)
  await f.handler(f.ctx); f.ctx.runId = randomUUID(); await f.handler(f.ctx)
  assert.equal(fetch.mock.callCount(), 1); assert.deepEqual(f.order, ['reserve', 'provider', 'settle'])
  assert.ok(f.reserves[0] <= 200, 'la generazione ordinaria entra nel budget iniziale')
  assert.equal(f.settlements[0].cents, 1); assert.equal(f.settlements[0].usage.cachedTokens, 500)
  assert.equal(f.db.tables.contacts.length, 1); assert.equal(f.db.tables.agency_projects.length, 1); assert.equal(f.db.tables.agency_presentations.length, 1)
  const project = f.db.tables.agency_projects[0], deck = f.db.tables.agency_presentations[0]
  assert.equal(project.brief, brief); assert.deepEqual(project.services, ['siti-web', 'branding']); assert.equal(project.deal_id, f.db.tables.deals[0].id)
  assert.equal(deck.status, 'ready'); assert.equal(deck.approved_at, null); assert.equal(f.db.tables.quotes.length, 0); assert.equal(f.db.tables.email_drafts.length, 0)
  assert.match(JSON.stringify(deck.slides), /DA VERIFICARE/); assert.equal(JSON.stringify(deck.slides.find((s: any) => s.kind === 'investment')).includes('9000'), false)
  const review = f.db.tables.office_agent_outputs.find((o) => o.target_table === 'agency_presentations')!
  assert.equal(review.body.presentazione, `https://crm.example.org/agency/presentazioni/${deck.id}`); assert.equal(review.body.preventivo_mancante, true)
  assert.equal(review.body.crea_preventivo, `https://crm.example.org/preventivi?agency_project=${project.id}`)
  assert.ok(review.body.segnaposto > 0); assert.ok(review.body.dove.length > 0)
})
test('budget esaurito: nessun provider, ripresa con gli stessi ID; massimo due elementi lavorati', async () => {
  const f = fixture(), fetch = provider(f), reserve = f.ctx.reserve
  f.ctx.reserve = async () => { throw new BudgetExceeded() }
  await assert.rejects(f.handler(f.ctx), BudgetExceeded)
  assert.equal(fetch.mock.callCount(), 0); assert.equal(f.db.tables.office_agency_items[0].generation_state, 'pending')
  const project = f.db.tables.agency_projects[0].id, deck = f.db.tables.agency_presentations[0].id
  f.ctx.reserve = reserve; await f.handler(f.ctx)
  assert.equal(f.db.tables.agency_projects[0].id, project); assert.equal(f.db.tables.agency_presentations[0].id, deck); assert.equal(fetch.mock.callCount(), 1)
  const capped = fixture([]); provider(capped)
  for (let i = 0; i < 3; i++) { const id = randomUUID(); capped.db.tables.contacts.push({ ...capped.db.tables.contacts[0], id }); (capped.ctx.agent.settings.queue as any[]).push({ contact_id: id, brief, services: [] }) }
  await capped.handler(capped.ctx); assert.equal(capped.db.tables.agency_projects.length, 2)
})
test('timeout conserva riserva e stato incerto, retry non paga e non rigenera', async () => {
  const f = fixture(), fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Timeout simulato') })
  await assert.rejects(f.handler(f.ctx), /Timeout simulato/); await f.handler(f.ctx)
  assert.equal(fetch.mock.callCount(), 1); assert.equal(f.settlements.length, 0); assert.equal(f.db.tables.office_agency_items[0].generation_state, 'uncertain')
  assert.equal(f.db.tables.agency_presentations[0].status, 'failed'); assert.equal(f.db.tables.agency_presentations[0].approved_at, null)
})
test('modello configurato senza prezzo ferma la corsa prima del provider', async () => {
  const f = fixture(), fetch = provider(f); process.env.OPENAI_AGENCY_MODEL = 'non-prezzato'
  await assert.rejects(f.handler(f.ctx), /senza listino/); assert.equal(fetch.mock.callCount(), 0); assert.equal(f.reserves.length, 0)
})
test('bozza proposta soltanto dopo approvazione umana e preventivo sent/accepted, nessun invio e nessun duplicato', async () => {
  for (const state of ['sent', 'accepted']) {
    const f = fixture(); provider(f); await f.handler(f.ctx)
    const deck = f.db.tables.agency_presentations[0], project = f.db.tables.agency_projects[0]
    const quote = { id: randomUUID(), user_id: OWNER, contact_id: CONTACT, agency_project_id: project.id, status: 'draft', sent_at: NOW.toISOString(), quote_number: 'PRV-1' }
    f.db.tables.quotes.push(quote); deck.quote_id = quote.id
    await f.handler(f.ctx); assert.equal(f.db.tables.email_drafts.length, 0)
    deck.status = 'approved'; deck.approved_at = NOW.toISOString(); await f.handler(f.ctx); assert.equal(f.db.tables.email_drafts.length, 0)
    quote.status = state; await f.handler(f.ctx); await f.handler(f.ctx)
    assert.equal(f.db.tables.email_drafts.length, 1); const draft = f.db.tables.email_drafts[0]
    assert.equal(draft.source, 'office'); assert.equal(draft.status, 'pending'); assert.match(draft.body_text, /https:\/\/crm.example.org\/proposta\/public-token/)
    assert.equal(quote.status, state); assert.equal(deck.status, 'approved'); assert.equal(f.db.tables.office_agent_outputs.filter((o) => o.kind === 'draft_email').length, 1)
  }
})
test('coda vuota: report e follow-up gratuiti, attività recente esclude opportunità ferma', async () => {
  const f = fixture([]), fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('non deve chiamare modelli o mappe') })
  const stale = { id: randomUUID(), user_id: OWNER, contact_id: CONTACT, title: 'Progetto fermo', stage: 'proposal', created_at: OLD, updated_at: OLD }
  f.db.tables.agency_projects.push(stale)
  f.db.tables.quotes.push({ id: randomUUID(), user_id: OWNER, agency_project_id: stale.id, contact_id: CONTACT, status: 'sent', sent_at: OLD, quote_number: 'PRV-2' })
  await f.handler(f.ctx); await f.handler(f.ctx)
  assert.equal(fetch.mock.callCount(), 0); assert.equal(f.reserves.length, 0); assert.equal(f.db.tables.email_drafts.length, 1)
  const daily = f.db.tables.office_agent_outputs.find((o) => o.kind === 'report')!
  assert.equal(daily.body.ferme_oltre_10_giorni.length, 1); assert.equal(daily.body.preventivi_senza_risposta_oltre_7_giorni.length, 1)
  assert.equal(f.db.tables.office_agent_outputs.filter((o) => o.output_key.startsWith('agency:day:')).length, 1)
  const recent = fixture([]); recent.db.tables.agency_projects.push(stale); recent.db.tables.activities.push({ user_id: OWNER, contact_id: CONTACT, created_at: NOW.toISOString() }); await recent.handler(recent.ctx)
  assert.equal(recent.db.tables.office_agent_outputs[0].body.ferme_oltre_10_giorni.length, 0)
})
test('presentazione già generating non si duplica; materiali multimediali esclusi prima di scaricarli', async () => {
  const f = fixture(); provider(f); await f.handler(f.ctx)
  f.db.tables.agency_presentations[0].status = 'generating'; f.db.tables.office_agency_items = []
  f.ctx.reserve = async () => { throw new Error('non deve prenotare') }; await f.handler(f.ctx)
  assert.equal(f.db.tables.agency_presentations.length, 1)
  const materials = await loadMaterials({} as any, { assets: [{ kind: 'photo', name: 'Foto', path: 'x' }, { kind: 'document', mime: 'application/pdf', name: 'PDF', path: 'y' }] } as any, true)
  assert.equal(materials.skipped.length, 2); assert.deepEqual(materials.materials.documents, [])
  const todo = agencyTodo(slides, false); assert.ok(todo.locations.some((p) => p.field === 'preventivo collegato'))
})
