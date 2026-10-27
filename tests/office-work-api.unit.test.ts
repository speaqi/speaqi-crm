import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET as listWork } from '../src/app/api/office/work/route'
import { GET as detailWork, PATCH as changeWork } from '../src/app/api/office/work/[id]/route'
import { invalidateRouteUserCaches } from '../src/lib/server/supabase'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const WORK = '33333333-3333-4333-8333-333333333333'
const ORDER = '44444444-4444-4444-8444-444444444444'
const BASE = 'https://office-work-test.invalid'
const originalEnv = { ...process.env }
const params = { params: Promise.resolve({ id: WORK }) }
const row = { id: WORK, user_id: OWNER, order_id: ORDER, agent_id: 'mymaps_builder', action: 'import_mymaps',
  status: 'blocked', payload: { slug: 'marsiglia', city: 'Marsiglia' }, revision: 2, payload_version: 1,
  lease_token: 'private-fence', checkpoint: { receipt: 'internal' } }
let member = false
let missing = false
let found = true
let tableError: string | null = null
let rpcReason: string | null = null
let calls: Array<{ url: URL; method: string; body: any }> = []

beforeEach(() => {
  row.status = 'blocked'
  member = false; missing = false; found = true; tableError = null; rpcReason = null; calls = []
  invalidateRouteUserCaches()
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-test'
  mock.method(globalThis, 'fetch', async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method, body })
    assert.equal(url.origin, BASE, 'nessuna richiesta esterna dal collaudo')
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: member ? MEMBER : OWNER, email: 'owner@example.it', app_metadata: {}, user_metadata: {} })
    if (url.pathname.endsWith('/team_members')) return Response.json([{ id: MEMBER, user_id: OWNER, name: 'Collaboratore', allowed_areas: ['oggi'] }])
    if (url.pathname.endsWith('/rpc/office_work_owner_action')) {
      return Response.json(rpcReason ? { work: null, reason: rpcReason } : { work: { ...row, status: body.p_action === 'cancel' ? 'cancelled' : 'ready' } })
    }
    if (url.pathname.endsWith('/office_work_items')) {
      if (missing || tableError) return Response.json({ code: missing ? 'PGRST205' : tableError, message: 'Errore database di test' }, { status: 500 })
      return Response.json(found ? [row] : [], { headers: { 'content-range': found ? '0-0/1' : '*/0' } })
    }
    if (url.pathname.endsWith('/office_work_attempts')) return Response.json([{ id: 'attempt', work_id: WORK, lease_token: 'private-attempt' }])
    if (url.pathname.endsWith('/office_work_events')) return Response.json([{ id: 'event', work_id: WORK, delivery_token: 'private-delivery' }])
    if (url.pathname.endsWith('/office_work_outputs')) return Response.json([{ output_id: ORDER, work_id: WORK }])
    if (url.pathname.endsWith('/office_agent_outputs')) return Response.json([{ id: ORDER, title: 'Risultato da verificare', status: 'pending' }])
    return Response.json([])
  })
})

test('la correzione dei dati non sostituisce il clic sulla proposta da approvare', async () => {
  row.status = 'waiting_owner'
  const response = await changeWork(request(`/api/office/work/${WORK}`, { action: 'update_payload', expected_revision: 2,
    payload: { source: 'https://www.google.com/maps/d/viewer?mid=valid' } }), params)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).reason, 'approval_required')
  assert.ok(!calls.some((call) => call.url.pathname.endsWith('/rpc/office_work_owner_action')))
})
afterEach(() => {
  mock.restoreAll(); invalidateRouteUserCaches()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]
  }
})
function request(path: string, body?: unknown, auth = true) {
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'PATCH',
    headers: { ...(auth ? { Authorization: 'Bearer local-test' } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

test('lavori: nessuna lettura o scrittura senza sessione', async () => {
  assert.equal((await listWork(request('/api/office/work', undefined, false))).status, 401)
  assert.equal((await detailWork(request(`/api/office/work/${WORK}`, undefined, false), params)).status, 401)
  assert.equal((await changeWork(request(`/api/office/work/${WORK}`, { action: 'resume', expected_revision: 2 }, false), params)).status, 401)
  assert.equal(calls.length, 0)
})
test('lavori: collaboratori esclusi prima dell’accesso al registro', async () => {
  member = true
  assert.equal((await listWork(request('/api/office/work'))).status, 403)
  assert.equal((await changeWork(request(`/api/office/work/${WORK}`, { action: 'cancel', expected_revision: 2 }), params)).status, 403)
  assert.ok(!calls.some((call) => call.url.pathname.includes('office_work')))
})
test('elenco: filtri, ordine e paginazione conservano il vincolo del proprietario', async () => {
  const response = await listWork(request(`/api/office/work?order_id=${ORDER}&offset=25`))
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.equal(value.supported, true); assert.equal(value.total, 1); assert.equal(value.offset, 25)
  assert.equal(value.works[0].lease_token, undefined); assert.equal(value.works[0].checkpoint, undefined)
  const query = calls.find((call) => call.url.pathname.endsWith('/office_work_items'))!.url.searchParams
  assert.equal(query.get('user_id'), `eq.${OWNER}`); assert.equal(query.get('order_id'), `eq.${ORDER}`)
  assert.match(query.get('status')!, /waiting_owner/); assert.equal(query.get('offset'), '25')
  assert.equal(query.get('limit'), '25')
})
test('elenco: filtri non validi non avviano query operative', async () => {
  for (const path of ['/api/office/work?order_id=altro', '/api/office/work?offset=-1', '/api/office/work?view=segreti', '/api/office/work?agent_id=', '/api/office/work?agent_id=finance,other']) {
    assert.equal((await listWork(request(path))).status, 400)
  }
  assert.ok(!calls.some((call) => call.url.pathname.includes('office_work')))
})

test('scheda personaggio: filtra nel database anche per agente, prima della paginazione', async () => {
  const response = await listWork(request('/api/office/work?agent_id=presentations&view=all&offset=25'))
  assert.equal(response.status, 200)
  const query = calls.find((call) => call.url.pathname.endsWith('/office_work_items'))!.url.searchParams
  assert.equal(query.get('user_id'), `eq.${OWNER}`)
  assert.equal(query.get('agent_id'), 'eq.presentations')
  assert.equal(query.get('offset'), '25')
  assert.equal(query.get('status'), null)
})
test('schema non ancora applicato: elenco compatibile e modifiche non consumate', async () => {
  missing = true
  const listed = await listWork(request('/api/office/work'))
  assert.equal(listed.status, 200); assert.deepEqual((await listed.json()).works, [])
  assert.equal((await changeWork(request(`/api/office/work/${WORK}`, { action: 'resume', expected_revision: 2 }), params)).status, 503)
  assert.ok(!calls.some((call) => call.url.pathname.includes('/rpc/')))
})
test('gli errori inattesi del registro restano visibili', async () => {
  tableError = 'XX000'
  assert.equal((await listWork(request('/api/office/work'))).status, 500)
})
test('dettaglio: tutte le query sono limitate al workspace e i token di presa non escono', async () => {
  const response = await detailWork(request(`/api/office/work/${WORK}`), params)
  const value = await response.json()
  assert.equal(response.status, 200); assert.equal(value.outputs[0].title, 'Risultato da verificare')
  assert.equal(value.work.lease_token, undefined); assert.equal(value.attempts[0].lease_token, undefined)
  assert.equal(value.events[0].delivery_token, undefined)
  for (const call of calls.filter((call) => /office_(work|agent_outputs)/.test(call.url.pathname))) {
    assert.equal(call.url.searchParams.get('user_id'), `eq.${OWNER}`)
  }
})
test('un lavoro altrui o mancante non espone dipendenze e non si modifica', async () => {
  found = false
  assert.equal((await detailWork(request(`/api/office/work/${WORK}`), params)).status, 404)
  assert.equal((await changeWork(request(`/api/office/work/${WORK}`, { action: 'cancel', expected_revision: 2 }), params)).status, 404)
  assert.ok(!calls.some((call) => /office_work_(attempts|dependencies|outputs|events|owner_action)/.test(call.url.pathname)))
})
test('correzione della fonte: una sola RPC con proprietario e versione attesa', async () => {
  const response = await changeWork(request(`/api/office/work/${WORK}`, { action: 'update_payload', expected_revision: 2,
    payload: { source: 'https://www.google.com/maps/d/viewer?mid=public-source' } }), params)
  assert.equal(response.status, 200)
  const writes = calls.filter((call) => call.method !== 'GET')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].body, { p_user_id: OWNER, p_work_id: WORK, p_action: 'update_payload', p_patch: {
    expected_revision: 2, payload: { source: 'https://www.google.com/maps/d/viewer?mid=public-source' },
  } })
  assert.match(writes[0].url.pathname, /rpc\/office_work_owner_action$/)
})
test('nessun campo di controllo o identificativo invalido entra in una correzione', async () => {
  for (const body of [
    { action: 'resume', expected_revision: 2, user_id: MEMBER },
    { action: 'resume' },
    { action: 'update_payload', expected_revision: 2, payload: { agent_id: 'finance' } },
    { action: 'update_payload', expected_revision: 2, payload: { entity_id: 'inventato' } },
    { action: 'update_payload', expected_revision: 2, payload: { source: 'x'.repeat(2001) } },
  ]) assert.equal((await changeWork(request(`/api/office/work/${WORK}`, body), params)).status, 400)
  assert.ok(!calls.some((call) => call.method !== 'GET'))
})
test('conflitti e risultati incerti richiedono un’azione precisa, senza rilancio cieco', async () => {
  rpcReason = 'revision_conflict'
  const conflict = await changeWork(request(`/api/office/work/${WORK}`, { action: 'resume', expected_revision: 2 }), params)
  assert.equal(conflict.status, 409); assert.match((await conflict.json()).error, /cambiato/)
  rpcReason = 'reconciliation_required'
  const uncertain = await changeWork(request(`/api/office/work/${WORK}`, { action: 'resume', expected_revision: 2 }), params)
  assert.equal(uncertain.status, 409); assert.match((await uncertain.json()).error, /incerto/)
})
