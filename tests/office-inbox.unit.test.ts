import assert from 'node:assert/strict'
import { beforeEach, afterEach, mock, test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET, POST } from '../src/app/api/office/inbox/route'
import { officeInboxGroups, officeOutputIsNotice, type InboxOutput } from '../src/lib/office-inbox'
import { invalidateRouteUserCaches } from '../src/lib/server/supabase'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const FIRST = '33333333-3333-4333-8333-333333333333'
const SECOND = '44444444-4444-4444-8444-444444444444'
const DECK = '55555555-5555-4555-8555-555555555555'
const BASE = 'https://inbox-test.invalid'
const original = { ...process.env }
let member = false
let missing = false
let outputs: InboxOutput[] = []
let calls: Array<{ url: URL; method: string; body: any }> = []
const output = (id: string, patch: Partial<InboxOutput> = {}): InboxOutput => ({ id, agent_id: 'news_watch', kind: 'report',
  title: 'Rassegna', body: {}, status: 'pending', target_table: null, target_id: null, created_at: '2026-10-26T08:00:00Z', decided_at: null, ...patch })

beforeEach(() => {
  member = false; missing = false; outputs = [output(FIRST)]; calls = []; invalidateRouteUserCaches()
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-test'; process.env.OFFICE_WORKER_ENABLED = 'false'
  mock.method(globalThis, 'fetch', async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method || 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null
    assert.equal(url.origin, BASE, 'nessuna operazione esterna nei test')
    calls.push({ url, method, body })
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: member ? OTHER : OWNER, email: 'owner@example.it', app_metadata: {}, user_metadata: {} })
    if (url.pathname.endsWith('/team_members')) return Response.json([{ id: OTHER, user_id: OWNER, name: 'Collaboratore', allowed_areas: ['oggi'] }])
    if (url.pathname.endsWith('/office_agent_outputs')) {
      const rows = url.searchParams.get('body->>action') === 'eq.create_contact' ? [] : outputs
      return Response.json(rows, { headers: { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' } })
    }
    if (url.pathname.endsWith('/tourism_decks')) return Response.json([{ id: DECK, title: 'Presentazione corrente', version: 4, status: 'approved' }])
    if (url.pathname.endsWith('/rpc/acknowledge_office_outputs')) return missing
      ? Response.json({ code: 'PGRST202', message: 'RPC assente' }, { status: 404 })
      : Response.json(body.p_output_ids.map((id: string) => ({ id, ok: id === FIRST, ...(id === SECOND ? { error: 'Richiede una decisione' } : {}) })))
    if (url.pathname.endsWith('/rpc/decide_office_output')) return Response.json(body.p_output_id === SECOND ? { output: null, reason: 'already_decided' }
      : { output: { id: body.p_output_id, status: body.p_status } })
    return Response.json([])
  })
})
afterEach(() => {
  mock.restoreAll(); invalidateRouteUserCaches()
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OFFICE_WORKER_ENABLED']) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]
  }
})
const request = (body?: unknown, auth = true, query = '') => new NextRequest(`http://localhost/api/office/inbox${query}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { Authorization: 'Bearer test' } : {}), 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('coda: rapporti raggruppati per documento, proposte mai nascoste o unite', () => {
  const groups = officeInboxGroups([output(FIRST, { target_table: 'tourism_decks', target_id: DECK }),
    output(SECOND, { target_table: 'tourism_decks', target_id: DECK, created_at: '2026-10-26T09:00:00Z', document: { id: DECK, title: 'Titolo attuale', version: 4, status: 'ready' } }),
    output('contact', { kind: 'proposal', body: { action: 'create_contact' } }), output('notice')])
  assert.equal(groups.length, 3)
  assert.equal(groups[0].category, 'documents'); assert.equal(groups[0].ids.length, 2)
  assert.equal(groups[0].title, 'Titolo attuale'); assert.equal(groups[0].output.id, SECOND)
  assert.equal(groups[0].href, `/tourism/presentazioni/${DECK}`)
  assert.ok(!officeOutputIsNotice(output(FIRST, { body: { action: 'merge_contacts' } })))
  assert.ok(!officeOutputIsNotice(output(FIRST, { kind: 'proposal' })))
})
test('coda riservata: senza sessione o da collaboratore non si leggono né gestiscono uscite', async () => {
  assert.equal((await GET(request(undefined, false))).status, 401)
  assert.equal((await POST(request({ ids: [FIRST], action: 'acknowledge' }, false))).status, 401)
  assert.equal(calls.length, 0)
  member = true
  assert.equal((await GET(request())).status, 403)
  assert.equal((await POST(request({ ids: [FIRST], action: 'acknowledge' }))).status, 403)
  assert.ok(!calls.some((call) => /office_|tourism_/.test(call.url.pathname)))
})
test('elenco paginato: documenti correnti e tutte le letture limitate al workspace', async () => {
  outputs = [output(FIRST, { target_table: 'tourism_decks', target_id: DECK })]
  const response = await GET(request(undefined, true, '?offset=50'))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).outputs[0].document.status, 'approved')
  const reads = calls.filter((call) => /office_agent_outputs|tourism_decks/.test(call.url.pathname))
  for (const read of reads) assert.equal(read.url.searchParams.get('user_id'), `eq.${OWNER}`)
  const listing = reads.find((call) => call.url.pathname.endsWith('office_agent_outputs'))!.url.searchParams
  assert.equal(listing.get('status'), 'eq.pending'); assert.equal(listing.get('offset'), '50'); assert.equal(listing.get('limit'), '50')
})
test('input bulk rigoroso: nessun ID implicito, duplicato o estraneo al contratto', async () => {
  for (const body of [{ ids: [], action: 'acknowledge' }, { ids: [FIRST, FIRST], action: 'acknowledge' },
    { ids: ['other'], action: 'approved' }, { ids: Array(51).fill(FIRST), action: 'rejected' },
    { ids: [FIRST], action: 'send' }, { ids: [FIRST], action: 'approved', user_id: OTHER }]) {
    assert.equal((await POST(request(body))).status, 400)
  }
  assert.equal((await GET(request(undefined, true, '?offset=-1'))).status, 400)
  assert.ok(!calls.some((call) => /office_|tourism_/.test(call.url.pathname)))
})
test('archiviazione: RPC dedicata, esiti parziali e nessuna approvazione o invio', async () => {
  const response = await POST(request({ ids: [FIRST, SECOND], action: 'acknowledge' }))
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.deepEqual(value.results.map((row: any) => row.ok), [true, false])
  const writes = calls.filter((call) => call.method === 'POST')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].url.pathname, '/rest/v1/rpc/acknowledge_office_outputs')
  assert.deepEqual(writes[0].body, { p_user_id: OWNER, p_output_ids: [FIRST, SECOND] })
  missing = true
  assert.equal((await POST(request({ ids: [FIRST], action: 'acknowledge' }))).status, 503)
})
test('decisioni multiple: servizio canonico per voce, risultati distinti e avvisi esclusi', async () => {
  outputs = [output(FIRST, { kind: 'proposal' }), output(SECOND, { kind: 'proposal' })]
  const result = await (await POST(request({ ids: [FIRST, SECOND, DECK], action: 'approved' }))).json()
  assert.deepEqual(result.results.map((row: any) => row.ok), [true, false, false])
  const writes = calls.filter((call) => call.url.pathname.endsWith('/rpc/decide_office_output'))
  assert.equal(writes.length, 2)
  assert.ok(writes.every((call) => call.body.p_user_id === OWNER && call.body.p_status === 'approved'))
  calls = []; outputs = [output(FIRST)]
  assert.equal((await (await POST(request({ ids: [FIRST], action: 'approved' }))).json()).results[0].ok, false)
  assert.ok(!calls.some((call) => call.url.pathname.includes('/rpc/')))
})
