/**
 * Prova end-to-end di Speaqi Agency nel browser, sull'app vera (next build + start) e
 * sullo stack locale (tests/agency-stack): login, nuova proposta con brief e documenti,
 * generazione con l'AI vera (OPENAI_API_KEY), revisione in linguaggio naturale,
 * preventivo dal costruttore esistente, approvazione, link pubblico e PDF.
 *
 *   tests/agency-stack/stack.sh up && source <(tests/agency-stack/stack.sh env)
 *   npm run build && PORT=3100 node start.cjs &
 *   AGENCY_TEST_URL=http://127.0.0.1:3100 node --import tsx tests/agency.browser.ts
 *
 * Costo: due chiamate al modello (una generazione, una revisione), pochi centesimi.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import sharp from 'sharp'

const base = process.env.AGENCY_TEST_URL || 'http://127.0.0.1:3100'
const out = process.env.AGENCY_TEST_OUTPUT || '/tmp/agency-e2e'
const email = 'owner@example.com'
const password = 'password-di-prova'
const errors: string[] = []

function zip(files: Record<string, string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content))
    const nb = Buffer.from(name)
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt16LE(nb.length, 26)
    locals.push(l, nb, data)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(offset, 42)
    centrals.push(c, nb)
    offset += 30 + nb.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, e])
}
const docx = (paragraphs: string[]) =>
  zip({ 'word/document.xml': `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` })

async function materials() {
  await mkdir(out, { recursive: true })
  const brief = path.join(out, 'brief-consorzio.docx')
  await writeFile(brief, docx([
    'Consorzio Centro Storico Napoli — appunti della riunione del 14 ottobre 2026',
    'Il consorzio riunisce 120 attività del centro storico: botteghe artigiane, ristoranti, librerie.',
    'Il sito attuale è del 2016, non è responsive e non ha versioni in lingua.',
    'Obiettivo principale: farsi trovare dai turisti stranieri prima che arrivino in città, anche nelle risposte di ChatGPT e Google AI.',
    'Vogliono un marchio riconoscibile da mettere sulle vetrine degli associati.',
    'Interessa un assistente che risponda ai turisti su orari e indirizzi delle botteghe.',
    'Referente: Anna Esposito, presidente.',
    'Vincoli: lancio entro aprile 2027, in vista della stagione. Budget massimo 25.000 euro.'
  ]))
  const photo = path.join(out, 'galleria.jpg')
  const shot = path.resolve('../speaqidesign/company/assets/screenshots/napoli-audio-galleria-umberto.jpg')
  try {
    await writeFile(photo, await readFile(shot))
  } catch {
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#9b6b43' } }).jpeg().toFile(photo)
  }
  const logo = path.join(out, 'logo-consorzio.png')
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" rx="24" fill="#ffffff"/><circle cx="100" cy="100" r="62" fill="#0e6e5c"/><text x="100" y="118" font-family="Arial" font-size="54" font-weight="700" fill="#fff" text-anchor="middle">CS</text><text x="190" y="92" font-family="Arial" font-size="40" font-weight="700" fill="#0e6e5c">Centro Storico</text><text x="190" y="140" font-family="Arial" font-size="32" fill="#333">Napoli · Consorzio</text></svg>')).png().toFile(logo)
  return { brief, photo, logo }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false })
}

async function waitStatus(page: Page, id: string, token: string, until: (s: string) => boolean, ms = 300_000) {
  const end = Date.now() + ms
  for (;;) {
    const r = await page.request.get(`${base}/api/agency/presentations/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    const v = await r.json()
    if (until(v.status)) return v
    if (Date.now() > end) throw new Error(`stato fermo su ${v.status}`)
    await page.waitForTimeout(3000)
  }
}

async function main() {
  const files = await materials()
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`) })
  try {
    // Login
    await page.goto(`${base}/login`)
    await page.fill('input[type=email]', email)
    await page.fill('input[type=password]', password)
    await page.click('button[type=submit]')
    await page.waitForURL(/dashboard|agency|contacts|kanban/, { timeout: 30_000 })
    const token = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i) || '') || ''
        if (v.includes('access_token')) return JSON.parse(v).access_token as string
      }
      return ''
    })
    assert.ok(token, 'sessione dopo il login')
    const api = (p: string, init?: { method?: string; data?: unknown }) => page.request.fetch(`${base}${p}`, { method: init?.method || 'GET', data: init?.data, headers: { Authorization: `Bearer ${token}` } })

    // La voce è nel menu
    await page.goto(`${base}/agency`)
    await page.getByRole('heading', { name: /Speaqi Agency/ }).waitFor()
    assert.ok(await page.locator('aside a[href="/agency"]').count(), 'voce Speaqi Agency nella sidebar')
    await shot(page, '01-dashboard-vuota')

    // Nuova proposta: cliente nuovo, servizi, brief, documenti, foto e logo
    await page.getByRole('button', { name: /Nuova proposta/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuova proposta' })
    await dialog.getByRole('button', { name: 'Nuovo cliente' }).click()
    await dialog.getByLabel('Azienda o ente').fill('Consorzio Centro Storico Napoli')
    await dialog.getByLabel('Referente').fill('Anna Esposito')
    await dialog.getByLabel('Email').fill('presidenza@centrostorico-esempio.it')
    for (const s of ['Siti web premium', 'Branding e identità visiva', 'SEO, GEO e motori AI', 'Automazioni e AI']) await dialog.getByRole('button', { name: s, exact: true }).click()
    await dialog.getByLabel('Brief').fill('Il consorzio vuole un nuovo portale che presenti le botteghe associate ai turisti stranieri, un marchio da vetrina e un assistente AI. Allego gli appunti della riunione. Proponiamo strategia, sito, brand, SEO/GEO e assistente.')
    await dialog.getByLabel('Titolo della proposta (facoltativo)').fill('Il centro storico, scelto prima di arrivare')
    await dialog.locator('input[type=file][multiple]').setInputFiles([files.brief, files.photo])
    await dialog.locator('input[type=file]:not([multiple])').setInputFiles(files.logo)
    await shot(page, '02-nuova-proposta')
    await dialog.getByRole('button', { name: /Crea e genera la presentazione/ }).click()
    await page.waitForURL(/\/agency\/presentazioni\//, { timeout: 60_000 })
    const presentationId = page.url().split('/').pop() as string
    await page.getByText('L’agente sta lavorando').waitFor({ timeout: 15_000 })
    await shot(page, '03-studio-in-generazione')

    // Generazione vera
    const t0 = Date.now()
    const generated = await waitStatus(page, presentationId, token, (s) => s !== 'generating')
    console.log(`generazione: ${generated.status} in ${Math.round((Date.now() - t0) / 1000)} s, ${generated.slides.length} slide, ${generated.todo} da verificare`)
    assert.equal(generated.status, 'ready', generated.error || '')
    assert.ok(generated.slides.length >= 6, 'una presentazione vera, non lo scheletro')
    assert.equal(generated.slides[0].kind, 'cover')
    assert.equal(generated.slides.at(-1).kind, 'closing')
    const analysis = generated.project.analysis
    assert.ok(analysis.verified_facts.length > 0, 'fatti verificati')
    assert.ok(analysis.verified_facts.some((f: { fact: string }) => /120|2016|aprile/i.test(f.fact)), 'i fatti vengono dal documento Word')
    await page.reload()
    await page.getByText(/Slide 1 ·/).waitFor()
    await page.waitForTimeout(1500)
    await shot(page, '04-studio-generata')
    console.log('slide:', generated.slides.map((s: { kind: string; title: string }) => `${s.kind}: ${s.title}`).join('\n  '))

    // Anteprima: un giro su tutte le slide
    for (let i = 0; i < generated.slides.length; i++) {
      await page.locator('[aria-label="Slide"] button').nth(i).click()
      await page.waitForTimeout(350)
      await page.locator('main, body').first().evaluate(() => undefined)
      const preview = page.locator('[class*="preview"] [class*="player"]').first()
      await preview.screenshot({ path: path.join(out, `slide-${String(i + 1).padStart(2, '0')}-${generated.slides[i].kind}.png`) })
    }

    // Revisione in linguaggio naturale
    await page.getByLabel("Istruzione per l'AI").fill('Rendi questa presentazione più istituzionale, aggiungi una roadmap di sei mesi, elimina la parte economica e migliora la sezione dedicata ai risultati.')
    const t1 = Date.now()
    const [reviseRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/api/agency/presentations/${presentationId}/revise`)),
      page.getByRole('button', { name: 'Applica la revisione' }).click()
    ])
    assert.equal(reviseRes.status(), 200, await reviseRes.text())
    const revised = await waitStatus(page, presentationId, token, (s) => s !== 'generating')
    console.log(`revisione: ${revised.status} in ${Math.round((Date.now() - t1) / 1000)} s — ${revised.last_change}`)
    assert.equal(revised.status, 'ready', revised.error || '')
    assert.equal(revised.theme.style, 'institutional')
    assert.ok(revised.slides.some((s: { kind: string }) => s.kind === 'roadmap'), 'roadmap aggiunta')
    assert.ok(!revised.slides.some((s: { kind: string }) => s.kind === 'investment'), 'parte economica tolta')
    const kept = generated.slides.filter((g: any) => revised.slides.some((r: any) => r.id === g.id && JSON.stringify(r) === JSON.stringify(g)))
    console.log(`slide rimaste identiche: ${kept.length} su ${generated.slides.length}`)
    await page.reload()
    await page.getByText(/Slide 1 ·/).waitFor()
    await page.waitForTimeout(1200)
    await shot(page, '05-studio-revisionata')

    // Preventivo dal costruttore esistente, nato collegato all'opportunità
    const projectId = revised.project.id as string
    await page.goto(`${base}/agency/${projectId}`)
    await page.getByRole('heading', { name: /Consorzio Centro Storico Napoli/ }).waitFor()
    await shot(page, '06-opportunita')
    await page.getByRole('link', { name: /Nuovo preventivo/ }).first().click()
    await page.waitForURL(/\/preventivi\?agency_project=/)
    await page.locator('.quotes-agency-banner').waitFor()
    await shot(page, '07-preventivi-collegato')
    // Il costruttore dei preventivi di sempre: due righe e "Genera preventivo".
    const lines: [string, string][] = [['Strategia, brand e portale multilingua', '18000'], ['SEO, GEO e assistente AI', '6000']]
    for (const [description, price] of lines) {
      await page.getByRole('button', { name: '+ Riga' }).click()
      await page.getByPlaceholder('Descrizione').last().fill(description)
      await page.getByLabel('Prezzo unitario in offerta').last().fill(price)
    }
    await Promise.all([page.waitForURL(new RegExp(`/agency/${projectId}`), { timeout: 30_000 }), page.getByRole('button', { name: 'Genera preventivo' }).click()])
    const projectAfter = (await (await api(`/api/agency/projects/${projectId}`)).json()) as any
    const quote = projectAfter.quotes[0]
    assert.ok(quote, 'il preventivo nasce collegato all’opportunità')
    assert.equal(quote.lines.length, lines.length)
    quote.total_amount = quote.total
    await page.getByText(quote.number).first().waitFor()
    await shot(page, '07b-opportunita-con-preventivo')
    await page.goto(`${base}/preventivi?edit=${quote.id}`)
    await page.waitForTimeout(1500)
    assert.ok((await page.locator('input[value="Strategia e brand"], textarea').count()) > 0)
    await shot(page, '08-preventivo-aperto')

    // Studio: si riaggiunge l'investimento (legge il preventivo) e si completano i [DA VERIFICARE]
    const view = (await (await api(`/api/agency/presentations/${presentationId}`)).json()) as any
    const slides = view.slides.map((s: any) => JSON.parse(JSON.stringify(s).replace(/\[DA VERIFICARE[^\]]*\]/g, 'da definire insieme')))
    slides.splice(slides.length - 1, 0, { id: 'investment', kind: 'investment', kicker: 'Investimento', title: 'L’investimento, voce per voce', body: '', items: [], note: '', image_asset_id: null, layout: 'auto' })
    const patched = await api(`/api/agency/presentations/${presentationId}`, { method: 'PATCH', data: { version: view.version, slides, quote_id: quote.id, reason: 'Completata a mano' } })
    assert.equal(patched.status(), 200, await patched.text())
    const ready = await patched.json()
    assert.equal(ready.todo, 0)
    assert.equal(ready.quote.total, quote.total_amount)
    await page.goto(`${base}/agency/presentazioni/${presentationId}`)
    await page.getByText(/Slide 1 ·/).waitFor()
    await page.locator('[aria-label="Slide"] button').nth(slides.length - 2).click()
    await page.waitForTimeout(600)
    await shot(page, '09-studio-investimento')

    // Approvazione, link pubblico
    await page.getByRole('button', { name: 'Approva' }).click()
    await page.getByText('Link per il cliente').waitFor()
    const link = await page.getByLabel('Link pubblico').inputValue()
    const pub = await context.newPage()
    await pub.goto(link)
    await pub.waitForTimeout(1500)
    await pub.screenshot({ path: path.join(out, '10-proposta-pubblica.png') })
    await pub.keyboard.press('End')
    await pub.waitForTimeout(400)
    await pub.keyboard.press('ArrowLeft')
    await pub.waitForTimeout(500)
    await pub.screenshot({ path: path.join(out, '11-proposta-pubblica-investimento.png') })
    await pub.close()

    // PDF (Chromium sul server)
    const t2 = Date.now()
    const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 150_000 }), page.getByRole('button', { name: 'PDF' }).click()])
    const pdfPath = path.join(out, 'proposta.pdf')
    await pdfDl.saveAs(pdfPath)
    const pdf = await readFile(pdfPath)
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
    console.log(`PDF: ${pages} pagine, ${Math.round(pdf.length / 1024)} KB in ${Math.round((Date.now() - t2) / 1000)} s`)
    assert.equal(pages, slides.length, 'una pagina per slide')

    // Versioni e cruscotto
    await page.getByRole('button', { name: 'Mostra lo storico' }).click()
    await page.getByText('Revisione:').first().waitFor()
    await shot(page, '12-versioni')
    await page.goto(`${base}/agency`)
    await page.getByText('Opportunità aperte').waitFor()
    await page.waitForTimeout(800)
    await shot(page, '13-dashboard')
    await page.goto(`${base}/agency?tab=template`)
    await page.getByText(/Layout disponibili/).waitFor()
    await page.waitForTimeout(1200)
    await shot(page, '14-template')

    // Accesso: senza login nessuna API, e un link inventato è un 404
    const anon = await page.request.get(`${base}/api/agency/overview`)
    assert.equal(anon.status(), 401)
    const fake = await page.request.get(`${base}/proposta/${'a'.repeat(64)}`)
    assert.equal(fake.status(), 404)

    assert.deepEqual(errors, [], `errori nel browser:\n${errors.join('\n')}`)
    console.log(`OK — screenshot e file in ${out}`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  if (errors.length) console.error(errors.join('\n'))
  process.exit(1)
})
