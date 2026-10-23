/**
 * Prova a video delle presentazioni per destinazione, contro API finte in memoria
 * (come tourism.browser.ts). Il database e l'agente si provano a parte nei test unit/db.
 * Uso: avvia `npm run dev` e lancia `node --import tsx tests/tourism-decks.browser.ts`.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import pilot from '../src/data/tourism-italy-pilot'
import { normalizeRecord, nameKey } from '../src/lib/tourism'
import { DEFAULT_DECK_TEMPLATE, DISTRIBUTION_DECK_TEMPLATE, applyVars, countTodo, normalizeTemplate, type DeckKind, type DeckSlide } from '../src/lib/tourism-deck'
import { normalizeQuoteTemplate, quoteDraftFromTemplate } from '../src/lib/commercial-proposal'

const baseUrl = process.env.TOURISM_TEST_URL || 'http://127.0.0.1:3000'
const output = process.env.TOURISM_TEST_OUTPUT || '/tmp/speaqi-tourism-decks'
const owner = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-19T10:00:00.000Z'
const entity = {
  ...normalizeRecord(pilot.records[0]),
  id: '33333333-3333-4333-8333-000000000001',
  name_key: nameKey(pilot.records[0].name),
  // Un ente del turismo: la base destinazioni è quella consigliata.
  type_code: 'dmo',
  status: 'VERIFIED',
  disabled: false,
  version: 1,
  created_at: now,
  updated_at: now,
  crm: [] as { contact_id: string }[]
}

// Un modello salvato per tipo, come nel database.
const templates: Record<DeckKind, { template: ReturnType<typeof normalizeTemplate>; version: number }> = {
  destination: { template: structuredClone(DEFAULT_DECK_TEMPLATE), version: 1 },
  distribution: { template: structuredClone(DISTRIBUTION_DECK_TEMPLATE), version: 1 }
}
const templateFor = (value: string | null | undefined) => templates[value === 'distribution' ? 'distribution' : 'destination']
let deck: Record<string, any> | null = null
const calls: { method: string; path: string; body?: any }[] = []
const errors: string[] = []

const view = (d: Record<string, any>) => ({ ...d, todo: countTodo(d.slides) })

/** Con TOURISM_TEST_SLIDES=1 si fotografa ogni slide dell'anteprima: serve a vedere se i testi di una base stanno nel palco. */
async function shootSlides(page: import('playwright').Page, name: string, count: number) {
  if (!process.env.TOURISM_TEST_SLIDES) return
  const player = page.locator('[class*="player"]').first()
  for (let i = 0; i < count; i++) {
    await page.waitForTimeout(450)
    await player.screenshot({ path: `${output}/slides-${name}-${String(i + 1).padStart(2, '0')}.png` })
    await page.getByRole('button', { name: 'Slide successiva' }).first().click()
  }
}

async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, deviceScaleFactor: 1 })
    await context.addInitScript(
      ({ owner }) => {
        const token = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.local-test'
        localStorage.setItem(
          'speaqi-crm-auth',
          JSON.stringify({
            access_token: token,
            refresh_token: 'local-test',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer',
            user: { id: owner, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
          })
        )
      },
      { owner }
    )
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (!url.href.startsWith(baseUrl)) return route.abort()
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const method = route.request().method()
      const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
      const isMultipart = (route.request().headers()['content-type'] || '').startsWith('multipart/')
      const body = method === 'GET' || isMultipart ? {} : route.request().postDataJSON() || {}
      calls.push({ method, path: url.pathname, body: isMultipart ? route.request().postData() : body })
      if (url.pathname === '/api/proposal-quote-context' && deck) return json({
        type: 'tourism', id: deck.id, title: deck.title, client_name: 'Capri Tourism', contact_id: null,
        draft: { ...quoteDraftFromTemplate(normalizeQuoteTemplate(templateFor(deck.template_kind).template.quote_template, 'tourism'), { ente: 'Capri Tourism' }), title: deck.title }
      })
      if (url.pathname === '/api/quotes') {
        if (method === 'POST') return json({ quote: { id: 'q1', ...body } }, 201)
        return json({ quotes: [] })
      }

      if (url.pathname === '/api/tourism/deck-template') {
        const kind: DeckKind = (method === 'PUT' ? body.kind : url.searchParams.get('kind')) === 'distribution' ? 'distribution' : 'destination'
        if (method === 'PUT') {
          templates[kind] = { template: normalizeTemplate(body.template, kind), version: templates[kind].version + 1 }
        }
        return json({ ...templates[kind], kind })
      }
      if (url.pathname === '/api/tourism/decks' && method === 'GET') {
        return json({ decks: deck ? [{ id: deck.id, title: deck.title, destination: deck.destination, template_kind: deck.template_kind, status: deck.status, todo: countTodo(deck.slides), updated_at: now, approved_at: deck.approved_at }] : [] })
      }
      if (url.pathname === '/api/tourism/decks' && method === 'POST') {
        const text = String(route.request().postData() || '')
        const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(text)?.[1] || ''
        const input = { destinazione: field('destinazione'), ente: field('ente'), paese: field('paese'), prezzo: field('prezzo'), contatto: field('contatto') }
        const kind: DeckKind = field('kind') === 'distribution' ? 'distribution' : 'destination'
        const slides = applyVars(templateFor(kind).template, input)
        deck = {
          id: '55555555-5555-4555-8555-555555555555',
          template_kind: kind,
          title: `${input.destinazione} · ${input.ente}`,
          destination: input.destinazione,
          entity_id: null,
          entity_name: null,
          status: 'ready',
          error: null,
          input,
          notes: field('notes'),
          assets: [],
          slides,
          warnings: [{ slide: '*', message: 'Manca: il referente' }],
          version: 2,
          public_token: 'a'.repeat(64),
          generated_at: now,
          approved_at: null,
          updated_at: now
        }
        return json(view(deck), 201)
      }
      const one = /^\/api\/tourism\/decks\/([^/]+)(\/approve)?$/.exec(url.pathname)
      if (one && deck) {
        if (one[2] && method === 'POST') {
          const todo = countTodo(deck.slides)
          if (body.approve && todo > 0) return json({ error: `Restano ${todo} [DA VERIFICARE]: completali prima di approvare` }, 400)
          deck = { ...deck, status: body.approve ? 'approved' : 'ready', approved_at: body.approve ? now : null }
          return json(view(deck))
        }
        if (method === 'PATCH') {
          deck = { ...deck, slides: body.slides as DeckSlide[], notes: body.notes ?? deck.notes, version: deck.version + 1, status: deck.status === 'approved' ? 'ready' : deck.status }
          return json(view(deck))
        }
        if (method === 'GET') return json(view(deck))
      }
      if (url.pathname === '/api/tourism' && method === 'GET') {
        const id = url.searchParams.get('id')
        if (url.searchParams.get('view') === 'coverage') return json({ reference_countries: 1, countries_with_organizations: 1, countries_without_organizations: 0, matched_organizations: 0, by_country: [], runs: [] })
        if (url.searchParams.get('view') === 'overview') return json({ organizations: 1, countries: 1, places: 0, verified: 1, review: 0, new_week: 0, contacts: 0, crm: 0, by_country: [] })
        if (id) return json({ entity, evidence: [], relations: [], neighbors: [], revisions: [], matches: [], contact: null })
        return json({ entities: [{ ...entity, matches: [], evidence: [] }], total: 1, page: 0, size: 50 })
      }
      if (url.pathname.startsWith('/api/tourism/')) return json({ rows: [], total: 0, jobs: [], sources: [] })
      if (url.pathname === '/api/team-members') return json({ members: [], is_admin: true })
      if (url.pathname === '/api/pipeline-stages') return json({ stages: [] })
      if (url.pathname === '/api/contacts/summary') return json({ counts: { total: 1 } })
      if (url.pathname.startsWith('/api/contacts')) return json({ contacts: [] })
      if (url.pathname.startsWith('/api/tasks')) return json({ tasks: [] })
      return json({})
    })

    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('dialog', (d) => d.accept())
    await page.goto(baseUrl + '/tourism')
    await page.getByRole('heading', { name: 'Global Tourism Intelligence.' }).waitFor({ timeout: 90000 })

    // 1. Tab Presentazioni, vuoto.
    await page.getByRole('button', { name: 'Presentazioni', exact: false }).first().click()
    await page.getByText('Nessuna presentazione ancora').waitFor()

    // 2. Il modello si modifica in modo generico.
    await page.getByRole('button', { name: 'Modifica il modello' }).click()
    const tpl = page.getByRole('dialog', { name: 'Modello della presentazione' })
    await tpl.getByText('Copertina').first().waitFor()
    assert.equal(await tpl.getByLabel('Tipo di slide').count(), DEFAULT_DECK_TEMPLATE.slides.length)
    // Due modelli, uno per tipo: si passa dall'uno all'altro e ognuno ha le sue slide.
    await tpl.getByTestId('template-kind-distribution').click()
    await tpl.getByText('Un servizio in più per i clienti di', { exact: false }).first().waitFor()
    assert.equal(await tpl.getByLabel('Tipo di slide').count(), DISTRIBUTION_DECK_TEMPLATE.slides.length)
    assert.ok(calls.some((c) => c.path === '/api/tourism/deck-template' && c.method === 'GET'))
    await page.screenshot({ path: output + '/template-distribution.png' })
    await tpl.getByTestId('template-kind-destination').click()
    await tpl.getByText('Costruita da Speaqi. Distribuita insieme a voi', { exact: false }).first().waitFor()
    assert.equal(await tpl.getByLabel('Tipo di slide').count(), DEFAULT_DECK_TEMPLATE.slides.length)
    await tpl.getByLabel('Titolo (il messaggio della slide)').first().fill('{{destinazione}}: la guida che parla ogni lingua')
    await tpl.getByText('Preventivo e contratto Tourism di base', { exact: true }).click()
    await tpl.getByLabel('Contratto di base').fill('Accordo Tourism approvato per {{ente}}')
    await tpl.getByRole('button', { name: '＋ Voce riutilizzabile' }).click()
    await tpl.getByLabel('Servizio 1', { exact: true }).fill('Progetto per {{ente}}')
    await tpl.getByLabel('Prezzo unitario, IVA esclusa').fill('990')
    await page.screenshot({ path: output + '/template.png' })
    await tpl.getByRole('button', { name: 'Salva il modello' }).click()
    await tpl.getByRole('status').filter({ hasText: 'Modello salvato' }).waitFor()
    assert.match(JSON.stringify(calls.filter((c) => c.method === 'PUT').at(-1)?.body), /la guida che parla ogni lingua/)
    assert.equal(calls.filter((c) => c.method === 'PUT').at(-1)?.body.kind, 'destination')
    await tpl.getByRole('button', { name: 'Chiudi finestra' }).click()

    // 3. Crea la presentazione con testo e un documento.
    await page.getByRole('button', { name: '＋ Crea la presentazione' }).click()
    const wizard = page.getByRole('dialog', { name: 'Crea la presentazione' })
    // Senza un ente collegato non si indovina: prima si sceglie il tipo.
    await wizard.getByLabel('Destinazione *').fill('Capri')
    await wizard.getByRole('button', { name: 'Crea la presentazione' }).click()
    await wizard.getByRole('alert').filter({ hasText: 'Scegli il tipo di presentazione' }).waitFor()
    assert.ok(!calls.some((c) => c.method === 'POST' && c.path === '/api/tourism/decks'), 'senza tipo non parte nessuna creazione')
    await wizard.getByTestId('deck-kind-destination').click()
    await wizard.getByLabel('Ente destinatario').fill('Capri Tourism')
    await wizard.getByLabel('Informazioni sulla destinazione').fill('Isola dei Faraglioni. Visitatori da Stati Uniti e Giappone.')
    await wizard.locator('input[type=file]').setInputFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('Visitatori dal Giappone') })
    await page.screenshot({ path: output + '/wizard.png' })
    await wizard.getByRole('button', { name: 'Crea la presentazione' }).click()
    await page.waitForURL('**/tourism/presentazioni/**')
    const posted = String(calls.find((c) => c.method === 'POST' && c.path === '/api/tourism/decks')?.body)
    assert.match(posted, /name="kind"\r\n\r\ndestination/)
    assert.match(posted, /brief\.txt/)
    assert.match(posted, /Visitatori dal Giappone/)

    // 4. L'editor: non si approva con [DA VERIFICARE] in pagina.
    await page.getByRole('heading', { name: 'Capri · Capri Tourism' }).waitFor({ timeout: 30000 })
    await page.getByText('da completare', { exact: false }).first().waitFor()
    assert.equal(await page.getByRole('button', { name: 'Approva', exact: true }).isDisabled(), true)
    await page.waitForTimeout(800)
    await page.screenshot({ path: output + '/editor-draft.png', fullPage: true })
    await shootSlides(page, 'destination', DEFAULT_DECK_TEMPLATE.slides.length)

    // 5. Completa i segnaposto, salva e approva: compare il link da condividere.
    for (const el of await page.locator('input:not([readonly]), textarea').all()) {
      const value = await el.inputValue().catch(() => '')
      if (/\[DA VERIFICARE/.test(value)) await el.fill(value.replace(/\[DA VERIFICARE[^\]]*\]/g, 'Massimo Morgante, info@speaqi.com'))
    }
    await page.getByRole('button', { name: 'Approva', exact: true }).click()
    await page.getByText('Link da condividere').waitFor()
    assert.match(await page.locator('input[readonly]').inputValue(), /\/presentazione\/a{64}$/)
    assert.ok(calls.some((c) => c.method === 'PATCH'), 'le modifiche si salvano prima di approvare')
    await page.screenshot({ path: output + '/editor-approved.png', fullPage: true })

    // 6. Un solo passaggio riprende cliente, prezzo e contratto Tourism.
    await page.getByRole('link', { name: '＋ Prepara preventivo e contratto' }).click()
    await page.getByLabel('Contratto abbinato al preventivo').waitFor()
    await page.waitForFunction(() => (document.querySelector('textarea[maxlength="30000"]') as HTMLTextAreaElement)?.value === 'Accordo Tourism approvato per Capri Tourism')
    assert.equal(await page.getByLabel('Contratto abbinato al preventivo').inputValue(), 'Accordo Tourism approvato per Capri Tourism')
    await page.screenshot({ path: output + '/tourism-quote-contract.png', fullPage: true })
    await page.getByRole('button', { name: 'Genera preventivo', exact: true }).click()
    await page.waitForURL('**/tourism/presentazioni/**')
    const quoteCall = calls.find(c => c.method === 'POST' && c.path === '/api/quotes')
    assert.equal(quoteCall?.body.tourism_deck_id, deck!.id)
    assert.equal(quoteCall?.body.status, 'draft')
    assert.equal(quoteCall?.body.items[0].unit_price, 990)
    assert.equal(quoteCall?.body.contract_terms, 'Accordo Tourism approvato per Capri Tourism')

    // 7. Dalla scheda di un ente il bottone parte con i dati dell'ente.
    await page.goto(baseUrl + '/tourism')
    await page.getByRole('button', { name: 'Directory', exact: false }).first().click()
    await page.locator('button[class*=entityName]').first().click()
    await page.getByRole('button', { name: 'Crea la presentazione' }).first().click()
    const fromEntity = page.getByRole('dialog', { name: 'Crea la presentazione' })
    assert.equal(await fromEntity.getByLabel('Destinazione *').inputValue(), entity.name)
    // L'ente è un ente del turismo: la base destinazioni è già scelta e consigliata, e si può cambiare.
    assert.equal(await fromEntity.getByTestId('deck-kind-destination').locator('input').isChecked(), true)
    await fromEntity.getByText('Consigliata').waitFor()
    assert.equal(await fromEntity.getByTestId('deck-kind-distribution').locator('input').isChecked(), false)
    await fromEntity.getByTestId('deck-kind-distribution').click()
    assert.equal(await fromEntity.getByLabel('Destinazione o mete dei clienti *').count(), 1, 'i testi del form seguono il tipo scelto')
    await page.screenshot({ path: output + '/wizard-entity.png' })

    // 8. Una presentazione di distribuzione: parte dalla sua base e l'editor dice di che tipo è.
    await fromEntity.getByLabel('Destinazione o mete dei clienti *').fill('Roma')
    await fromEntity.getByLabel('Partner destinatario').fill('Aeroporti di Roma')
    await fromEntity.getByLabel('Condizioni commerciali (revenue sharing)').fill('Commissione fissa del 15%')
    await fromEntity.getByRole('button', { name: 'Crea la presentazione' }).click()
    await page.waitForURL('**/tourism/presentazioni/**')
    await page.getByRole('heading', { name: 'Roma · Aeroporti di Roma' }).waitFor({ timeout: 30000 })
    await page.getByText('Partnership distribuzione', { exact: true }).first().waitFor()
    assert.equal(deck!.template_kind, 'distribution')
    assert.equal(deck!.slides[0].title, 'Roma, nella lingua di ogni viaggiatore.')
    assert.equal(deck!.slides.find((s: DeckSlide) => s.id === 'modello')!.body, 'Commissione fissa del 15%')
    await page.waitForTimeout(800)
    await page.screenshot({ path: output + '/editor-distribution.png', fullPage: true })
    await shootSlides(page, 'distribution', DISTRIBUTION_DECK_TEMPLATE.slides.length)

    assert.deepEqual(errors, [])
    console.log('OK: presentazioni per destinazione, schermate in ' + output)
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
