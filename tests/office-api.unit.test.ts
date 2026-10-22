/** I cancelli HTTP si provano con le rotte vere e Supabase simulato sulla rete. */
import assert from 'node:assert/strict'
import { beforeEach, afterEach, test, mock } from 'node:test'
import { NextRequest } from 'next/server'
import { GET } from '../src/app/api/office/route'
import { PATCH as patchAgent } from '../src/app/api/office/agents/[id]/route'
import { POST as runNow } from '../src/app/api/office/agents/[id]/run-now/route'
import { PATCH as decide } from '../src/app/api/office/outputs/[id]/route'
import { POST as automate } from '../src/app/api/automation/agents/[id]/run/route'
import { invalidateRouteUserCaches } from '../src/lib/server/supabase'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const originalEnv = { ...process.env }
let member = false
let pending = true
let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
const params = { params: Promise.resolve({ id: 'prova' }) }

beforeEach(() => {
  member = false; pending = true; calls = []; invalidateRouteUserCaches()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://office-test.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-finta'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-finta'
  process.env.AUTOMATION_SECRET = 'segreto-finto'
  process.env.AUTOMATION_WORKSPACE_USER_ID = OWNER
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    assert.ok(url.startsWith('https://office-test.invalid/'), `Chiamata esterna inattesa: ${url}`)
    if (url.includes('/auth/v1/user')) return Response.json({ id: member ? MEMBER : OWNER, email: 'test@example.it', app_metadata: {}, user_metadata: {} })
    if (url.includes('/team_members')) return Response.json([{ id: 'membro', user_id: OWNER, name: 'Persona', allowed_areas: ['oggi'] }])
    if (url.includes('/office_agent_outputs') && method === 'PATCH') {
      if (!pending) return Response.json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'Cannot coerce the result to a single JSON object' }, { status: 406 })
      pending = false
      return Response.json({ id: 'prova', ...body })
    }
    return Response.json([], { headers: { 'content-range': '*/0' } })
  })
})
afterEach(() => {
  mock.restoreAll(); invalidateRouteUserCaches()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','AUTOMATION_SECRET','AUTOMATION_WORKSPACE_USER_ID']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]
  }
})

function request(path: string, body?: unknown, method = 'PATCH', token = true) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { ...(token ? { Authorization: 'Bearer token-di-prova' } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

test('tutte le API titolare rifiutano richieste senza sessione prima di accedere ai dati', async () => {
  const requests = [
    () => GET(request('/api/office', undefined, 'GET', false)),
    () => patchAgent(request('/api/office/agents/prova', {}, 'PATCH', false), params),
    () => runNow(request('/api/office/agents/prova/run-now', undefined, 'POST', false), params),
    () => decide(request('/api/office/outputs/prova', {}, 'PATCH', false), params),
  ]
  for (const run of requests) assert.equal((await run())?.status, 401)
  assert.equal(calls.length, 0)
})

test('un collaboratore riceve 403 su lettura, configurazione, corsa e decisioni', async () => {
  member = true
  const requests = [
    () => GET(request('/api/office', undefined, 'GET')),
    () => patchAgent(request('/api/office/agents/prova', { enabled: true }), params),
    () => runNow(request('/api/office/agents/prova/run-now', undefined, 'POST'), params),
    () => decide(request('/api/office/outputs/prova', { status: 'approved' }), params),
  ]
  for (const run of requests) assert.equal((await run())?.status, 403)
  assert.ok(!calls.some((call) => call.url.includes('/office_')))
})

test('il titolare puo leggere l’ufficio vuoto e i totali sono zero', async () => {
  const response = await GET(request('/api/office', undefined, 'GET'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.agents, []); assert.equal(data.pending_count, 0); assert.equal(data.totals.month_actual, 0)
})

test('approvare registra solo la decisione; il secondo clic non cambia una decisione presa', async () => {
  const response = await decide(request('/api/office/outputs/prova', { status: 'approved' }), params)
  assert.equal(response.status, 200)
  const writes = calls.filter((call) => call.method === 'PATCH')
  assert.equal(writes.length, 1); assert.ok(writes[0].url.includes('/office_agent_outputs'))
  assert.ok(writes[0].url.includes('user_id=eq.')); assert.ok(writes[0].url.includes('status=eq.pending'))
  assert.deepEqual(Object.keys(writes[0].body!).sort(), ['decided_at', 'status'])
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'rejected' }), params)).status, 409)
})

test('non si possono chiedere esecuzioni esterne o cambiare proprietario dal corpo', async () => {
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'done' }), params)).status, 400)
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'approved', send: true }), params)).status, 400)
  assert.equal((await patchAgent(request('/api/office/agents/prova', { user_id: MEMBER }), params)).status, 400)
  assert.ok(!calls.some((call) => call.method === 'PATCH'))
})

test('corsa manuale senza chiave rifiutata e registro vuoto non eseguibile', async () => {
  assert.equal((await runNow(request('/api/office/agents/prova/run-now', undefined, 'POST'), params)).status, 400)
  const req = request('/api/office/agents/prova/run-now', undefined, 'POST')
  req.headers.set('idempotency-key', 'chiave-di-test')
  assert.equal((await runNow(req, params)).status, 409)
})

test('automazione: segreto obbligatorio e agente inesistente non eseguito', async () => {
  const req = request('/api/automation/agents/prova/run', undefined, 'POST', false)
  assert.equal((await automate(req, params))?.status, 401)
  req.headers.set('x-automation-secret', 'segreto-finto')
  assert.equal((await automate(req, params))?.status, 404)
  assert.equal(calls.length, 0)
})
