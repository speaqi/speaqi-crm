import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET, POST } from '../src/app/api/office/recurring/route'
import { PATCH } from '../src/app/api/office/recurring/[id]/route'
import { GET as GET_REPORT, PUT as PUT_REPORT } from '../src/app/api/office/report-config/route'
import { invalidateRouteUserCaches } from '../src/lib/server/supabase'

const USER = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const BASE = 'https://office-recurring-test.invalid'
const original = { ...process.env }
const input = { title: 'Partner', instruction: 'Cerca partner', every_days: 2, local_time: '09:00', next_local_date: '2026-11-01', enabled: true }
let calls: Array<{ path: string; body: any; query: URLSearchParams }> = []
let member = false
beforeEach(() => {
  calls = []; member = false; invalidateRouteUserCaches()
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  mock.method(globalThis, 'fetch', async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ path: url.pathname, body, query: url.searchParams })
    if (url.pathname.endsWith('/auth/v1/user')) return Response.json({ id: member ? ID : USER, email: 'test@example.it', app_metadata: {}, user_metadata: {} })
    if (url.pathname.endsWith('/team_members')) return Response.json([{ id: ID, user_id: USER, name: 'Team', allowed_areas: ['oggi'] }])
    if (url.pathname.includes('/rpc/office_recurring_')) return Response.json({ id: ID })
    if (url.pathname.endsWith('/rpc/office_report_configure')) return Response.json({ user_id: USER, revision: 1 })
    if (url.pathname.endsWith('/office_report_config')) return Response.json(null)
    if (url.pathname.endsWith('/office_recurring_orders')) return Response.json([])
    return Response.json([])
  })
})

test('frequenza report: solo titolare, input validato e workspace vincolato', async () => {
  const settings = { every_days: 7, local_time: '18:00', next_local_date: '2026-11-01', enabled: true, revision: null }
  assert.equal((await GET_REPORT(req('/api/office/report-config'))).status, 200)
  assert.equal((await PUT_REPORT(req('/api/office/report-config', settings))).status, 200)
  assert.equal(calls.find((call) => call.path.endsWith('/rpc/office_report_configure'))?.body.p_user_id, USER)
  assert.equal((await PUT_REPORT(req('/api/office/report-config', { ...settings, every_days: 4 }))).status, 400)
  member = true; invalidateRouteUserCaches(); calls = []
  assert.equal((await PUT_REPORT(req('/api/office/report-config', settings))).status, 403)
  assert.ok(!calls.some((call) => call.path.includes('office_report')))
})
afterEach(() => { mock.restoreAll(); invalidateRouteUserCaches(); for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]
} })
function req(path: string, body?: unknown) { return new NextRequest(`https://crm.example${path}`, { method: body ? 'POST' : 'GET',
  headers: { authorization: 'Bearer token', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }) }

test('agenda: lettura e scrittura limitate al proprietario e al suo workspace', async () => {
  assert.equal((await GET(req('/api/office/recurring'))).status, 200)
  assert.equal(calls.find((call) => call.path.endsWith('/office_recurring_orders'))?.query.get('user_id'), `eq.${USER}`)
  assert.equal((await POST(req('/api/office/recurring', input))).status, 201)
  assert.equal(calls.find((call) => call.path.endsWith('/rpc/office_recurring_create'))?.body.p_user_id, USER)
  member = true; invalidateRouteUserCaches(); calls = []
  assert.equal((await POST(req('/api/office/recurring', input))).status, 403)
  assert.ok(!calls.some((call) => call.path.includes('office_recurring')))
})

test('agenda: revisioni obbligatorie e input non validi non arrivano al database', async () => {
  const context = { params: Promise.resolve({ id: ID }) }
  assert.equal((await PATCH(req(`/api/office/recurring/${ID}`, input), context)).status, 400)
  assert.equal((await POST(req('/api/office/recurring', { ...input, every_days: 4 }))).status, 400)
  assert.ok(!calls.some((call) => call.path.includes('/rpc/office_recurring_')))
  assert.equal((await PATCH(req(`/api/office/recurring/${ID}`, { ...input, revision: 1 }), context)).status, 200)
  assert.equal(calls.find((call) => call.path.endsWith('/rpc/office_recurring_update'))?.body.p_user_id, USER)
})
