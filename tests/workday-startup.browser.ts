/** La dashboard resta usabile anche se contatti e task CRM sono lenti. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = 'http://127.0.0.1:3100'
const owner = '11111111-1111-4111-8111-111111111111'
const contact = { id: '33333333-3333-4333-8333-333333333333', user_id: owner, name: 'Contatto lento', status: 'New', source: 'manual', contact_scope: 'crm', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z', priority: 0, hidden: false }
const task = { id: '44444444-4444-4444-8444-444444444444', user_id: owner, contact_id: null, type: 'todo', title: 'Attività subito visibile', status: 'pending', priority: 'medium', created_at: '2026-10-23T10:00:00Z' }

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext()
  await context.addInitScript(({ owner }) => {
    const access_token = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.local-test'
    localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token, refresh_token: 'local-test', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
  }, { owner })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const errors: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== base) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
    if (url.pathname === '/api/contacts') { await gate; return json({ contacts: [contact] }) }
    if (url.pathname === '/api/tasks') { await gate; return json({ tasks: [] }) }
    if (url.pathname === '/api/tasks/standalone') return json({ tasks: url.searchParams.get('status') === 'done' ? [] : [task] })
    if (url.pathname === '/api/tasks/contact-links') return json({ links: [] })
    if (url.pathname === '/api/tourism/work') return json({ items: [], total: 0 })
    if (url.pathname === '/api/workday/tourism-contacts') return json({ contactIds: [] })
    if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
    if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 1 }, folders: [] })
    return json({ columns: [] })
  })
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' })
    await page.getByText('Attività subito visibile', { exact: true }).waitFor({ timeout: 20000 })
    assert.equal(await page.locator('.loading-screen').count(), 0)
    assert.equal(await page.getByText('Contatto lento', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('status').filter({ hasText: 'Caricamento delle informazioni rimanenti' }).count(), 1)
    release()
    await page.getByText('Contatto lento', { exact: true }).waitFor({ timeout: 20000 })
    assert.deepEqual(errors, [])
    console.log('PASS dashboard progressiva prima del completamento di contatti e task')
  } finally { release(); await context.close(); await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
