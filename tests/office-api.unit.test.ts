import { POST as newsTelegram } from '../src/app/api/office/outputs/[id]/telegram/route'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
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
let outputsError: string | null = null
let pendingCount = 0
let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
const params = { params: Promise.resolve({ id: 'prova' }) }

beforeEach(() => {
  member = false; pending = true; outputsError = null; pendingCount = 0; calls = []; invalidateRouteUserCaches()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://office-test.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-finta'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-finta'
  process.env.AUTOMATION_SECRET = 'segreto-finto'
  process.env.AUTOMATION_WORKSPACE_USER_ID = OWNER
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    if (url === 'https://api.telegram.org/botfinto/sendMessage') return Response.json({ ok:true,result:{message_id:123} })
    if (url.includes('/rpc/claim_office_news_delivery')) return Response.json({claimed:true,id:'delivery',body:{articles:[]}})
    if (url.includes('/rpc/record_office_news_delivery')) return Response.json(null)
    assert.ok(url.startsWith('https://office-test.invalid/'), `Chiamata esterna inattesa: ${url}`)
    if (url.includes('/auth/v1/user')) return Response.json({ id: member ? MEMBER : OWNER, email: 'test@example.it', app_metadata: {}, user_metadata: {} })
    if (url.includes('/team_members')) return Response.json([{ id: 'membro', user_id: OWNER, name: 'Persona', allowed_areas: ['oggi'] }])
    if (url.includes('/office_agents') && method === 'GET') {
      const id = new URL(url).searchParams.get('id')?.replace(/^eq\./, '')
      return Response.json(Object.values(OFFICE_AGENT_DEFINITIONS).filter((d) => !id || d.id === id).map((d) => ({ ...d, user_id: OWNER })))
    }
    if (url.includes('/rpc/claim_office_agent_run')) return Response.json({ claimed: false, reason: 'disabled', run: { status: 'skipped_disabled' } })
    if (url.includes('/office_agent_outputs') && method === 'HEAD') {
      return new Response(null, { headers: { 'content-range': `*/${pendingCount}` } })
    }
    if (url.includes('/office_agent_outputs') && method === 'GET' && outputsError) {
      return Response.json({ code: outputsError, message: 'Intervallo o lettura non disponibile' }, { status: outputsError === 'PGRST103' ? 416 : 500 })
    }
    if (url.includes('/rpc/decide_office_output') && method === 'POST') {
      if (!pending) return Response.json({ output:null,reason:'already_decided' })
      pending = false
      return Response.json({ output: { id:'prova',status:body.p_status } })
    }
    return Response.json([], { headers: { 'content-range': '*/0' } })
  })
})
afterEach(() => {
  mock.restoreAll(); invalidateRouteUserCaches()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','AUTOMATION_SECRET','AUTOMATION_WORKSPACE_USER_ID','TELEGRAM_BOT_TOKEN','TELEGRAM_NOTIFY_CHAT_ID']) {
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

test('il titolare installa gli agenti spenti e legge totali zero', async () => {
  const response = await GET(request('/api/office', undefined, 'GET'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.agents.map((agent: { id: string }) => agent.id).sort(), ['db_cleaner', 'director', 'finance', 'languages_voice', 'maps_quality', 'mymaps_builder', 'news_watch', 'presentations', 'sales_followup', 'social']); assert.ok(data.agents.every((agent: { enabled: boolean }) => !agent.enabled)); assert.equal(data.pending_count, 0); assert.equal(data.totals.month_actual, 0)
})

test('la pagina oltre la coda restituisce il conteggio aggiornato e consente di tornare indietro', async () => {
  outputsError = 'PGRST103'; pendingCount = 49
  const response = await GET(request('/api/office?offset=50', undefined, 'GET'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.outputs, [])
  assert.equal(data.pending_count, 49)
  const count = calls.find((call) => call.method === 'HEAD' && call.url.includes('/office_agent_outputs'))
  assert.ok(count?.url.includes(`user_id=eq.${OWNER}`))
  assert.ok(count?.url.includes('status=eq.pending'))
})

test('gli altri errori della coda non vengono trattati come una pagina vuota', async () => {
  outputsError = 'XX000'
  assert.equal((await GET(request('/api/office?offset=50', undefined, 'GET'))).status, 500)
  assert.ok(!calls.some((call) => call.method === 'HEAD'))
})

test('approvare usa la sola RPC transazionale autorizzata; il secondo clic non cambia una decisione presa', async () => {
  const response = await decide(request('/api/office/outputs/prova', { status: 'approved' }), params)
  assert.equal(response.status, 200)
  const writes = calls.filter((call) => call.method !== 'GET')
  assert.equal(writes.length, 1); assert.ok(writes[0].url.includes('/rpc/decide_office_output'))
  assert.deepEqual(writes[0].body, {p_output_id:'prova',p_user_id:OWNER,p_status:'approved'})
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'rejected' }), params)).status, 409)
})

test('non si possono chiedere esecuzioni esterne o cambiare proprietario dal corpo', async () => {
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'done' }), params)).status, 400)
  assert.equal((await decide(request('/api/office/outputs/prova', { status: 'approved', send: true }), params)).status, 400)
  assert.equal((await patchAgent(request('/api/office/agents/prova', { user_id: MEMBER }), params)).status, 400)
  assert.ok(!calls.some((call) => call.method === 'PATCH' || call.url.includes('/rpc/decide_office_output')))
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

test('la corsa macchina di Finanza spenta non legge fatture o preventivi', async () => {
  const req = request('/api/automation/agents/finance/run', undefined, 'POST', false)
  req.headers.set('x-automation-secret', 'segreto-finto')
  const response = await automate(req, { params: Promise.resolve({ id: 'finance' }) })
  assert.equal(response?.status, 200)
  assert.equal((await response!.json()).run.status, 'skipped_disabled')
  assert.ok(!calls.some((c) => /\/(invoices|quotes)(\?|$)/.test(c.url)))
})


test('Telegram notizie: senza sessione o da collaboratore nessun invio e nessuna prenotazione',async()=>{
  const context={params:Promise.resolve({id:OWNER})}
  assert.equal((await newsTelegram(request('/api/office/outputs/'+OWNER+'/telegram',undefined,'POST',false),context)).status,401)
  member=true
  assert.equal((await newsTelegram(request('/api/office/outputs/'+OWNER+'/telegram',undefined,'POST'),context)).status,403)
  assert.ok(!calls.some((c)=>c.url.includes('claim_office_news_delivery')||c.url.includes('api.telegram.org')))
})
test('Telegram notizie: solo il clic del titolare prenota e invia, destinatario nel corpo rifiutato',async()=>{
  process.env.TELEGRAM_BOT_TOKEN='finto';process.env.TELEGRAM_NOTIFY_CHAT_ID='123'
  const context={params:Promise.resolve({id:OWNER})};const path='/api/office/outputs/'+OWNER+'/telegram'
  assert.equal((await newsTelegram(request(path,{notify_to:'altro'},'POST'),context)).status,400)
  assert.equal((await newsTelegram(request(path,undefined,'POST'),context)).status,200)
  assert.equal(calls.filter((c)=>c.url==='https://api.telegram.org/botfinto/sendMessage').length,1)
  assert.ok(calls.find((c)=>c.url.includes('claim_office_news_delivery')))
})
