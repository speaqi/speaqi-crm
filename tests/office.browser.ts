/** UI reale su next build/start, API simulate. Nessuna chiamata a modelli o mappe.
 * OFFICE_TEST_URL=http://127.0.0.1:3215 CHROMIUM_PATH=... npm run test:office:ui
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import type { OfficeAgent, OfficeOverview, OfficeOutput, OfficeRun } from '../src/lib/office'
import type { OfficeWorkSummary } from '../src/lib/office-activity'
import { UFFICIO_SCENE_HTML } from '../src/lib/server/ufficio-scene'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'

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
let sceneOverview: OfficeOverview | null = null
let partialInbox = false
const phase = (key: string, state: string, detail: string) => ({ key, state, detail })
const production = { available: true, generated_at: '2026-11-12T08:00:00Z', studio_url: 'https://studiomap.speaqi.com', credit_usd: 3.5,
  totals: { cities: 2, live: 1, live_behind: 0, in_progress: 1, places: 400, writing_usd: 2.1 },
  rows: [
    { slug: 'marsiglia', name: 'Marsiglia', protected: false, live: false, public_url: null, places: 150, done: 4, error: null, writing_usd: 2.1,
      next: { phase: 'themes', text: 'Scrivere i temi (5/8 temi)' },
      phases: [phase('places', 'done', '150 luoghi'), phase('texts', 'done', 'tutti scritti'), phase('themes', 'partial', '5/8 temi'), phase('intro', 'todo', 'manca'),
        phase('routes', 'done', '3 itinerari'), phase('checks', 'partial', '4 da decidere'), phase('speaqi', 'todo', 'non collegata'), phase('live', 'todo', 'non pubblicata')] },
    { slug: 'roma', name: 'Roma', protected: false, live: true, public_url: 'https://guides.speaqi.com/maps/romamap', places: 250, done: 8, error: null, writing_usd: null, next: null,
      phases: ['places', 'texts', 'themes', 'intro', 'routes', 'checks', 'speaqi', 'live'].map((key) => phase(key, 'done', 'ok')) },
  ] }
let commandPolls = 0
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
    await context.addInitScript(({ owner }) => {
      if (window.top !== window) return
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
      if (url.pathname === '/api/ufficio/scena') return route.fulfill({ contentType: 'text/html', body: UFFICIO_SCENE_HTML })
      if (url.pathname === '/api/ufficio/sblocca') return json({ enabled: false, locked: false })
      if (url.pathname === '/api/office/production/action') {
        if (body.dry_run) return json({ ok: true, plan: { action: body.action, name: 'Marsiglia', allowed: true, reason: 'Da scrivere: 3 temi e la presentazione. I testi già scritti restano.',
          estimate_usd: 0.8, estimate_max_usd: 1.4, warning: null, credit_usd: 3.5 } })
        commandPolls++
        return json({ ok: true, job: commandPolls < 2 ? { done: false, interrupted: false, phase: 'Temi', last: 'Scrivo «Sapori e prodotti tipici»', error: null }
          : { done: true, interrupted: false, phase: 'Temi', last: 'Otto temi scritti', error: null } })
      }
      if (url.pathname === '/api/office/production') return json(production)
      if (url.pathname === '/api/office/system') return json({ schedulerOn: true, schedulerJobs: 'backup', lastBackupAt: '2026-10-26T02:01:07Z', backupOk: true })
      if (url.pathname === '/api/office') return fail ? json({ error: 'Database di prova non disponibile' }, 500) : json(sceneOverview || overview())
      if (url.pathname === '/api/office/inbox') {
        const current = sceneOverview || overview()
        if (method === 'GET') return json({ outputs: current.outputs.map((output) => ({ ...output,
          document: output.target_table === 'tourism_decks' ? { id: output.target_id, title: 'Presentazione per Marsiglia', status: 'ready', version: 3 } : null })),
          total: current.pending_count, offset: 0 })
        const results = body.ids.map((id: string) => partialInbox && id === 'inbox-contact-2' ? { id, ok: false, error: 'Completa i dati del contatto' } : { id, ok: true })
        const done = new Set(results.filter((row: any) => row.ok).map((row: any) => row.id))
        if (sceneOverview) { sceneOverview.outputs = sceneOverview.outputs.filter((output) => !done.has(output.id)); sceneOverview.pending_count = sceneOverview.outputs.length }
        else outputs = outputs.filter((output) => !done.has(output.id))
        return json({ results })
      }
      if (/^\/api\/office\/agents\/[^/]+$/.test(url.pathname) && method === 'GET') {
        const id = url.pathname.split('/').pop()
        return json({ runs: (sceneOverview?.runs || runs).filter((run) => run.agent_id === id),
          outputs: (sceneOverview?.outputs || outputs).filter((output) => output.agent_id === id), total: 1, offset: 0 })
      }
      if (url.pathname === '/api/office/work') {
        const id = url.searchParams.get('agent_id')
        const works = (sceneOverview?.works || []).filter((work) => (!id || work.agent_id === id)
          && (url.searchParams.get('view') === 'all' || work.status !== 'succeeded'))
        return json({ supported: true, works: works.map((work) => ({ ...work, payload: {}, result: work.status === 'succeeded'
          ? { deck_id: '33333333-3333-4333-8333-333333333333' } : {} })), total: works.length, offset: 0 })
      }
      if (url.pathname === '/api/office/agents/prova' && method === 'PATCH') { agent = { ...agent, ...body }; return json({ agent }) }
      if (url.pathname === '/api/office/agents/prova/run-now') {
        if (skipRun) return json({ run: null, skipped: 'already_running' })
        const run: OfficeRun = { id: 'corsa', agent_id: agent.id, user_id: OWNER, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), status: 'done', summary: 'Preparato un report', items_created: 1, cost_cents_actual: 1, cost_cents_reserved: 1, error: null, details: {} }
        runs = [run]; return json({ run })
      }
      if (url.pathname.startsWith('/api/office/outputs/') && method === 'PATCH') { outputs = outputs.filter((o) => o.id !== url.pathname.split('/').pop()); return json({ output: { status: body.status } }) }
      if (url.pathname === '/api/command-center') return json({ waiting: [{ kind: 'office_output', title: 'Report da controllare', detail: 'Ufficio', href: '/ufficio/agenti#uscita-uscita-1', tone: 'act' }], office: overview(), money: { paid_month: 0, paid_month_count: 0, invoiced_month: 0, to_invoice_count: 0, to_invoice_amount: 0, renewals: [], renewals_amount: 0, past_due: [] }, sales: { open_deals: 0, by_stage: [], awaiting_signature: [], awaiting_signature_count: 0, awaiting_signature_amount: 0 }, maps: { counts: { online: 0, su_speaqi: 0, pronta: 0, in_lavorazione: 0 }, rows: [], sources: { studiomap: 'not_configured', speaqi: 'ok' } } })
      if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 0 } })
      if (url.pathname.startsWith('/api/contacts')) return json({ contacts: [] })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser:', error.message) })
    await page.goto(`${base}/ufficio/agenti`)
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
    await page.getByRole('button', { name: 'Segna come letto', exact: true }).click()
    await page.getByText('Nessuna uscita da valutare.').waitFor()
    assert.equal(outputs.length, 0)
    assert.equal(calls.find((call) => call.path === '/api/office/inbox' && call.method === 'POST')?.body.action, 'acknowledge')
    outputs = [{ ...output('uscita-2'), kind: 'proposal' }]
    await page.reload()
    await page.getByRole('button', { name: 'Rifiuta' }).click()
    await page.getByText('Nessuna uscita da valutare.').waitFor()
    assert.equal(calls.filter((call) => call.path === '/api/office/inbox' && call.method === 'POST').at(-1)?.body.action, 'rejected')
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
    assert.ok(await page.getByRole('link', { name: 'Apri l’Ufficio →' }).count())
    assert.ok(await page.locator('.cc-list').getByRole('link', { name: /Report da controllare/ }).count())

    // Il 3D riceve la stessa API: agenti reali installabili, stati simulati.
    const definitions = Object.values(OFFICE_AGENT_DEFINITIONS).sort((a, b) =>
      a.id === 'entity_enricher' ? -1 : b.id === 'entity_enricher' ? 1 : a.id.localeCompare(b.id))
    const sceneRuns: OfficeRun[] = definitions.slice(0, 4).map((definition, i) => ({ id: `run-${i}`, agent_id: definition.id, user_id: OWNER,
      started_at: '2026-10-23T08:00:00Z', finished_at: i === 0 ? null : '2026-10-23T08:01:00Z',
      status: i === 0 ? 'running' : i === 1 ? 'failed' : 'done', summary: ['Ricerca fonti in corso', 'Una fonte richiede una verifica', 'Report preparato', 'Rassegna pronta'][i],
      items_created: 1, cost_cents_actual: 4, cost_cents_reserved: 0, error: null, details: {} }))
    sceneOverview = { agents: definitions.map((definition, i) => ({ ...definition, user_id: OWNER, enabled: i < 5,
      spend: { ...spend, agent_id: definition.id }, last_run: sceneRuns.find((r) => r.agent_id === definition.id) || null })),
      runs: sceneRuns, outputs: [{ ...output('scena-uscita'), agent_id: definitions[0].id, title: 'Ente con recapiti da verificare' }],
      pending_count: 1, totals: { day_actual: 132, day_reserved: 55, week_actual: 264, week_reserved: 55, month_actual: 440, month_reserved: 55 }, active_agents: 5 }
    const work = (id: string, agentId: string, status: OfficeWorkSummary['status']): OfficeWorkSummary => ({
      id, agent_id: agentId, action: 'prepare_presentation', status, origin: 'order', order_id: 'order',
      created_at: '2026-10-26T08:00:00Z', updated_at: '2026-10-26T08:01:00Z',
      reason: status === 'blocked' ? 'Manca il sito ufficiale' : null, required_action: null, result_summary: status === 'succeeded' ? 'Documento preparato in precedenza' : '',
    })
    sceneOverview.works = [work('current', 'entity_enricher', 'blocked'), work('old', 'entity_enricher', 'succeeded'),
      work('finance-only', 'finance', 'blocked')]
    // La vista di partenza è la sala di controllo: le città, senza scaricare il 3D.
    await page.goto(`${base}/ufficio`)
    await page.getByRole('button', { name: 'Marsiglia' }).waitFor()
    assert.equal(calls.some((call) => call.path === '/api/ufficio/scena'), false, 'la scena 3D non si scarica finché non la si sceglie')
    assert.ok(await page.getByText('Scrivere i temi (5/8 temi)').isVisible())
    assert.ok(await page.getByText('Allineata').isVisible())
    assert.ok(await page.getByRole('heading', { name: 'Scrivi al Direttore' }).isVisible(), 'il pannello resta accanto alle città')
    await page.getByRole('button', { name: 'Marsiglia' }).click()
    const studio = page.getByRole('link', { name: 'Apri la città in StudioMap ↗' })
    assert.equal(await studio.getAttribute('href'), 'https://studiomap.speaqi.com/?map=marsiglia')
    await page.getByRole('button', { name: 'Fallo fare al Direttore' }).click()
    await page.getByText(/Ordine dato al Direttore/).waitFor()
    assert.equal(calls.filter((call) => call.path === '/api/office/director/orders' && call.method === 'POST').at(-1)?.body.text, 'Controlla la mappa di Marsiglia')
    // Un comando: prima il piano con la stima, poi la conferma, poi si segue fino alla fine.
    await page.getByRole('button', { name: 'Scrivi temi e presentazione…' }).first().click()
    await page.getByText(/Costo stimato/).waitFor()
    assert.ok(await page.getByText(/fino a 1,40 \$/).isVisible())
    assert.equal(calls.filter((call) => call.path === '/api/office/production/action' && !call.body.dry_run).length, 0, 'niente parte prima della conferma')
    await page.getByRole('button', { name: 'Conferma e avvia' }).click()
    await page.getByText(/Fatto — Otto temi scritti/).waitFor({ timeout: 15_000 })
    const commands = calls.filter((call) => call.path === '/api/office/production/action')
    assert.deepEqual([commands[0].body.action, commands[0].body.slug, commands[0].body.dry_run], ['write_guide', 'marsiglia', true])
    assert.ok(commands.slice(1).every((call) => call.body.request_id === commands[0].body.request_id && !call.body.dry_run), 'stesso identificativo dal piano allo stato')
    await page.screenshot({ path: `${out}/ufficio-comando.png` })
    await page.getByRole('searchbox', { name: 'Cerca una città' }).fill('rom')
    assert.equal(await page.getByRole('button', { name: 'Marsiglia' }).count(), 0)
    await page.screenshot({ path: `${out}/ufficio-citta.png` })
    await page.getByRole('tab', { name: 'Campus 3D' }).click()
    const office = page.frameLocator('iframe[title="Ufficio Speaqi"]')
    await office.locator('#stage canvas').waitFor()
    // Una pagina sola: la scena senza il suo pannello, la gestione nel pannello della pagina.
    await office.locator('#app.embedded').waitFor({ state: 'attached' })
    assert.equal(await office.locator('#panel').isHidden(), true)
    assert.equal(await office.locator('#fallback').isHidden(), true)
    assert.equal(await office.locator('.tag:not(.kiosk):not(.cities)').count(), 8)
    await page.getByRole('heading', { name: 'Scrivi al Direttore' }).waitFor()
    await page.getByRole('tab', { name: /Aspetta te/ }).getByText('1').waitFor()
    await page.getByRole('heading', { name: 'Ente con recapiti da verificare' }).waitFor()
    await page.screenshot({ path: `${out}/04-campus.png`, fullPage: true })
    // Il clic su un padiglione apre la sua squadra nel pannello; gli altri padiglioni restano.
    await office.locator('.tag:not(.kiosk):not(.cities)', { hasText: 'Ricerca' }).click()
    await page.getByRole('tab', { name: /Ricerca/, selected: true }).waitFor()
    await page.getByRole('heading', { name: 'Arricchimento enti' }).waitFor()
    await page.screenshot({ path: `${out}/05-reparto.png`, fullPage: true })
    assert.equal(await office.locator('.tag:not(.kiosk):not(.cities)').count(), 8)
    const shown = await office.locator('.tag:not(.kiosk):not(.cities)').evaluateAll((tags) => tags.filter((t) => (t as HTMLElement).style.display !== 'none').length)
    assert.ok(shown >= 2, `con un reparto aperto restano a schermo anche gli altri padiglioni (${shown})`)
    // Clic sul cartellino del personaggio: scheda esatta, lavori attuali e storico anche fuori dalle proposte recenti.
    await office.getByRole('button', { name: 'Apri scheda di Arricchimento enti', exact: true }).click()
    const activity = page.getByRole('region', { name: 'Scheda di Arricchimento enti', exact: true })
    await activity.getByRole('heading', { name: 'Cosa sta facendo' }).waitFor()
    await activity.locator('[data-work-id="current"]').waitFor()
    assert.equal(await activity.locator('[data-work-id="finance-only"]').count(), 0)
    await activity.getByRole('heading', { name: 'Cosa ha fatto' }).waitFor()
    await activity.getByText('Ricerca fonti in corso', { exact: true }).waitFor()
    await activity.getByRole('button', { name: 'Anche conclusi', exact: true }).click()
    await activity.getByText('Documento preparato in precedenza', { exact: true }).waitFor()
    assert.equal(await activity.getByRole('link', { name: 'Apri presentazione →', exact: true }).getAttribute('href'), '/tourism/presentazioni/33333333-3333-4333-8333-333333333333')
    await page.screenshot({ path: `${out}/06-scheda-personaggio.png`, fullPage: true })
    await activity.getByRole('button', { name: 'Chiudi scheda di Arricchimento enti' }).click()

    await activity.waitFor({ state: 'detached' })
    // Il personaggio si seleziona anche sul corpo 3D, senza usare il cartellino.
    await page.locator('iframe').evaluate((frame) => (frame as HTMLIFrameElement).contentWindow!.postMessage({
      type: 'office:focus', department: 'ricerca', agentId: 'entity_enricher',
    }, '*'))
    await office.locator('button.person-tag.sel[aria-label="Apri scheda di Arricchimento enti"]').waitFor({ state: 'attached' })
    const canvas = office.locator('#stage canvas')
    const canvasBox = await canvas.boundingBox()
    assert.ok(canvasBox)
    await canvas.click({ position: { x: canvasBox.width * 0.47, y: canvasBox.height * 0.42 } })
    await activity.getByRole('heading', { name: 'Cosa sta facendo' }).waitFor()
    await activity.getByRole('button', { name: 'Chiudi scheda di Arricchimento enti' }).click()
    // Lo stato bloccato dell'incarico prevale sulla corsa conclusa: stesso stato nel pannello e nel 3D.
    const research = sceneOverview.agents.find((agent) => agent.id === 'entity_enricher')!
    research.last_run = { ...sceneRuns[0], status: 'done', finished_at: '2026-10-26T08:01:00Z', summary: 'Verifica terminata senza presentazione' }
    await page.getByRole('button', { name: '↻ Aggiorna' }).click()
    await office.getByRole('button', { name: 'Apri scheda di Arricchimento enti', exact: true }).getByText(/Bloccato/).waitFor()
    await office.getByRole('button', { name: 'Apri scheda di Arricchimento enti', exact: true }).click()
    await activity.getByText('Bloccato · 1 incarico aperto', { exact: true }).waitFor()
    await activity.getByRole('button', { name: 'Chiudi scheda di Arricchimento enti' }).click()
    // Scegliere il reparto dal pannello muove anche la camera, e «Tutti» torna alla vista completa.
    await page.getByRole('button', { name: 'Tutti', exact: true }).click()
    await page.getByRole('tab', { name: /Squadra/, selected: true }).waitFor()
    await office.getByRole('button', { name: '↺ Vista completa' }).click()
    await office.getByRole('button', { name: 'Sera', exact: true }).click()
    await page.screenshot({ path: `${out}/07-sera.png`, fullPage: true })
    // Il totem «Aspetta te» non cambia pagina: apre le proposte nel pannello.
    await office.getByRole('button', { name: 'Aspetta te: 1 proposta da decidere' }).click()
    await page.getByRole('tab', { name: /Aspetta te/, selected: true }).waitFor()
    // Schermo intero: scena e pannello insieme; Esc nella scena lo chiude.
    await page.getByRole('button', { name: /Schermo intero/ }).click()
    await page.getByRole('button', { name: /Esci da schermo intero/ }).waitFor()
    const fullBox = await page.locator('iframe').boundingBox()
    assert.ok(fullBox && fullBox.x === 0 && fullBox.y === 0, 'a schermo intero il campus parte dal bordo')
    // A schermo intero il campus prende tutto lo schermo; il pannello è un cassetto.
    assert.ok(fullBox.width >= 1430, `a schermo intero il campus è largo quanto lo schermo (${fullBox.width})`)
    await page.getByRole('button', { name: 'Pannello', exact: true }).click()
    await page.getByRole('heading', { name: 'Scrivi al Direttore' }).waitFor()
    assert.ok((await page.getByRole('heading', { name: 'Scrivi al Direttore' }).boundingBox())!.x > 900, 'il cassetto si apre a destra')
    await page.getByRole('button', { name: 'Chiudi pannello', exact: true }).click()
    // Il campus mostra anche le città, il sistema e la giornata.
    await office.locator('.tag.cities').getByText('1 in produzione · 1 online').waitFor({ state: 'attached' })
    await office.locator('.task-tag.sys').getByText(/Pianificatore acceso · solo backup/).waitFor({ state: 'attached' })
    await office.locator('.task-tag.money').getByText(/Credito StudioMap: 3,50 \$ · sotto 5 \$/).waitFor({ state: 'attached' })
    await office.getByRole('button', { name: '▶ Rivedi oggi' }).click()
    await office.locator('#replay-line').waitFor()
    await office.getByRole('button', { name: '■ Ferma' }).click().catch(() => {})
    await page.getByRole('button', { name: /Esci da schermo intero/ }).click()
    await page.getByRole('button', { name: /Schermo intero/ }).waitFor()
    fail = true
    await page.getByRole('button', { name: '↻ Aggiorna' }).click()
    await page.getByRole('alert').filter({ hasText: 'Database di prova non disponibile' }).waitFor()
    fail = false
    await page.getByRole('button', { name: 'Riprova', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Database di prova non disponibile' }).waitFor({ state: 'detached' })
    await page.setViewportSize({ width: 390, height: 844 })
    // Dove il browser non concede lo schermo intero (iPhone), il campus copre comunque tutta la finestra.
    await page.evaluate(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('non permesso')) })
    await page.getByRole('button', { name: /Schermo intero/ }).click()
    await page.getByRole('button', { name: /Esci da schermo intero/ }).waitFor()
    const phoneFull = await page.locator('iframe').boundingBox()
    assert.ok(phoneFull && phoneFull.x === 0 && phoneFull.y === 0 && phoneFull.width === 390 && phoneFull.height === 844, `su telefono lo schermo intero copre la finestra (${JSON.stringify(phoneFull)})`)
    // Anche la scena dentro la cornice si ridisegna a tutta altezza.
    await page.waitForFunction(() => true, null, { timeout: 1000 }); await page.waitForTimeout(900)
    const toolsBox = await office.locator('#reset').boundingBox()
    assert.ok(toolsBox && toolsBox.y > 700, `i comandi della scena stanno in fondo allo schermo (${toolsBox?.y})`)
    await page.screenshot({ path: `${out}/08-telefono-schermo-intero.png` })
    await page.getByRole('button', { name: /Esci da schermo intero/ }).click()
    await page.getByRole('button', { name: /Schermo intero/ }).waitFor()
    const frameBox = await page.locator('iframe').boundingBox()
    assert.ok(frameBox && frameBox.y <= 230 && frameBox.height > 380, 'su telefono il 3D occupa la prima schermata, il pannello segue')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(await office.locator('body').evaluate((body) => body.scrollWidth <= innerWidth))
    await office.locator('.tag:not(.kiosk):not(.cities)', { hasText: 'Ricerca' }).click()
    await office.getByRole('button', { name: 'Apri scheda di Arricchimento enti', exact: true }).click()
    await activity.getByRole('heading', { name: 'Cosa sta facendo' }).waitFor()
    await activity.getByText('Bloccato · 1 incarico aperto', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'scheda del personaggio leggibile anche su telefono')
    await page.screenshot({ path: `${out}/08-3d-mobile.png`, fullPage: true })
    await activity.getByRole('button', { name: 'Chiudi scheda di Arricchimento enti' }).click()

    // Smaltimento: due rapporti dello stesso documento diventano una scheda; archiviare non approva il deck.
    sceneOverview.outputs = [
      { ...output('inbox-deck-old'), agent_id: 'presentations', target_table: 'tourism_decks', target_id: '55555555-5555-4555-8555-555555555555', body: { version: 1 } },
      { ...output('inbox-deck-new'), agent_id: 'presentations', target_table: 'tourism_decks', target_id: '55555555-5555-4555-8555-555555555555', body: { version: 2 } },
      { ...output('inbox-notice'), title: 'Rapporto informativo', agent_id: 'news_watch' },
      { ...output('inbox-contact-1'), kind: 'proposal', agent_id: 'director', title: 'Primo contatto' },
      { ...output('inbox-contact-2'), kind: 'proposal', agent_id: 'director', title: 'Secondo contatto' },
    ]
    sceneOverview.pending_count = 5
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.getByRole('button', { name: '↻ Aggiorna' }).click()
    await page.getByRole('tab', { name: /Aspetta te/ }).click()
    const inbox = page.getByRole('region', { name: 'Coda Aspetta te' })
    await inbox.getByRole('button', { name: 'Tutte (4)', exact: true }).waitFor()
    await inbox.getByRole('button', { name: 'Documenti (1)', exact: true }).click()
    await inbox.getByRole('heading', { name: 'Presentazione per Marsiglia' }).waitFor()
    assert.equal(await inbox.getByRole('link', { name: 'Apri documento →' }).getAttribute('href'), '/tourism/presentazioni/55555555-5555-4555-8555-555555555555')
    await inbox.getByText('Da rivedere · versione 3', { exact: true }).waitFor()
    await inbox.getByRole('button', { name: 'Seleziona questa vista' }).click()
    await page.screenshot({ path: `${out}/09-coda-raggruppata.png`, fullPage: true })
    await inbox.getByRole('button', { name: 'Archivia avvisi selezionati (2)' }).click()
    await inbox.getByText('2 avvisi archiviati.', { exact: true }).waitFor()
    const archived = calls.filter((call) => call.path === '/api/office/inbox' && call.method === 'POST').at(-1)!
    assert.deepEqual(new Set(archived.body.ids), new Set(['inbox-deck-old', 'inbox-deck-new']))
    assert.equal(archived.body.action, 'acknowledge')
    assert.ok(!calls.some((call) => call.path.includes('/api/tourism/decks/') && call.method === 'POST'))
    await inbox.getByRole('button', { name: 'Decisioni (2)', exact: true }).click()
    await inbox.getByRole('button', { name: 'Seleziona questa vista' }).click()
    partialInbox = true
    await inbox.getByRole('button', { name: 'Approva selezionate (2)' }).click()
    await inbox.getByRole('alert').filter({ hasText: 'Completa i dati del contatto' }).waitFor()
    // La coda si rilegge dopo la risposta: si aspetta che la riga approvata esca, non la si conta al volo.
    await inbox.getByRole('heading', { name: 'Primo contatto', exact: true }).waitFor({ state: 'detached' })
    await inbox.getByRole('heading', { name: 'Secondo contatto', exact: true }).waitFor()
    partialInbox = false
    await inbox.getByRole('button', { name: 'Approva selezionate (1)' }).click()
    await inbox.getByText('1 decisione approvata.', { exact: true }).waitFor()
    assert.deepEqual(calls.filter((call) => call.path === '/api/office/inbox' && call.method === 'POST').at(-1)?.body.ids, ['inbox-contact-2'])
    await inbox.getByRole('button', { name: 'Avvisi (1)', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await inbox.getByRole('checkbox', { name: 'Seleziona Rapporto informativo' }).check()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'coda e azioni multiple leggibili su telefono')
    await page.screenshot({ path: `${out}/10-coda-mobile.png`, fullPage: true })
    await inbox.getByRole('button', { name: 'Archivia avvisi selezionati (1)' }).click()
    await inbox.getByText('Nessuna uscita da valutare.', { exact: true }).waitFor()

    // Senza WebGL la scena lo dice e la gestione resta tutta nel pannello.
    const fallbackPage = await context.newPage()
    await fallbackPage.route('**/api/ufficio/scena', (route) => route.fulfill({ contentType: 'text/html',
      body: UFFICIO_SCENE_HTML.replace('<head>', '<head><script>HTMLCanvasElement.prototype.getContext = () => null;</script>') }))
    await fallbackPage.goto(`${base}/ufficio?vista=campus`)
    const fallbackOffice = fallbackPage.frameLocator('iframe')
    await fallbackOffice.locator('#fallback').waitFor({ state: 'visible' })
    await fallbackPage.getByRole('tab', { name: /Squadra/ }).click()
    await fallbackPage.getByRole('heading', { name: 'Arricchimento enti' }).waitFor()
    await fallbackPage.getByRole('link', { name: 'Budget e impostazioni →' }).first().click()
    await fallbackPage.waitForURL('**/ufficio/agenti#agente-*')
    await fallbackPage.close()

    assert.deepEqual(errors, [])
    console.log('Ufficio: gestione agenti, budget e decisioni; campus 3D, stati reali, reparti, luce, errore/recupero, link alle bozze, telefono e fallback senza WebGL verificati. Screenshot: ' + out)
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
