/** UI reale su next build/start, API simulate. Nessuna chiamata a modelli o mappe.
 * OFFICE_TEST_URL=http://127.0.0.1:3215 CHROMIUM_PATH=... npm run test:office:ui
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { OfficeAgent, OfficeOverview, OfficeOutput, OfficeRun } from '../src/lib/office'

const base = process.env.OFFICE_TEST_URL || 'http://127.0.0.1:3215'
const out = process.env.OFFICE_TEST_OUTPUT || '/tmp/speaqi-office-ui'
const OWNER = '11111111-1111-4111-8111-111111111111'
const spend = { agent_id: 'prova', day_actual: 12, day_reserved: 5, week_actual: 24, week_reserved: 5, month_actual: 40, month_reserved: 5 }
let agent: OfficeAgent = { id: 'prova', user_id: OWNER, name: 'Agente di prova', description: 'Solo dati simulati per verificare l’interfaccia.', department: 'operazioni', model: 'gpt-5-mini', enabled: false, daily_budget_cents: 100, weekly_budget_cents: 500, monthly_budget_cents: 1000, settings: {}, schedule_job: null }
const output = (id: string): OfficeOutput => ({ id, agent_id: 'prova', kind: 'report', title: 'Report da controllare', body: { testo: 'Una proposta in bozza, da verificare.' }, status: 'pending', target_table: null, target_id: null, created_at: new Date().toISOString(), decided_at: null })
let outputs: OfficeOutput[] = []
let runs: OfficeRun[] = []
let empty = true
let fail = false
let skipRun = false
const calls: Array<{ method: string; path: string; body: any; key?: string }> = []

function overview(): OfficeOverview {
  return { agents: empty ? [] : [{ ...agent, spend, last_run: runs[0] || null }], runs, outputs, pending_count: outputs.length,
    totals: empty ? { day_actual: 0, day_reserved: 0, week_actual: 0, week_reserved: 0, month_actual: 0, month_reserved: 0 } : spend,
    active_agents: !empty && agent.enabled ? 1 : 0 }
}

async function main() {
  await mkdir(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', headless: true })
  const errors: string[] = []
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(({ owner }) => {
      const token = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.prova'
      localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token: token, refresh_token: 'prova', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.it', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }))
    }, { owner: OWNER })
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = new URL(req.url())
      if (!url.href.startsWith(base)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const method = req.method(); const body = method === 'GET' ? null : req.postDataJSON()
      calls.push({ method, path: url.pathname, body, key: req.headers()['idempotency-key'] })
      const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
      if (url.pathname === '/api/office') return fail ? json({ error: 'Database di prova non disponibile' }, 500) : json(overview())
      if (url.pathname === '/api/office/agents/prova' && method === 'PATCH') { agent = { ...agent, ...body }; return json({ agent }) }
      if (url.pathname === '/api/office/agents/prova/run-now') {
        if (skipRun) return json({ run: null, skipped: 'already_running' })
        const run: OfficeRun = { id: 'corsa', agent_id: agent.id, user_id: OWNER, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: 'done', summary: 'Preparato un report', items_created: 1, cost_cents_actual: 1, cost_cents_reserved: 1, error: null, details: {} }
        runs = [run]; return json({ run })
      }
      if (url.pathname.startsWith('/api/office/outputs/') && method === 'PATCH') { outputs = outputs.filter((o) => o.id !== url.pathname.split('/').pop()); return json({ output: { status: body.status } }) }
      if (url.pathname === '/api/command-center') return json({ waiting: [{ kind: 'office_output', title: 'Report da controllare', detail: 'Ufficio', href: '/ufficio#uscita-uscita-1', tone: 'act' }], office: overview(), money: { paid_month: 0, paid_month_count: 0, invoiced_month: 0, to_invoice_count: 0, to_invoice_amount: 0, renewals: [], renewals_amount: 0, past_due: [] }, sales: { open_deals: 0, by_stage: [], awaiting_signature: [], awaiting_signature_count: 0, awaiting_signature_amount: 0 }, maps: { counts: { online: 0, su_speaqi: 0, pronta: 0, in_lavorazione: 0 }, rows: [], sources: { studiomap: 'not_configured', speaqi: 'ok' } } })
      if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 0 } })
      if (url.pathname.startsWith('/api/contacts')) return json({ contacts: [] })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/ufficio`)
    await page.getByRole('heading', { name: 'L’ufficio è pronto, i compiti arrivano dopo.' }).waitFor()
    assert.ok(await page.locator('aside a[href="/ufficio"]').count())
    await page.screenshot({ path: `${out}/01-vuoto.png`, fullPage: true })
    empty = false; outputs = [output('uscita-1')]
    await page.reload()
    await page.getByRole('heading', { name: 'Agente di prova' }).waitFor()
    const toggle = page.getByRole('switch', { name: 'Attiva Agente di prova' })
    assert.equal(await toggle.isChecked(), false)
    await toggle.click()
    await page.getByText('Impostazioni salvate.', { exact: true }).waitFor()
    assert.equal(agent.enabled, true)
    await page.getByText('Budget e impostazioni', { exact: true }).click()
    await page.getByLabel('Euro / giorno').fill('1,50')
    await page.getByLabel('Impostazioni (JSON)').fill('{"lingua":"it"}')
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/office' && response.request().method() === 'GET'),
      page.getByRole('button', { name: 'Salva impostazioni' }).click(),
    ])
    assert.equal(agent.daily_budget_cents, 150); assert.deepEqual(agent.settings, { lingua: 'it' })
    await page.getByRole('button', { name: 'Fai girare adesso' }).click()
    await page.getByRole('status').filter({ hasText: 'Preparato un report' }).waitFor()
    assert.match(calls.find((call) => call.path.endsWith('/run-now'))?.key || '', /^[0-9a-f-]{36}$/)
    skipRun = true
    await page.getByRole('button', { name: 'Fai girare adesso' }).click()
    await page.getByRole('status').filter({ hasText: 'Turno saltato: corsa già presente o agente spento.' }).waitFor()
    skipRun = false
    await page.screenshot({ path: `${out}/02-desktop.png`, fullPage: true })
    await page.getByRole('button', { name: 'Approva', exact: true }).click()
    await page.getByText('Nessuna uscita da valutare.').waitFor()
    assert.equal(outputs.length, 0)
    assert.equal(calls.find((call) => call.path.includes('/outputs/'))?.body.status, 'approved')
    outputs = [output('uscita-2')]
    await page.reload()
    await page.getByRole('button', { name: 'Rifiuta' }).click()
    await page.getByText('Nessuna uscita da valutare.').waitFor()
    assert.equal(calls.filter((call) => call.path.includes('/outputs/')).at(-1)?.body.status, 'rejected')
    outputs = [output('uscita-3')]
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.getByRole('heading', { name: 'Agente di prova' }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nessuno scorrimento orizzontale su telefono')
    const titleBox = await page.getByRole('heading', { name: 'Ufficio', exact: true }).boundingBox()
    assert.ok(titleBox && titleBox.y < 300, 'su telefono il lavoro si vede nella prima schermata')
    await page.screenshot({ path: `${out}/03-mobile.png`, fullPage: true })
    fail = true
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Database di prova non disponibile' }).waitFor()
    fail = false
    await page.getByRole('button', { name: 'Aggiorna', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Database di prova non disponibile' }).waitFor({ state: 'detached' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${base}/dashboard`)
    await page.locator('.cc-card').getByRole('heading', { name: 'Ufficio', exact: true }).waitFor()
    assert.ok(await page.getByRole('link', { name: 'Apri l’ufficio →' }).count())
    assert.ok(await page.locator('.cc-list').getByRole('link', { name: /Report da controllare/ }).count())
    assert.deepEqual(errors, [])
    console.log('Ufficio: vuoto, sidebar, interruttore, budget, impostazioni, corsa, approva/rifiuta, desktop e telefono verificati. Screenshot: ' + out)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
