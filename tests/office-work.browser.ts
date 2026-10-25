/** Pannello reale, API simulate; nessun accesso a servizi o dati di produzione.
 * OFFICE_TEST_URL=http://127.0.0.1:3227 CHROMIUM_PATH=/tmp/chromium node --import tsx tests/office-work.browser.ts
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'

const base = process.env.OFFICE_TEST_URL || 'http://127.0.0.1:3227'
const out = process.env.OFFICE_TEST_OUTPUT || '/tmp/office-work-ui'
const OWNER = '11111111-1111-4111-8111-111111111111'
const ORDER = '22222222-2222-4222-8222-222222222222'
const WORK = '33333333-3333-4333-8333-333333333333'
const OUTPUT = '44444444-4444-4444-8444-444444444444'
const zeros = { day_actual: 0, day_reserved: 0, week_actual: 0, week_reserved: 0, month_actual: 0, month_reserved: 0 }
let supported = true
let work: any = { id: WORK, user_id: OWNER, order_id: ORDER, agent_id: 'mymaps_builder', action: 'import_mymaps',
  payload: { slug: 'marsiglia', city: 'Marsiglia' }, payload_version: 1, status: 'blocked', priority: 80, revision: 2,
  reason_code: 'source_missing', reason: 'Manca la fonte pubblica della mappa.', required_action: 'Aggiungi il link My Maps.',
  responsible: 'mymaps_builder', next_check_at: null, created_at: '2026-10-25T07:00:00Z', phase: 'ready', result_summary: null }
const mutations: any[] = []

async function main() {
  await mkdir(out, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/tmp/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await context.addInitScript(({ owner }) => {
      if (window.top !== window) return
      const token = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.test'
      localStorage.setItem('speaqi-crm-auth', JSON.stringify({ access_token: token, refresh_token: 'test', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: owner, email: 'owner@example.it', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } }))
    }, { owner: OWNER })
    await context.route('**/*', async (route) => {
      const request = route.request(); const url = new URL(request.url())
      if (!url.href.startsWith(base)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (url.pathname === '/api/ufficio/scena') return route.fulfill({ contentType: 'text/html', body: '<html><body>Scena esclusa da questo collaudo del pannello.</body></html>' })
      if (url.pathname === '/api/ufficio/sblocca') return json({ enabled: false, locked: false })
      if (url.pathname === '/api/office') return json({ agents: Object.values(OFFICE_AGENT_DEFINITIONS).map((agent) => ({ ...agent, enabled: true, user_id: OWNER, spend: { ...zeros, agent_id: agent.id }, last_run: null })),
        runs: [], outputs: [], pending_count: 0, totals: zeros, active_agents: 12 })
      if (url.pathname === '/api/office/director/orders') return json({ orders: [{ id: ORDER, text: 'Costruisci la mappa di Marsiglia', source: 'web', attachments: [], status: 'blocked', reply: 'Manca il link My Maps. Il lavoro resta salvato.', created_at: work.created_at }] })
      if (url.pathname === '/api/office/work') {
        const listed = supported && (url.searchParams.get('view') === 'all' || !['cancelled', 'succeeded', 'failed'].includes(work.status)) ? [work] : []
        return json({ supported, works: listed, total: listed.length, offset: 0 })
      }
      if (url.pathname === `/api/office/work/${WORK}` && request.method() === 'PATCH') {
        const body = request.postDataJSON(); mutations.push(body)
        if (body.action === 'update_payload') work = { ...work, payload: { ...work.payload, ...body.payload }, status: 'ready', revision: work.revision + 1,
          reason: null, required_action: 'L’agente ricontrolla la fonte al prossimo turno.' }
        if (body.action === 'cancel') work = { ...work, status: 'cancelled', revision: work.revision + 1 }
        return json({ work, notice: body.action === 'cancel' ? 'Lavoro annullato.' : 'Dati aggiornati. Il lavoro riprende dopo il controllo dei prerequisiti.' })
      }
      if (url.pathname === `/api/office/work/${WORK}`) return json({ work,
        attempts: [{ id: 'attempt', run_id: 'corsa-di-prova', started_at: work.created_at, finished_at: work.created_at }],
        dependencies: [], outputs: [{ id: OUTPUT, title: 'Rapporto importazione', status: 'pending' }], events: [] })
      if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname.startsWith('/api/contacts')) return json({ contacts: [], counts: { total: 0 } })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/ufficio`)
    await page.getByRole('tab', { name: 'Lavori', exact: true }).click()
    const list = page.getByRole('region', { name: 'Lavori dell’ufficio' })
    await list.getByRole('heading', { name: 'Importare la mappa · Marsiglia' }).waitFor()
    await list.getByText('Manca la fonte pubblica della mappa.', { exact: true }).waitFor()
    assert.ok(await list.getByText('Se ne occupa: Costruttore My Maps.').isVisible())
    await page.screenshot({ path: `${out}/01-blocco.png`, fullPage: true })
    await list.getByRole('button', { name: 'Completa i dati' }).click()
    await list.getByLabel('Link My Maps').fill('https://www.google.com/maps/d/viewer?mid=public-source')
    await list.getByRole('button', { name: 'Salva i dati' }).click()
    await list.getByText('Pronto', { exact: true }).waitFor()
    assert.equal(mutations[0].expected_revision, 2)
    assert.deepEqual(Object.keys(mutations[0]).sort(), ['action', 'expected_revision', 'payload'])
    assert.equal(mutations[0].payload.source, 'https://www.google.com/maps/d/viewer?mid=public-source')
    await list.getByText('Risultati e cronologia', { exact: true }).click()
    await list.getByRole('link', { name: 'Rapporto importazione' }).waitFor()
    assert.ok(await list.getByText('Corsa corsa-di-prova').isVisible())
    await page.getByRole('button', { name: 'Lavori dell’ordine', exact: true }).click()
    await page.getByRole('region', { name: 'Lavori dell’ordine' }).getByRole('heading', { name: 'Importare la mappa · Marsiglia' }).waitFor()
    await page.getByRole('button', { name: 'Chiudi lavori dell’ordine' }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'pannello senza scorrimento orizzontale su telefono')
    await list.screenshot({ path: `${out}/02-mobile.png` })
    await list.getByRole('button', { name: 'Anche conclusi' }).click()
    await list.getByRole('button', { name: 'Annulla lavoro' }).click()
    await list.getByText('Annullato', { exact: true }).waitFor()
    supported = false
    await list.getByRole('button', { name: 'Aggiorna lavori' }).click()
    await list.getByText('Il registro dei lavori è in aggiornamento. Gli ordini restano salvati.', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('Pannello Lavori verificato: blocco, fonte corretta con versione, risultati/corse, legame ordine, telefono, annullamento e schema assente. API simulate; nessun servizio remoto.')
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
