/** Avvio reale della UI con tutte le API intercettate: nessun dato o invio remoto. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.CRM_STARTUP_TEST_URL || 'http://127.0.0.1:3100'
const owner = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-23T10:00:00Z'
const contact = {
  id: '33333333-3333-4333-8333-333333333333',
  user_id: owner,
  name: 'Contatto prova prestazioni',
  status: 'New',
  source: 'manual',
  contact_scope: 'crm',
  created_at: now,
  updated_at: now,
  priority: 0,
  company: 'Azienda di prova',
  hidden: false,
}
const task = {
  id: '44444444-4444-4444-8444-444444444444',
  user_id: owner,
  contact_id: null,
  type: 'todo',
  title: 'Attività di prova',
  status: 'pending',
  priority: 'medium',
  due_date: '2020-01-01T09:00:00Z',
  created_at: now,
  updated_at: now,
}
async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  })
  try {
    for (const scenario of ['slow-summary', 'contacts-error', 'legacy-empty']) {
      const context = await browser.newContext()
      await context.addInitScript(
        ({ owner }) => {
          const access_token =
            btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) +
            '.' +
            btoa(
              JSON.stringify({
                sub: owner,
                exp: Math.floor(Date.now() / 1000) + 3600,
              })
            ) +
            '.local-test'
          localStorage.setItem(
            'speaqi-crm-auth',
            JSON.stringify({
              access_token,
              refresh_token: 'local-test',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              expires_in: 3600,
              token_type: 'bearer',
              user: {
                id: owner,
                email: 'owner@example.test',
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: {},
                user_metadata: {},
                created_at: '2026-01-01T00:00:00Z',
              },
            })
          )
        },
        { owner }
      )
      let releaseSummary!: () => void
      const summaryGate = new Promise<void>((resolve) => {
        releaseSummary = resolve
      })
      let summaryReleased = false
      let legacyCalls = 0
      let contactsCalls = 0
      const unexpectedWrites: string[] = []
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(baseUrl).origin) return route.abort()
        if (!url.pathname.startsWith('/api/')) return route.continue()
        const json = (body: unknown, status = 200) =>
          route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body),
          })
        if (route.request().method() !== 'GET') {
          if (
            url.pathname === '/api/import/legacy' &&
            scenario === 'legacy-empty'
          ) {
            legacyCalls++
            return json({ migrated_contacts: 1, migrated_tasks: 0 })
          }
          unexpectedWrites.push(url.pathname)
          return json({ error: 'Scrittura inattesa nella fixture' }, 400)
        }
        if (url.pathname === '/api/team-members')
          return json({ members: [], is_admin: true })
        if (url.pathname === '/api/pipeline-stages')
          return json({
            stages: [{ id: 'new', name: 'New', position: 0, color: '#999' }],
          })
        if (url.pathname === '/api/contacts') {
          contactsCalls++
          assert.equal(
            url.searchParams.get('scope'),
            'crm,personal',
            'Nessun archivio holding al bootstrap'
          )
          if (scenario === 'contacts-error')
            return json({ error: 'Timeout contatti simulato' }, 500)
          return json({
            contacts:
              scenario === 'legacy-empty' && !legacyCalls ? [] : [contact],
          })
        }
        if (url.pathname === '/api/contacts/summary') {
          await summaryGate
          return json({
            counts: {
              total: scenario === 'legacy-empty' ? 0 : 4322,
              crm: 1,
              crm_visible: 1,
              holding: 4321,
              personal: 0,
              partner: 0,
              inbound: 0,
              marketing: 4322,
            },
            folders: [],
          })
        }
        if (url.pathname === '/api/tasks/standalone') {
          return url.searchParams.get('status') === 'done'
            ? json({ error: 'Storico temporaneamente non disponibile' }, 500)
            : json({ tasks: [task] })
        }
        return json({ tasks: [], columns: [] })
      })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      try {
        const tasksReady = page.waitForResponse(
          (r) => new URL(r.url()).pathname === '/api/tasks'
        )
        await page.goto(`${baseUrl}/contacts?scope=crm`, {
          waitUntil: 'domcontentloaded',
        })
        if (scenario === 'legacy-empty') {
          await tasksReady
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
              )
          )
          assert.equal(
            await page.locator('.loading-screen').count(),
            1,
            'Workspace vuoto protetto fino alla verifica legacy'
          )
          assert.equal(legacyCalls, 0)
        } else if (scenario === 'contacts-error') {
          await page
            .locator('.inline-error')
            .filter({ hasText: 'Contatti: Timeout contatti simulato' })
            .waitFor()
          assert.equal(await page.locator('.loading-screen').count(), 0)
        } else {
          await page.getByText(contact.name, { exact: true }).first().waitFor()
          assert.equal(
            summaryReleased,
            false,
            'Contatti visibili mentre il riepilogo è ancora sospeso'
          )
          await page
            .locator('.sidebar a[href="/todo"]')
            .filter({ hasText: '1' })
            .waitFor()
          assert.equal(await page.locator('.loading-screen').count(), 0)
        }
        summaryReleased = true
        releaseSummary()
        if (scenario === 'legacy-empty') {
          await page.getByText(contact.name, { exact: true }).first().waitFor()
          assert.equal(legacyCalls, 1)
          assert.equal(contactsCalls, 2)
        } else {
          await page
            .locator('.contacts-view-count')
            .filter({ hasText: /^4321$/ })
            .waitFor()
          assert.equal(legacyCalls, 0)
          // Uno storico fallito non deve cancellare le attività pending riuscite.
          await page
            .locator('.sidebar a[href="/todo"]')
            .filter({ hasText: '1' })
            .waitFor()
        }
        assert.deepEqual(unexpectedWrites, [])
        assert.deepEqual(errors, [])
        console.log(`PASS ${scenario}`)
      } finally {
        releaseSummary()
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
