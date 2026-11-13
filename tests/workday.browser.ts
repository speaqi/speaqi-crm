/** Verifica della pagina unica con API simulate: nessuna scrittura esterna. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const owner = '11111111-1111-4111-8111-111111111111'
const contactId = '33333333-3333-4333-8333-333333333333'
const taskId = '44444444-4444-4444-8444-444444444444'
const workId = '55555555-5555-4555-8555-555555555555'
const base = process.env.CRM_STARTUP_TEST_URL || 'http://127.0.0.1:3100'
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  await context.addInitScript(({ owner }) => {
    const access_token = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.test'
    localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token, refresh_token: 'test', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
  }, { owner })
  let completed = false
  const contact = { id: contactId, user_id: owner, name: 'Mario Test', company: 'Azienda Test', status: 'New', source: 'manual', contact_scope: 'crm', priority: 0, hidden: false, next_followup_at: '2020-01-01T10:00:00Z', created_at: '2020-01-01T10:00:00Z', updated_at: '2020-01-01T10:00:00Z' }
  const task = { id: taskId, user_id: owner, contact_id: null, type: 'todo', title: 'Preparare proposta', status: 'pending', due_date: '2020-01-01T10:00:00Z', created_at: '2020-01-01T10:00:00Z', updated_at: '2020-01-01T10:00:00Z' }
  const work = { id: workId, user_id: owner, title: 'Destinazione Test', kind: 'territory', stage: 'contact', next_action: 'Scrivere al referente', due_on: '2020-01-01', acknowledged_at: null, collaborator_ids: [], checklist: [], version: 1, created_at: '2020-01-01T10:00:00Z', updated_at: '2020-01-01T10:00:00Z' }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(base).origin) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/tasks/standalone' && route.request().method() === 'PATCH') { completed = true; return json({ task: { ...task, status: 'done' } }) }
    if (url.pathname === `/api/contacts/${contactId}` && route.request().method() === 'PATCH') {
      Object.assign(contact, route.request().postDataJSON())
      return json({ contact })
    }
    if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
    if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
    if (url.pathname === '/api/contacts') return json({ contacts: [contact] })
    if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 1 } })
    if (url.pathname === '/api/tasks/standalone') return json({ tasks: url.searchParams.get('status') === 'done' || completed ? [] : [task] })
    if (url.pathname === '/api/tourism/work' && url.searchParams.has('id')) return json({ item: work, notes: [], events: [], children: [] })
    if (url.pathname === '/api/tourism/work') return json({ items: [work], total: 1, identity: { member_id: null, access_kind: 'owner' }, is_admin: true, members: [], rules: [], summary: { open: 1, today: 0, overdue: 1, fresh: 1, stale: 0, loads: [] } })
    return json({ tasks: [], columns: [] })
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Preparare proposta', { exact: true }).waitFor()
    await page.getByText('Azienda Test', { exact: true }).waitFor()
    await page.getByText('Destinazione Test', { exact: true }).waitFor()
    assert.equal(await page.locator('.sidebar a[href="/todo"]').count(), 0)
    await page.getByRole('article').filter({ hasText: 'Preparare proposta' }).getByRole('button', { name: 'Fatto' }).click()
    await page.getByText('Preparare proposta', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(completed, true)
    await page.getByRole('article').filter({ hasText: 'Azienda Test' }).getByRole('button', { name: '7 giorni' }).click()
    await page.getByText('Ricontatto fissato', { exact: false }).waitFor()
    assert.ok(new Date(contact.next_followup_at).getTime() > Date.now())
    await page.getByRole('article').filter({ hasText: 'Destinazione Test' }).getByRole('button', { name: 'Gestisci' }).click()
    await page.getByRole('region', { name: 'Scheda lavoro' }).getByText('Scrivere al referente').first().waitFor()
    await page.getByRole('button', { name: 'Chiudi e aggiorna' }).click()
    await page.getByRole('button', { name: /Turismo/ }).first().click()
    assert.equal(await page.getByText('Azienda Test', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Destinazione Test', { exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    console.log('PASS: attività, follow-up e Turismo nella stessa lista; completamento e filtro')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
