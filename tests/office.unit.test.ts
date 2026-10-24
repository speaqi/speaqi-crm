import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import assert from 'node:assert/strict'
import { describe, test, mock } from 'node:test'
import { estimateModelCost, modelCostCents } from '../src/lib/office-pricing'
import { officeAgentPatch, type OfficeAgent, type OfficeRun } from '../src/lib/office'
import { BudgetExceeded, callModel, creditCostCents, runAgent, toOpenRouterModel, type AgentContext, type OfficeStore } from '../src/lib/server/office-agents'
import { MODEL_URL, modelReply } from './model-reply'
import { officeAgentHandler, OFFICE_AGENT_HANDLERS } from '../src/lib/server/office-agents/registry'
import { canAccessPath } from '../src/lib/areas'
import { buildWaiting } from '../src/lib/command-center'
import { AUTOMATION_JOBS, dueJobs } from '../src/lib/automation-schedule'
import { validateAutomationSecret } from '../src/lib/server/automation-auth'
import { NextRequest } from 'next/server'

const agent: OfficeAgent = { id: 'prova', user_id: 'titolare', name: 'Prova', department: 'operazioni', description: '',
  enabled: true, schedule_job: null, model: 'gpt-5-mini', daily_budget_cents: 100, weekly_budget_cents: 100,
  monthly_budget_cents: 100, settings: {} }
const baseRun = (): OfficeRun => ({ id: 'corsa', agent_id: agent.id, user_id: agent.user_id, started_at: new Date().toISOString(),
  finished_at: null, status: 'running', summary: '', items_created: 0, cost_cents_reserved: 0, cost_cents_actual: 0, error: null, details: {} })

function fixture() {
  let row = baseRun()
  let claimed = false
  let budget = 100
  const store: OfficeStore = {
    async agent(id, userId) { return id === agent.id && userId === agent.user_id ? { ...agent } : null },
    async claim() {
      if (claimed) return { claimed: false, reason: 'running', run: row }
      claimed = true
      return { claimed: true, reason: 'started', run: row }
    },
    async reserve(_id, _run, cents) {
      if (cents > budget) return null
      budget -= cents; row.cost_cents_reserved += cents
      return 'riserva'
    },
    async settle(_id, cents) { row.cost_cents_actual += cents },
    async output() { row.items_created += 1; return 'uscita' },
    async finish(_id, status, summary, error, logs) { row = { ...row, status, summary, error, details: { logs } }; return row },
  }
  return { store, noBudget() { budget = 0 } }
}

describe('listino e costo', () => {
  test('token reali, cambio, frazioni di centesimo e costo zero', () => {
    assert.equal(modelCostCents('gpt-5-mini', 1_000_000, 1_000_000), 225)
    assert.equal(modelCostCents('gpt-5-mini', 1_000_000, 1_000_000, 0.92), 207)
    assert.equal(modelCostCents('gpt-5-mini', 1, 1), 1)
    assert.equal(modelCostCents('gpt-5-mini', 0, 0), 0)
    assert.equal(modelCostCents('gpt-5-mini', 1_000_000, 1_000_000, 1, 1_000_000), 203)
    assert.throws(() => modelCostCents('gpt-5-mini', 1, 1, 1, 2), /cache/)
  })
  test('listino sconosciuto e numeri non validi bloccano prima di spendere', () => {
    for (const model of ['sconosciuto', 'constructor', '__proto__']) assert.throws(() => modelCostCents(model, 100, 100), /listino/)
    for (const n of [-1, 1.1, NaN, Infinity]) assert.throws(() => modelCostCents('gpt-5-mini', n, 10))
    for (const fx of [0, -1, NaN, Infinity]) assert.throws(() => modelCostCents('gpt-5-mini', 1, 1, fx))
    assert.throws(() => estimateModelCost('gpt-5-mini', 'a', 0))
    assert.throws(() => estimateModelCost('gpt-5-mini', 'a', 32_769))
  })
  test('stima prudente anche per accenti e emoji, output massimo compreso', () => {
    const estimate = estimateModelCost('gpt-5-mini', 'Città 🌍', 1000)
    assert.equal(estimate.tokensIn, new TextEncoder().encode('Città 🌍').length + 512)
    assert.ok(estimate.cents >= modelCostCents('gpt-5-mini', 100, 1000))
  })
})

describe('corse', () => {
  test('un errore del compito viene registrato failed, senza propagare', async () => {
    const { store } = fixture()
    const result = await runAgent('prova', async () => { throw new Error('Fonte non disponibile') }, { userId: 'titolare', store })
    assert.equal(result.run?.status, 'failed')
    assert.equal(result.run?.error, 'Fonte non disponibile')
  })
  test('due chiamate concorrenti eseguono il compito una volta', async () => {
    const { store } = fixture()
    let count = 0
    const handler = async () => { count++ }
    const results = await Promise.all([1, 2].map(() => runAgent('prova', handler, { userId: 'titolare', store })))
    assert.equal(count, 1)
    assert.equal(results.filter((r) => r.skipped === 'running').length, 1)
  })
  test('agente spento registra skipped_disabled senza chiamare il compito', async () => {
    const { store } = fixture()
    store.claim = async () => ({ claimed: false, reason: 'disabled', run: { ...baseRun(), status: 'skipped_disabled' } })
    let called = false
    const result = await runAgent('prova', async () => { called = true }, { userId: 'titolare', store })
    assert.equal(result.run?.status, 'skipped_disabled'); assert.equal(called, false)
  })
  test('budget finito prima del primo risultato e dopo un risultato', async () => {
    for (const withOutput of [false, true]) {
      const f = fixture(); f.noBudget()
      const result = await runAgent('prova', async (ctx) => {
        if (withOutput) await ctx.addOutput({ kind: 'report', title: 'Bozza', body: { testo: 'Verificare' } })
        await ctx.reserve(1)
      }, { userId: 'titolare', store: f.store })
      assert.equal(result.run?.status, withOutput ? 'partial' : 'skipped_budget')
    }
  })
  test('il contesto non espone invii o client database e rifiuta riserve estranee', async () => {
    const { store } = fixture()
    const result = await runAgent('prova', async (ctx) => {
      assert.deepEqual(Object.keys(ctx).sort(), ['addOutput', 'agent', 'log', 'reserve', 'runId', 'settle'])
      await assert.rejects(ctx.settle('altra-corsa', 1), /altra corsa/)
      await assert.rejects(ctx.reserve(-1), /non valida/)
      ctx.log('Preparata una bozza')
      return { summary: 'Nessun invio' }
    }, { userId: 'titolare', store })
    assert.equal(result.run?.status, 'done')
    assert.deepEqual(result.run?.details, { logs: ['Preparata una bozza'] })
  })
  test('workspace diverso non trova l’agente e non esegue nulla', async () => {
    const { store } = fixture()
    const result = await runAgent('prova', async () => { assert.fail() }, { userId: 'altro', store })
    assert.equal(result.run, null); assert.equal(result.error, 'Agente non trovato')
  })
  test('un errore anche nella chiusura viene riportato', async () => {
    const { store } = fixture()
    store.finish = async () => { throw new Error('Database spento') }
    const result = await runAgent('prova', async () => { throw new Error('Fonte spenta') }, { userId: 'titolare', store })
    assert.match(result.error || '', /Registrazione dell’esito/)
  })
})

function restoreKeys(general: string | undefined, office: string | undefined) {
  if (general === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = general
  if (office === undefined) delete process.env.OPENROUTER_API_KEY_OFFICE; else process.env.OPENROUTER_API_KEY_OFFICE = office
}

describe('chiamate al modello con budget', () => {
  test('prenota prima della rete, salda dai token reali, mai strumenti esterni', async () => {
    const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'chiave-finta'
    const office = process.env.OPENROUTER_API_KEY_OFFICE; delete process.env.OPENROUTER_API_KEY_OFFICE
    const order: string[] = []
    const f = fixture()
    const settle = f.store.settle
    f.store.settle = async (...args) => { order.push('saldo'); await settle(...args); assert.deepEqual(args[2], { tokensIn: 1000, tokensOut: 100, model: 'gpt-5-mini', cachedTokens: 1000 }) }
    const reserve = f.store.reserve
    f.store.reserve = async (...args) => { order.push('riserva'); return reserve(...args) }
    const mocked = mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      order.push('rete'); assert.equal(url, MODEL_URL)
      const body = JSON.parse(String(init.body)); assert.equal(body.tools, undefined); assert.equal(body.model, 'openai/gpt-5-mini')
      assert.equal(body.max_tokens, 1000); assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer chiave-finta')
      return modelReply('Bozza verificabile', { input_tokens: 1000, output_tokens: 100, cached_tokens: 1000 })
    })
    try {
      const result = await runAgent('prova', async (ctx) => {
        const result = await callModel(ctx, { model: 'gpt-5-mini', input: 'Scrivi una bozza', maxOutputTokens: 1000 })
        assert.equal(result.text, 'Bozza verificabile'); assert.equal(result.costCents, 1)
      }, { userId: 'titolare', store: f.store })
      assert.equal(result.run?.status, 'done'); assert.deepEqual(order, ['riserva', 'rete', 'saldo'])
    } finally { mocked.mock.restore(); restoreKeys(old, office) }
  })
  test('il costo dichiarato da OpenRouter vince sul listino; la chiave dell’Ufficio vince su quella generale', async () => {
    const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'generale'
    const office = process.env.OPENROUTER_API_KEY_OFFICE; process.env.OPENROUTER_API_KEY_OFFICE = 'ufficio'
    let charged = -1
    const mocked = mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer ufficio')
      const body = JSON.parse(String(init.body))
      assert.equal(body.response_format.json_schema.strict, true); assert.deepEqual(body.provider, { require_parameters: true })
      return modelReply('{"a":"b"}', { input_tokens: 10, output_tokens: 10, cost: 0.0312 })
    })
    try {
      const f = fixture(); const settle = f.store.settle
      f.store.settle = async (...args) => { charged = args[1]; await settle(...args) }
      const result = await runAgent('prova', async (ctx) => {
        await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100, jsonSchema: { name: 'r', schema: { type: 'object' } } })
      }, { userId: 'titolare', store: f.store })
      assert.equal(result.run?.status, 'done'); assert.equal(charged, 4)
      assert.equal(creditCostCents(0.0312, 1), 4); assert.equal(creditCostCents(0.01, 1), 1); assert.equal(creditCostCents(0, 1), 0)
      assert.equal(creditCostCents(0.01, 0.92), 1); assert.equal(creditCostCents(1, 0.92), 92); assert.equal(creditCostCents(Number.NaN), null)
      assert.equal(toOpenRouterModel('gpt-5-mini'), 'openai/gpt-5-mini'); assert.equal(toOpenRouterModel('anthropic/claude-x'), 'anthropic/claude-x')
    } finally { mocked.mock.restore(); restoreKeys(old, office) }
  })
  test('senza budget non chiama il modello; timeout e usage mancanti mantengono la riserva', async () => {
    const old = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'chiave-finta'
    const office = process.env.OPENROUTER_API_KEY_OFFICE; delete process.env.OPENROUTER_API_KEY_OFFICE
    let calls = 0; let settles = 0
    const mocked = mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ status: 'completed' }) })
    try {
      const f = fixture(); f.noBudget(); f.store.settle = async () => { settles++ }
      let result = await runAgent('prova', async (ctx) => { await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100 }) }, { userId: 'titolare', store: f.store })
      assert.equal(result.run?.status, 'skipped_budget'); assert.equal(calls, 0)
      const g = fixture(); g.store.settle = f.store.settle
      result = await runAgent('prova', async (ctx) => { await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100 }) }, { userId: 'titolare', store: g.store })
      assert.equal(result.run?.status, 'failed'); assert.equal(calls, 1); assert.equal(settles, 0)
      assert.equal(result.run?.cost_cents_reserved, 1)
      // Chiave rifiutata: nessuna generazione, nessun addebito, riserva liberata e motivo chiaro.
      mocked.mock.mockImplementation(async () => new Response('{}', { status: 401 }))
      const k = fixture(); let zero = -1; k.store.settle = async (_id, cents) => { zero = cents }
      result = await runAgent('prova', async (ctx) => { await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100 }) }, { userId: 'titolare', store: k.store })
      assert.equal(result.run?.status, 'failed'); assert.equal(zero, 0); assert.match(String(result.run?.error), /OPENROUTER_API_KEY/)
      // Credito finito: stesso trattamento, con il motivo da leggere.
      mocked.mock.mockImplementation(async () => new Response('{}', { status: 402 }))
      const c = fixture(); zero = -1; c.store.settle = async (_id, cents) => { zero = cents }
      result = await runAgent('prova', async (ctx) => { await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100 }) }, { userId: 'titolare', store: c.store })
      assert.equal(zero, 0); assert.match(String(result.run?.error), /Credito OpenRouter esaurito/)
      mocked.mock.mockImplementation(async () => { throw new Error('Timeout') })
      const h = fixture(); h.store.settle = f.store.settle
      result = await runAgent('prova', async (ctx) => { await callModel(ctx, { model: 'gpt-5-mini', input: 'a', maxOutputTokens: 100 }) }, { userId: 'titolare', store: h.store })
      assert.equal(result.run?.status, 'failed'); assert.equal(settles, 0); assert.equal(result.run?.cost_cents_reserved, 1)
    } finally { mocked.mock.restore(); restoreKeys(old, office) }
  })
})

describe('accesso e prima pagina', () => {
  test('solo il titolare accede a ufficio e sottopagine', () => {
    assert.equal(canAccessPath('/ufficio', ['oggi'], false), false)
    assert.equal(canAccessPath('/ufficio?x=1', null, false), false)
    assert.equal(canAccessPath('/ufficio/prova', ['oggi'], true), true)
  })
  test('Direttore, Finanza e Commerciale installati con configurazione iniziale spenta', () => {
    assert.deepEqual(Object.keys(OFFICE_AGENT_HANDLERS).sort(), ['db_cleaner', 'director', 'entity_enricher', 'events_scout', 'finance', 'languages_voice', 'maps_quality', 'mymaps_builder', 'news_watch', 'presentations', 'sales_followup', 'social'])
    assert.ok(Object.values(OFFICE_AGENT_DEFINITIONS).every((agent) => agent.enabled === false))
    assert.equal(officeAgentHandler('constructor'), null)
    assert.equal(officeAgentHandler('non_installato'), null)
    assert.deepEqual(AUTOMATION_JOBS.flatMap((job) => job.steps.filter((step) => step.path.includes('/agents/')).map((step) => step.path)).sort(), Object.keys(OFFICE_AGENT_DEFINITIONS).map((id) => `/api/automation/agents/${id}/run`).sort())
    assert.ok(dueJobs(new Date('2026-10-22T01:15:00Z'), 'Europe/Rome').some((job) => job.name === 'office-maintenance'))
  })
  test('Aspetta te mostra solo le uscite ancora da decidere', () => {
    const items = buildWaiting({ invoices: [], presentations: [], decks: [], pastDue: [], toInvoiceCount: 0,
      officeOutputs: [{ id: 'a', title: 'Da leggere', status: 'pending', agent_id: 'prova' }, { id: 'b', title: 'Decisa', status: 'approved', agent_id: 'prova' }] })
    assert.equal(items.length, 1); assert.equal(items[0].kind, 'office_output'); assert.equal(items[0].href, '/ufficio?uscita=a')
  })
  test('modifiche limitate a interruttore, budget interi e impostazioni JSON', () => {
    assert.deepEqual(officeAgentPatch({ enabled: false, daily_budget_cents: 0, settings: { lingua: 'it' } }), { enabled: false, daily_budget_cents: 0, settings: { lingua: 'it' } })
    for (const patch of [{ user_id: 'altro' }, { daily_budget_cents: -1 }, { daily_budget_cents: 0.5 }, { enabled: 'true' }, { settings: [] }, {}]) assert.throws(() => officeAgentPatch(patch))
  })
  test('AUTOMATION_SECRET e obbligatorio e deve coincidere', () => {
    const old = process.env.AUTOMATION_SECRET; process.env.AUTOMATION_SECRET = 'segreto-di-test'
    try {
      assert.equal(validateAutomationSecret(new NextRequest('http://localhost/api/automation/agents/prova/run')), false)
      assert.equal(validateAutomationSecret(new NextRequest('http://localhost', { headers: { 'x-automation-secret': 'errato' } })), false)
      assert.equal(validateAutomationSecret(new NextRequest('http://localhost', { headers: { 'x-automation-secret': 'segreto-di-test' } })), true)
    } finally { if (old === undefined) delete process.env.AUTOMATION_SECRET; else process.env.AUTOMATION_SECRET = old }
  })
})
