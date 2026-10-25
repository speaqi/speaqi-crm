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
  disabled: false,
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
const existingContact = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Contatto esistente',
  company: 'Toscana CRM esistente',
  email: 'preserved@example.org',
  phone: '+390123',
  country: 'IT',
  status: 'In progress'
}
const suggestions = new Map([
  [
    rows[1].id,
    [
      {
        id: '88888888-8888-4888-8888-888888888888',
        contact_id: existingContact.id,
        score: 97,
        rule: 'website_domain',
        matched_at: now,
        contact: existingContact
      }
    ]
  ]
])
const relations = pilot.relations.map((r, i) => ({
  id: `edge-${i}`,
  from_id: rows[r.from_index].id,
  to_id: rows[r.to_index].id,
  relation: r.relation,
  evidence_id: evidence[r.from_index].id
}))
const jobs: Record<string, unknown>[] = []
let siteScanned = false
const sourceId = '99999999-9999-4999-8999-999999999999'
const siteReport = {
  schema_version: 1,
  site_url: 'https://example.org/',
  fetched_at: now,
  state: 'completed',
  title: 'Official destination catalogue',
  destination_signals: ['Sezione dedicata a luoghi o attrazioni'],
  languages: ['it', 'en'],
  map_detected: true,
  catalogue_pages: [
    { url: 'https://example.org/places', label: 'Luoghi', category: 'place' }
  ],
  sitemap_urls_seen: 100,
  place_url_candidates: 30,
  restaurant_url_candidates: 5,
  declared_lists: [],
  candidates: [
    {
      source_url: 'https://example.org/poi/museum',
      name: 'Museum fixture',
      category: 'place',
      latitude: 40.8,
      longitude: 14.2,
      address: 'Public square',
      evidence_kind: 'jsonld'
    }
  ],
  geocoded_candidates: 1,
  requests: 15,
  bytes: 100000,
  duration_ms: 15000,
  sample_limited: true,
  count_note: 'Campione di URL e schede: non è il totale del sito.',
  errors: [],
  receipts: []
}
const siteSource = () => ({
  id: sourceId,
  entity_id: rows[0].id,
  url: 'https://example.org/',
  label: 'Destination fixture',
  country_code: 'IT',
  official_status: 'candidate',
  destination_status: 'candidate',
  review_url: null,
  review_note: '',
  enabled: false,
  interval_days: 30,
  max_requests: 15,
  next_run_at: now,
  last_scanned_at: siteScanned ? now : null,
  last_state: siteScanned ? 'completed' : null,
  version: siteScanned ? 2 : 1,
  latest_report: siteScanned ? siteReport : null
})
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
      if (url.pathname === '/api/tourism/research') {
        if (route.request().method() === 'POST') {
          if (body.action === 'scan') {
            siteScanned = true
            return json({
              report: siteReport,
              source_id: sourceId,
              changes: { baseline: true, added: 1 }
            })
          }
          return json({ error: 'Unexpected research write' }, 400)
        }
        if (url.searchParams.get('view') === 'overview')
          return json({
            sources: 1,
            enabled: 0,
            scanned: siteScanned ? 1 : 0,
            destination_confirmed: 0,
            poi_candidates: siteScanned ? 1 : 0,
            geocoded: siteScanned ? 1 : 0,
            approved_poi: 0,
            requests_last_30_days: siteScanned ? 15 : 0,
            opportunities: 0,
            stages: {},
            project_statuses: {},
            worker_available: true,
            coverage: [
              {
                country_code: 'IT',
                organizations: 8,
                verified: 1,
                with_website: 8,
                nto: 1,
                rto: 1,
                local_destinations: 6,
                dmc: 0,
                ota: 0,
                official_denominator: null
              }
            ]
          })
        if (url.searchParams.get('source_id'))
          return json({
            source: siteSource(),
            scans: [],
            pois: siteScanned
              ? [
                  {
                    ...siteReport.candidates[0],
                    id: 'poi-fixture',
                    state: 'candidate',
                    reuse_status: 'unknown',
                    reuse_url: null
                  }
                ]
              : [],
            total: siteScanned ? 1 : 0,
            page: 0
          })
        if (url.searchParams.get('view') === 'review')
          return json({
            entities: rows
              .filter((r) => r.kind === 'organization')
              .map((r) => ({
                ...r,
                evidence: evidence.filter((e) => e.entity_id === r.id)
              })),
            total: 8,
            page: 0
          })
        if (
          ['canonical', 'opportunities'].includes(
            url.searchParams.get('view') || ''
          )
        )
          return json({ rows: [], total: 0 })
        return json({ sources: [siteSource()], total: 1, page: 0, size: 50 })
      }
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
          if (url.searchParams.get('view') === 'coverage')
            return json({
              reference_countries: 2,
              countries_with_organizations: 1,
              countries_without_organizations: 1,
              matched_organizations: suggestions.size,
              by_country: [
                { country_code: 'IT', name: 'Italy', total: 8, verified: 0 },
                {
                  country_code: 'GB',
                  name: 'United Kingdom',
                  total: 0,
                  verified: 0
                }
              ],
              runs: [
                {
                  id: 'fixture-run',
                  run_key: 'fixture-public-sources',
                  state: 'completed',
                  started_at: now,
                  completed_at: now,
                  sources: [{ source: 'wtm:london', rows: 8 }],
                  stats: { organizations: 8, raw_exhibitors: 8 }
                }
              ]
            })
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
              matches: suggestions.get(id) || [],
              contact:
                entity.crm.length &&
                entity.crm[0].contact_id === existingContact.id
                  ? existingContact
                  : entity.crm.length
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
          const availability = url.searchParams.get('availability') || 'active'
          if (availability !== 'all')
            entities = entities.filter(
              (r) => r.disabled === (availability === 'disabled')
            )
          if (url.searchParams.get('crm') === 'matched')
            entities = entities.filter((row) =>
              Boolean(suggestions.get(row.id)?.length)
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
              matches: (suggestions.get(r.id) || []).map((match) => ({
                ...match,
                state: 'candidate'
              })),
              evidence: evidence.filter((e) => e.entity_id === r.id)
            })),
            total: entities.length,
            page: 0,
            size: 50
          })
        }
        if (body.action === 'preview')
          return json(parseTourismImport(body.text))
        if (body.action === 'set_disabled') {
          const r = rows.find((r) => r.id === body.id)!
          assert.equal(body.version, r.version)
          r.disabled = body.disabled
          r.version++
          return json({ id: r.id, disabled: r.disabled, version: r.version })
        }
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
        if (body.action === 'activate') {
          const r = rows.find((r) => r.id === body.id)!
          assert.equal(body.version, r.version)
          r.status = 'VERIFIED'
          r.version++
          if (suggestions.has(r.id))
            return json({ contact_id: null, contact_created: false, crm_error: 'Possible CRM matches require review before creating a contact', crm_error_text: 'c’è un possibile doppione nel CRM: confermalo dalla scheda dell’ente' })
          r.crm = [{ contact_id: '66666666-6666-4666-8666-666666666666' }]
          return json({ contact_id: r.crm[0].contact_id, contact_created: true, crm_error: null, crm_error_text: null })
        }
        if (body.action === 'promote') {
          const r = rows.find((r) => r.id === body.id)!
          r.crm = [{ contact_id: '66666666-6666-4666-8666-666666666666' }]
          return json({ contact_id: r.crm[0].contact_id, created: true })
        }
        if (body.action === 'link_existing') {
          const row = rows.find((r) => r.id === body.id)!
          assert.equal(row.status, 'VERIFIED')
          row.crm = [{ contact_id: existingContact.id }]
          suggestions.delete(row.id)
          return json({ contact_id: existingContact.id, created: false })
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
    await page
      .getByRole('region', { name: 'Acquisizione e copertura' })
      .waitFor()
    await page
      .getByText('Copertura per paese e territorio', { exact: true })
      .click()
    assert.equal(
      await page
        .getByRole('button', { name: 'Regno Unito', exact: true })
        .count(),
      1
    )
    await page
      .getByText('Copertura per paese e territorio', { exact: true })
      .click()
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
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor()
    await page
      .getByLabel('Corrispondenze CRM', { exact: true })
      .selectOption('matched')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'Toscana Promozione Turistica' })
      .waitFor()
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor({ state: 'hidden' })
    await page
      .getByLabel('Corrispondenze CRM', { exact: true })
      .selectOption('')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor()
    await page.getByLabel('Categoria', { exact: true }).selectOption('ota')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor({ state: 'hidden' })
    assert.equal(
      await page.getByLabel('Categoria', { exact: true }).inputValue(),
      'ota'
    )
    await page.getByLabel('Categoria', { exact: true }).selectOption('dmc')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'Italy Creative' })
      .waitFor()
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor({ state: 'hidden' })
    assert.equal(
      await page
        .locator('button[class*=entityName]')
        .filter({ hasText: 'ENIT S.p.A.' })
        .count(),
      0
    )
    await page.getByLabel('Categoria', { exact: true }).selectOption('')
    await page.getByLabel('Cerca organizzazioni').fill('Toscana')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'Toscana Promozione Turistica' })
      .waitFor()
    await page.waitForFunction(
      () => document.querySelectorAll('tbody tr').length === 1
    )
    assert.equal(await page.locator('tbody tr').count(), 1)
    await page.getByLabel('Cerca organizzazioni').fill('')
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .waitFor()
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'ENIT S.p.A.' })
      .click()
    const detail = page.getByRole('dialog', { name: 'ENIT S.p.A.' })
    await detail.waitFor()
    // Scheda snella: un gesto solo verifica e porta nei contatti.
    await detail.getByRole('button', { name: 'Conferma e aggiungi ai contatti' }).click()
    await detail.getByText('nei contatti', { exact: false }).first().waitFor()
    await page.screenshot({
      path: output + '/profile-desktop.png',
      fullPage: true
    })
    await detail.getByRole('button', { name: 'Chiudi finestra' }).click()
    await page
      .locator('button[class*=entityName]')
      .filter({ hasText: 'Toscana Promozione Turistica' })
      .click()
    const matchingDetail = page.getByRole('dialog', {
      name: 'Toscana Promozione Turistica'
    })
    await matchingDetail
      .getByRole('heading', { name: 'Corrispondenze nel CRM da confermare' })
      .waitFor()
    assert.equal(
      await matchingDetail
        .getByRole('button', { name: 'Conferma collegamento' })
        .isDisabled(),
      true
    )
    // La conferma verifica la scheda; il possibile doppione ferma solo il passaggio nel CRM.
    await matchingDetail.getByRole('button', { name: 'Conferma e aggiungi ai contatti' }).click()
    await page.getByText('possibile doppione', { exact: false }).first().waitFor()
    await matchingDetail
      .getByRole('button', { name: 'Conferma collegamento' })
      .click()
    await page
      .getByRole('dialog', { name: 'Conferma operazione' })
      .getByRole('button', { name: 'Conferma', exact: true })
      .click()
    await matchingDetail
      .getByRole('link', { name: 'Toscana CRM esistente ↗' })
      .first()
      .waitFor()
    assert.equal(
      calls.some(
        (call) => call.body.action === 'promote' && call.body.id === rows[1].id
      ),
      false
    )
    await matchingDetail
      .getByRole('button', { name: 'Chiudi finestra' })
      .click()
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
    await page
      .getByRole('button', { name: 'Directory', exact: false })
      .first()
      .click()
    const toggleName = rows[7].name
    const websiteLink = page.getByRole('link', {
      name: `Apri sito di ${toggleName}`,
      exact: true
    })
    assert.equal(await websiteLink.getAttribute('href'), rows[7].website)
    assert.equal(await websiteLink.getAttribute('target'), '_blank')
    await page
      .getByRole('button', { name: `Disabilita ${toggleName}`, exact: true })
      .click()
    await page
      .locator('button[class*=entityName]').filter({ hasText: toggleName })
      .waitFor({ state: 'hidden' })
    await page
      .getByLabel('Disponibilità nel catalogo', { exact: true })
      .selectOption('disabled')
    await page
      .getByRole('button', { name: `Riattiva ${toggleName}`, exact: true })
      .click()
    await page
      .getByLabel('Disponibilità nel catalogo', { exact: true })
      .selectOption('active')
    await page.locator('button[class*=entityName]').filter({ hasText: toggleName }).waitFor()
    await page
      .getByRole('button', { name: 'Ricerca siti e progetti', exact: true })
      .click()
    await page.getByText('Destination fixture', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Analizza', exact: true }).click()
    assert.equal(
      await page
        .getByRole('button', { name: 'Esporta GeoJSON approvato' })
        .isDisabled(),
      true
    )
    await page.getByRole('button', { name: 'Esegui analisi limitata' }).click()
    await page
      .getByRole('link', { name: 'Museum fixture', exact: true })
      .waitFor()
    await page
      .getByRole('heading', { name: 'Destination fixture', exact: true })
      .waitFor()
    assert.equal(
      await page
        .getByRole('button', { name: 'Esporta GeoJSON approvato' })
        .isDisabled(),
      true
    )
    await page.screenshot({
      path: output + '/site-research-desktop.png',
      fullPage: true
    })
    await page
      .getByRole('button', { name: 'Volumi e costi', exact: true })
      .click()
    await page.getByText(/Ipotesi di budget modificabili/).waitFor()
    await page
      .getByRole('button', { name: 'Verifiche e duplicati', exact: true })
      .click()
    assert.equal(
      await page
        .getByRole('button', { name: 'Conferma 0 verifiche' })
        .isDisabled(),
      true
    )
    await page
      .getByRole('button', { name: 'Lacune territoriali', exact: true })
      .click()
    await page
      .getByRole('cell', { name: 'Non misurata', exact: true })
      .waitFor()
    await page
      .getByRole('button', { name: 'Progetti e attività', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Nuovo progetto proposto' })
      .waitFor()
    assert.ok(
      !calls.some(
        (c) =>
          c.path === '/api/tourism/research' &&
          ['bulk_review', 'review_poi', 'task'].includes(String(c.body.action))
      )
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: 'Siti e mappe', exact: true })
      .click()
    await page
      .getByRole('heading', { name: 'Destination fixture', exact: true })
      .waitFor()
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      ),
      false,
      'Site research must fit mobile viewport'
    )
    await page.screenshot({
      path: output + '/site-research-mobile.png',
      fullPage: true
    })
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
    // La revisione fonte per fonte resta in «Altri dettagli», ma non serve più per entrare nel CRM.
    assert.ok(calls.some((c) => c.body.action === 'activate'))
    await writeFile(
      output + '/results.json',
      JSON.stringify(
        {
          passed: [
            'dashboard',
            'country coverage and acquisition receipt',
            'CRM correspondence filter',
            'category filter',
            'debounced search',
            'review gate',
            'explicit CRM promotion',
            'existing CRM match confirmation without duplicate creation',
            'invalid import blocks approval',
            'relationship graph',
            'unconfigured discovery queue',
            'mobile viewport',
            'site analysis preserves candidate and reuse gates',
            'cost assumptions visible',
            'batch verification requires manual attestation',
            'territorial coverage does not claim completeness',
            'project dossiers do not trigger CRM actions',
            'direct external website links',
            'disable and reactivate directly from directory with availability filter'
          ],
          pageErrors: errors,
          mode: 'Browser UI with mocked API contracts; no remote writes'
        },
        null,
        2
      )
    )
    console.log(`19 browser checks passed. Screenshots: ${output}`)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
