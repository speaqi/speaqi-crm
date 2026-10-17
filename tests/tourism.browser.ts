/** UI contract checks against in-memory API fixtures. Database invariants are tested separately. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import pilot from '../src/data/tourism-italy-pilot'
import {
  normalizeRecord,
  parseTourismImport,
  nameKey
} from '../src/lib/tourism'

const baseUrl = process.env.TOURISM_TEST_URL || 'http://127.0.0.1:3000'
const output = process.env.TOURISM_TEST_OUTPUT || '/tmp/speaqi-tourism-browser'
const owner = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-17T10:00:00.000Z'
const rows = pilot.records.map((r, i) => ({
  ...normalizeRecord(r),
  id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`,
  name_key: nameKey(r.name),
  status: 'UNVERIFIED',
  version: 1,
  created_at: now,
  updated_at: now,
  crm: [] as { contact_id: string }[]
}))
const evidence = rows.map((r, i) => ({
  ...r.evidence,
  id: `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`,
  entity_id: r.id,
  status: 'UNVERIFIED',
  acquired_at: now,
  verified_at: null as string | null,
  verified_by: null as string | null
}))
const relations = pilot.relations.map((r, i) => ({
  id: `edge-${i}`,
  from_id: rows[r.from_index].id,
  to_id: rows[r.to_index].id,
  relation: r.relation,
  evidence_id: evidence[r.from_index].id
}))
const jobs: Record<string, unknown>[] = []
const calls: { path: string; body: Record<string, unknown> }[] = []
const errors: string[] = []
async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox']
  })
  try {
    const context = await browser.newContext({
      viewport: { width: 1512, height: 1100 },
      deviceScaleFactor: 1
    })
    await context.addInitScript(
      ({ owner }) => {
        const token =
          btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) +
          '.' +
          btoa(
            JSON.stringify({
              sub: owner,
              exp: Math.floor(Date.now() / 1000) + 3600
            })
          ) +
          '.local-test'
        localStorage.setItem(
          'speaqi-crm-auth',
          JSON.stringify({
            access_token: token,
            refresh_token: 'local-test',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
            user: {
              id: owner,
              email: 'owner@example.com',
              aud: 'authenticated',
              role: 'authenticated',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-01-01T00:00:00Z'
            }
          })
        )
      },
      { owner }
    )
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.href.startsWith(baseUrl)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const body =
        route.request().method() === 'GET'
          ? {}
          : route.request().postDataJSON() || {}
      const json = (value: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(value)
        })
      calls.push({ path: url.pathname, body })
      if (url.pathname === '/api/tourism/discovery') {
        if (route.request().method() === 'GET')
          return json({ jobs, configured: false })
        if (body.action === 'create') {
          const job = {
            id: '55555555-5555-4555-8555-555555555555',
            query: body.query,
            state: 'queued',
            attempts: 0,
            result: [],
            usage: {},
            created_at: now
          }
          jobs.push(job)
          return json({ job }, 201)
        }
        return json({ error: 'No provider configured' }, 503)
      }
      if (url.pathname === '/api/tourism') {
        if (route.request().method() === 'GET') {
          if (url.searchParams.get('view') === 'overview')
            return json({
              organizations: rows.filter((r) => r.kind === 'organization')
                .length,
              countries: 1,
              places: 7,
              verified: rows.filter(
                (r) => r.kind === 'organization' && r.status === 'VERIFIED'
              ).length,
              review: rows.filter(
                (r) => r.kind === 'organization' && r.status !== 'VERIFIED'
              ).length,
              new_week: 8,
              contacts: 4,
              crm: rows.filter((r) => r.crm.length).length,
              by_country: [
                {
                  country_code: 'IT',
                  total: rows.filter((r) => r.kind === 'organization').length,
                  verified: rows.filter((r) => r.status === 'VERIFIED').length
                }
              ]
            })
          if (url.searchParams.get('view') === 'graph')
            return json({ entities: rows, relations, evidence, limit: 500 })
          const id = url.searchParams.get('id')
          if (id) {
            const entity = rows.find((r) => r.id === id)!
            const edges = relations.filter(
              (r) => r.from_id === id || r.to_id === id
            )
            return json({
              entity,
              evidence: evidence.filter((e) => e.entity_id === id),
              relations: edges,
              neighbors: rows.filter((r) =>
                edges.some((e) => e.to_id === r.id || e.from_id === r.id)
              ),
              revisions: [
                {
                  id: 1,
                  table_name: 'tourism_entities',
                  operation: 'INSERT',
                  actor_id: owner,
                  created_at: now
                }
              ],
              contact: entity.crm.length
                ? {
                    id: entity.crm[0].contact_id,
                    name: entity.name,
                    company: entity.name,
                    email: entity.email,
                    phone: entity.phone,
                    status: 'New'
                  }
                : null
            })
          }
          let entities = rows.filter(
            (r) => r.kind === (url.searchParams.get('kind') || 'organization')
          )
          for (const [param, column] of [
            ['country', 'country_code'],
            ['type', 'type_code'],
            ['status', 'status']
          ] as const) {
            const value = url.searchParams.get(param)
            if (value) entities = entities.filter((r) => r[column] === value)
          }
          const q = url.searchParams.get('q')
          if (q)
            entities = entities.filter((r) =>
              r.name.toLowerCase().includes(q.toLowerCase())
            )
          return json({
            entities: entities.map((r) => ({
              ...r,
              evidence: evidence.filter((e) => e.entity_id === r.id)
            })),
            total: entities.length,
            page: 0,
            size: 50
          })
        }
        if (body.action === 'preview')
          return json(parseTourismImport(body.text))
        if (body.action === 'review') {
          const e = evidence.find((e) => e.id === body.evidence_id)!
          e.status = body.approve ? 'VERIFIED' : 'REJECTED'
          e.verified_at = now
          e.verified_by = owner
          const entity = rows.find((r) => r.id === body.id)!
          entity.status = body.approve ? 'VERIFIED' : 'NEEDS_REVIEW'
          entity.version++
          return json({ ok: true })
        }
        if (body.action === 'promote') {
          const r = rows.find((r) => r.id === body.id)!
          r.crm = [{ contact_id: '66666666-6666-4666-8666-666666666666' }]
          return json({ contact_id: r.crm[0].contact_id, created: true })
        }
        return json({ created: 1, duplicates: 0 })
      }
      if (url.pathname === '/api/team-members')
        return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname === '/api/contacts/summary')
        return json({ counts: { total: 1 } })
      if (url.pathname.startsWith('/api/contacts'))
        return json({ contacts: [] })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(baseUrl + '/tourism')
    await page
      .getByRole('heading', { name: 'Global Tourism Intelligence.' })
      .waitFor({ timeout: 60000 })
    await page.getByText('Una prospettiva globale').waitFor()
    await page.locator('.leaflet-overlay-pane path').first().waitFor()
    await page.screenshot({
      path: output + '/overview-desktop.png',
      fullPage: true
    })
    await page.setViewportSize({ width: 1512, height: 1450 })
    await page
      .locator('[data-tourism-workspace]')
      .screenshot({ path: output + '/workspace-preview.png' })
    await page.setViewportSize({ width: 1512, height: 1100 })
    await page
      .getByRole('button', { name: 'Directory', exact: false })
      .first()
      .click()
    await page.getByRole('button', { name: 'ENIT S.p.A.' }).waitFor()
    await page.getByLabel('Categoria', { exact: true }).selectOption('dmc')
    await page.getByRole('button', { name: 'Italy Creative' }).waitFor()
    await page
      .getByRole('button', { name: 'ENIT S.p.A.' })
      .waitFor({ state: 'hidden' })
    assert.equal(
      await page.getByRole('button', { name: 'ENIT S.p.A.' }).count(),
      0
    )
    await page.getByLabel('Categoria', { exact: true }).selectOption('')
    await page.getByLabel('Cerca organizzazioni').fill('Toscana')
    await page
      .getByRole('button', { name: 'Toscana Promozione Turistica' })
      .waitFor()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr').length === 1
    )
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.getByLabel('Cerca organizzazioni').fill('')
    await page.getByRole('button', { name: 'ENIT S.p.A.' }).waitFor()
    await page.getByRole('button', { name: 'ENIT S.p.A.' }).click()
    const detail = page.getByRole('dialog', { name: 'ENIT S.p.A.' })
    await detail.waitFor()
    assert.equal(
      await detail.getByRole('button', { name: 'Add to CRM' }).isDisabled(),
      true
    )
    await detail
      .getByRole('button', { name: 'Conferma verifica' })
      .first()
      .click()
    await page
      .getByRole('dialog', { name: 'Conferma operazione' })
      .getByRole('button', { name: 'Conferma', exact: true })
      .click()
    await detail.getByText('Identità verificata', { exact: true }).waitFor()
    await detail.getByRole('button', { name: 'Add to CRM' }).click()
    await page
      .getByRole('dialog', { name: 'Conferma operazione' })
      .getByRole('button', { name: 'Conferma', exact: true })
      .click()
    await detail.getByRole('heading', { name: 'Collegamento CRM' }).waitFor()
    await page.screenshot({
      path: output + '/profile-desktop.png',
      fullPage: true
    })
    await detail.getByRole('button', { name: 'Chiudi finestra' }).click()
    await page.getByRole('button', { name: 'Importa dati' }).click()
    const importDialog = page.getByRole('dialog', {
      name: 'Importa organizzazioni e territori'
    })
    await importDialog
      .getByLabel('Dati da importare')
      .fill(
        'name,country_code,type_code,source_url\nFonte non valida,IT,dmo,javascript:alert(1)'
      )
    await importDialog
      .getByRole('button', { name: 'Controlla e mostra anteprima' })
      .click()
    await importDialog.getByText(/Riga 1:/).waitFor()
    assert.equal(
      await importDialog
        .getByRole('button', { name: 'Approva importazione' })
        .isDisabled(),
      true
    )
    await importDialog.getByRole('button', { name: 'Chiudi finestra' }).click()
    await page.getByRole('button', { name: 'Territori e relazioni' }).click()
    await page.getByLabel('Entità al centro del grafo').selectOption(rows[0].id)
    await page
      .getByRole('img', { name: 'Relazioni documentate di ENIT S.p.A.' })
      .waitFor()
    await page.screenshot({
      path: output + '/relationships-desktop.png',
      fullPage: true
    })
    await page
      .getByRole('button', { name: 'AI Discovery', exact: true })
      .click()
    await page
      .getByLabel('Richiesta AI Discovery')
      .fill('Trova le DMO della Toscana')
    await page.getByRole('button', { name: 'Avvia ricerca' }).click()
    await page
      .getByRole('heading', { name: 'Trova le DMO della Toscana' })
      .waitFor()
    assert.equal(
      calls.some(
        (c) => c.path.endsWith('discovery') && c.body.action === 'run'
      ),
      false
    )
    await page.getByRole('button', { name: 'Panoramica', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.leaflet-overlay-pane path').first().waitFor()
    await page.screenshot({
      path: output + '/overview-mobile.png',
      fullPage: true
    })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    assert.equal(
      overflow,
      false,
      'Mobile viewport must not overflow horizontally'
    )
    const box = await page.locator('[data-tourism-workspace]').boundingBox()
    assert.ok(
      box && box.x >= 0 && box.x + box.width <= 391,
      'The module itself must fit the mobile viewport'
    )
    assert.deepEqual(errors, [])
    assert.ok(calls.some((c) => c.body.action === 'review'))
    assert.ok(calls.some((c) => c.body.action === 'promote'))
    await writeFile(
      output + '/results.json',
      JSON.stringify(
        {
          passed: [
            'dashboard',
            'category filter',
            'debounced search',
            'review gate',
            'explicit CRM promotion',
            'invalid import blocks approval',
            'relationship graph',
            'unconfigured discovery queue',
            'mobile viewport'
          ],
          pageErrors: errors,
          mode: 'Browser UI with mocked API contracts; no remote writes'
        },
        null,
        2
      )
    )
    console.log(`9 browser checks passed. Screenshots: ${output}`)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
