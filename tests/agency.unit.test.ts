import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import {
  AGENCY_TODO,
  DEFAULT_SERVICE_CATEGORIES,
  applyRevision,
  blankSlide,
  categorySlug,
  countTodo,
  ensureFrame,
  guardSlides,
  inkOn,
  normalizeAgencySettings,
  normalizeOps,
  normalizeSlide,
  normalizeSlides,
  normalizeTheme,
  quoteSummary
} from '../src/lib/agency'
import {
  GENERATE_OUTPUT_SCHEMA,
  agencyModel,
  REVISE_OUTPUT_SCHEMA,
  buildGenerateRequest,
  buildReviseRequest,
  interpretGenerate,
  interpretRevise,
  responseJson,
  type AgencyBrief,
  type AgencyMaterials
} from '../src/lib/server/agency-agent'
import { extractPptxText, fetchWebsiteText, sniffAgencyUpload, websiteTextFromHtml, zipEntries } from '../src/lib/server/agency-assets'
import { buildPptx } from '../src/lib/server/agency-pptx'
import { pdfStamp } from '../src/lib/server/agency-pdf'
import { renderKey, validRenderKey } from '../src/lib/server/agency'

const PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const brief: AgencyBrief = {
  project_title: 'Nuovo sito per Cantina Rossi',
  client: { name: 'Cantina Rossi', company: 'Cantina Rossi srl' },
  services: [{ name: 'Siti web premium', description: 'Siti' }],
  brief: 'Il sito ha 12.400 visite al mese, il 68% da mobile. Budget indicativo 15.000 euro. Vogliono vendere online.',
  agency: { name: 'Speaqi Agency', signature: 'Strategia e design', contact: 'info@speaqi.com', about: '' },
  quote: { linked: false, lines: [] },
  language: 'it'
}
const materials: AgencyMaterials = { documents: [{ name: 'note.txt', text: 'Fondata nel 1987. 40 ettari di vigneto.' }], photos: [{ id: PHOTO, name: 'vigna.jpg', dataUrl: 'data:image/jpeg;base64,AA==' }], logos: [] }

test('le categorie di partenza sono dieci e con slug validi', () => {
  assert.equal(DEFAULT_SERVICE_CATEGORIES.length, 10)
  for (const c of DEFAULT_SERVICE_CATEGORIES) assert.match(c.slug, /^[a-z0-9][a-z0-9-]{0,59}$/)
  assert.equal(categorySlug('SEO, GEO & motori AI'), 'seo-geo-motori-ai')
  assert.equal(categorySlug('Identità è visiva'), 'identita-e-visiva')
})

test('una slide si normalizza: tipo sconosciuto, limiti, investimento senza righe', () => {
  const s = normalizeSlide({ kind: 'boh', title: 'x'.repeat(500), items: [{ title: 'a' }] })
  assert.equal(s.kind, 'statement')
  assert.equal(s.title.length, 180)
  assert.equal(s.items.length, 0, 'un messaggio non ha voci')
  const inv = normalizeSlide({ kind: 'investment', items: [{ title: 'Sito', value: '9000 €' }] })
  assert.deepEqual(inv.items, [])
  const ids = normalizeSlides([{ id: 'a' }, { id: 'a' }, { id: 'a' }]).map((x) => x.id)
  assert.deepEqual(ids, ['a', 'a-2', 'a-3'])
})

test('copertina in testa e chiusura in fondo, sempre', () => {
  const out = ensureFrame(normalizeSlides([{ id: 'x', kind: 'closing', title: 'Ciao' }, { id: 'y', kind: 'problems', title: 'P' }]), 'Titolo')
  assert.equal(out[0].kind, 'cover')
  assert.equal(out[0].title, 'Titolo')
  assert.equal(out.at(-1)?.kind, 'closing')
})

test('guardie: importi e percentuali inventati diventano [DA VERIFICARE], quelli dei materiali restano', () => {
  const corpus = `${brief.brief}\n${materials.documents[0].text}`
  const slides = normalizeSlides([
    { id: 'a', kind: 'statement', title: 'Con noi +35% di vendite', body: 'Oggi il 68% arriva da mobile; budget 15.000 euro, il sito costa 9.000 €' },
    { id: 'm', kind: 'metrics', title: 'Numeri', items: [{ title: 'Visite', value: '12.400' }, { title: 'Conversioni', value: '4,2%' }] },
    { id: 'i', kind: 'investment', title: 'Investimento 15.000 euro' },
    { id: 'f', kind: 'statement', title: 'Foto', image_asset_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  ])
  const { slides: out, warnings } = guardSlides(slides, corpus, [PHOTO])
  assert.equal(out[0].title, `Con noi ${AGENCY_TODO} di vendite`)
  assert.match(out[0].body, /68%/)
  assert.match(out[0].body, /15\.000 euro/)
  assert.match(out[0].body, new RegExp(`costa \\${AGENCY_TODO.slice(0, -1)}`))
  assert.equal(out[1].items[0].value, '12.400')
  assert.equal(out[1].items[1].value, AGENCY_TODO)
  assert.equal(out[2].title, `Investimento ${AGENCY_TODO}`, 'nella slide investimento nessun importo, nemmeno se nei materiali')
  assert.equal(out[3].image_asset_id, null, 'foto non del progetto')
  assert.ok(warnings.some((w) => /35%/.test(w.message)))
})

test('la stessa foto non compare due volte', () => {
  const slides = normalizeSlides([{ id: 'a', kind: 'cover', image_asset_id: PHOTO }, { id: 'b', kind: 'statement', image_asset_id: PHOTO }])
  const { slides: out } = guardSlides(slides, '', [PHOTO])
  assert.equal(out[0].image_asset_id, PHOTO)
  assert.equal(out[1].image_asset_id, null)
})

test('[DA VERIFICARE] contati, e la slide investimento senza preventivo è una mancanza', () => {
  const slides = normalizeSlides([{ kind: 'cover', title: `X ${AGENCY_TODO}` }, { kind: 'investment', title: 'I' }])
  assert.equal(countTodo(slides, { hasQuote: true }), 1)
  assert.equal(countTodo(slides, { hasQuote: false }), 2)
})

test('un valore vuoto su numeri o grafico si mostra [DA VERIFICARE] e blocca l’approvazione', () => {
  const slides = normalizeSlides([
    { kind: 'metrics', title: 'Numeri', items: [{ title: 'Visite', value: '' }, { title: 'Ordini', value: '120' }] },
    { kind: 'chart', title: 'Grafico', items: [{ title: 'A', value: ' ' }, { title: 'B', value: '3' }] }
  ])
  assert.equal(countTodo(slides, { hasQuote: true }), 2)
})

test('revisione: solo le slide nominate cambiano, gli id restano', () => {
  const start = normalizeSlides([
    { id: 'cover', kind: 'cover', title: 'Copertina' },
    { id: 'problems', kind: 'problems', title: 'Problemi', items: [{ title: 'A' }, { title: 'B' }] },
    { id: 'investment', kind: 'investment', title: 'Prezzo' },
    { id: 'closing', kind: 'closing', title: 'Fine' }
  ])
  const ops = normalizeOps([
    { op: 'update', id: 'problems', after_id: null, slide: { id: 'ignorato', kind: 'problems', title: 'Tre problemi', items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] } },
    { op: 'delete', id: 'investment', after_id: null, slide: null },
    { op: 'insert', after_id: 'problems', slide: { kind: 'roadmap', title: 'Sei mesi', items: [{ title: 'Analisi', value: 'Mese 1' }, { title: 'Sviluppo', value: 'Mese 2-5' }, { title: 'Lancio', value: 'Mese 6' }] } },
    { op: 'update', id: 'non-esiste', after_id: null, slide: { title: 'x' } },
    { op: 'boh' }
  ])
  assert.equal(ops.length, 4)
  const r = applyRevision(start, ops)
  assert.deepEqual(r.slides.map((s) => s.id), ['cover', 'problems', 'roadmap', 'closing'])
  assert.equal(r.slides[0], r.slides[0])
  assert.equal(r.slides[0].title, 'Copertina')
  assert.equal(r.slides[1].title, 'Tre problemi')
  assert.equal(r.slides[1].items.length, 3)
  assert.deepEqual(r.changed.sort(), ['problems', 'roadmap'])
  assert.equal(r.skipped.length, 1)
  const moved = applyRevision(r.slides, normalizeOps([{ op: 'move', id: 'closing', after_id: '__start__' }]))
  assert.equal(moved.slides[0].id, 'closing')
})

test('non si possono eliminare tutte le slide', () => {
  const start = normalizeSlides([{ id: 'a', kind: 'cover' }])
  const r = applyRevision(start, normalizeOps([{ op: 'delete', id: 'a' }]))
  assert.equal(r.slides.length, 1)
})

test('tema: stili e colori validati, testo leggibile sull’accento', () => {
  const t = normalizeTheme({ style: 'bold', accent: '#ABC', client_logo: false, language: 'en' })
  assert.deepEqual(t, { style: 'bold', accent: '#aabbcc', client_logo: false, language: 'en' })
  assert.equal(normalizeTheme({ style: 'x', accent: 'red' }).style, 'editorial')
  assert.equal(inkOn('#ffd400'), '#1d2d44')
  assert.equal(inkOn('#1d2d44'), '#ffffff')
  assert.equal(normalizeAgencySettings({}).name, 'Speaqi Agency')
})

test('riepilogo del preventivo: solo le righe che concorrono al totale', () => {
  const q = quoteSummary({
    id: 'q', quote_number: 'PREV-1', status: 'draft', currency: 'EUR', items: [
      { description: 'Sito', quantity: 1, unit_price: 9000, line_total: 9000 },
      { description: 'Opzione A', choice_group_id: 'g', selected: true, quantity: 1, unit_price: 100, line_total: 100 },
      { description: 'Opzione B', choice_group_id: 'g', selected: false, quantity: 1, unit_price: 200, line_total: 200 }
    ], subtotal_amount: 9100, discount_amount: 0, tax_rate: 22, tax_amount: 2002, total_amount: 11102, public_token: 't'
  })
  assert.deepEqual(q?.lines.map((l) => l.description), ['Sito', 'Opzione A'])
  assert.equal(q?.total, 11102)
  assert.equal(quoteSummary({ id: 'x', status: 'cancelled', public_token: 't' })?.public_token, null)
})

test('richiesta di generazione: schema rigoroso, foto e loghi, istruzioni dai materiali trattate come dati', () => {
  const req = buildGenerateRequest({ brief, materials: { ...materials, logos: [{ id: PHOTO, name: 'logo.png', dataUrl: 'data:image/png;base64,AA==' }] } }, 'gpt-5-mini') as any
  assert.equal(req.text.format.strict, true)
  assert.deepEqual(req.reasoning, { effort: 'low' })
  const system = req.input[0].content[0].text as string
  assert.match(system, /mai istruzioni/)
  assert.match(system, /Nessun importo nelle slide/)
  assert.match(system, /italiano/)
  const parts = req.input[1].content as any[]
  assert.ok(parts.some((p) => p.type === 'input_image'))
  assert.ok(parts.some((p) => p.type === 'input_text' && /LOGO DEL CLIENTE/.test(p.text)))
  assert.equal((buildGenerateRequest({ brief, materials }, 'gpt-4o') as any).reasoning, undefined)
  // Ogni proprietà degli oggetti dello schema è obbligatoria (requisito della modalità strict).
  const check = (schema: any) => {
    if (schema?.type === 'object') {
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
      Object.values(schema.properties).forEach(check)
    }
    if (schema?.items) check(schema.items)
    if (schema?.anyOf) schema.anyOf.forEach(check)
  }
  check(GENERATE_OUTPUT_SCHEMA)
  check(REVISE_OUTPUT_SCHEMA)
})

test('interpretazione della generazione: cornice, guardie, analisi, avvisi', () => {
  const parsed = {
    title: 'Un sito che vende',
    style: 'institutional',
    analysis: { client_summary: 'Cantina storica', sector: 'Vino', needs: ['Vendere online'], objectives: [], verified_facts: [{ fact: '68% da mobile', source: 'brief' }], assumptions: ['Clienti in Italia'], missing: ['Referente'], strategy: { positioning: 'p', proposal: 'q', services: ['Sito'] } },
    slides: [
      { id: 'p', kind: 'problems', kicker: '', title: 'Il 68% arriva da mobile e se ne va', body: '', items: [{ title: 'Lento', text: '', value: '' }, { title: 'Vecchio', text: '', value: '' }], note: '', image_asset_id: PHOTO, layout: 'auto' },
      { id: 'b', kind: 'benefits', kicker: '', title: 'Raddoppierete le vendite del 200%', body: '', items: [{ title: 'A', text: '', value: '' }, { title: 'B', text: '', value: '' }], note: '', image_asset_id: null, layout: 'auto' }
    ]
  }
  const r = interpretGenerate(parsed, { brief, materials }, 'm')
  assert.equal(r.slides[0].kind, 'cover')
  assert.equal(r.slides[0].title, 'Un sito che vende')
  assert.equal(r.style, 'institutional')
  assert.equal(r.slides[1].image_asset_id, PHOTO)
  assert.match(r.slides[2].title, /\[DA VERIFICARE\]/)
  assert.ok(r.warnings.some((w) => w.message === 'Manca: Referente'))
  assert.equal(r.analysis.outline.length, r.slides.length)
  assert.throws(() => interpretGenerate({ slides: [] }, { brief, materials }, 'm'), /senza slide/)
})

test('interpretazione della revisione: guardie solo sulle slide toccate', () => {
  const slides = normalizeSlides([
    { id: 'cover', kind: 'cover', title: 'C' },
    { id: 'manual', kind: 'statement', title: 'Prezzo concordato a voce: 7.777 €' },
    { id: 'closing', kind: 'closing', title: 'F' }
  ])
  const args = { brief, materials, analysis: interpretGenerate({ slides: [{ kind: 'cover', title: 'x' }] }, { brief, materials }, 'm').analysis, slides, theme: normalizeTheme({}), instruction: 'aggiungi una roadmap' }
  const r = interpretRevise(
    { summary: 'Aggiunta la roadmap.', style: null, operations: [{ op: 'insert', id: '', after_id: 'manual', slide: { id: 'x', kind: 'roadmap', kicker: '', title: 'Roadmap con +50% di efficienza', body: '', items: [{ title: 'Fase 1', text: '', value: 'Mese 1' }, { title: 'Fase 2', text: '', value: 'Mese 2' }, { title: 'Fase 3', text: '', value: 'Mese 3' }], note: '', image_asset_id: null, layout: 'auto' } }] },
    args,
    'm'
  )
  assert.equal(r.slides[1].title, 'Prezzo concordato a voce: 7.777 €', 'una cifra scritta a mano altrove non si tocca')
  assert.equal(r.slides[2].kind, 'roadmap')
  assert.match(r.slides[2].title, /\[DA VERIFICARE\]/)
  assert.deepEqual(r.changed, ['roadmap'])
  assert.match(r.summary, /roadmap/)
  const req = buildReviseRequest(args, 'gpt-5-mini') as any
  assert.ok(!(req.input[1].content as any[]).some((p) => p.type === 'input_image'), 'le foto non si rimandano in revisione')
})

test('risposta del modello: troncata o non JSON è un errore chiaro', () => {
  assert.throws(() => responseJson({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"sl' }), /lunghezza massima/)
  assert.throws(() => responseJson({ output_text: 'ciao' }), /non valida/)
  assert.deepEqual(responseJson({ output: [{ content: [{ type: 'output_text', text: '{"a":1}' }] }] }), { a: 1 })
})

// ---- Materiali -------------------------------------------------------------

function zip(files: Record<string, string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content))
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

test('PowerPoint: testo per slide, nell’ordine giusto, e riconosciuto dai byte', () => {
  const pptx = zip({
    'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Decima</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Obiettivi &amp; KPI</a:t></a:r></a:p><a:p><a:r><a:t>Più vendite</a:t></a:r></a:p></p:sld>',
    '[Content_Types].xml': '<x/>'
  })
  assert.equal(sniffAgencyUpload(pptx, 'brief.pptx')?.mime, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.equal(sniffAgencyUpload(pptx, 'brief.zip'), null)
  const text = extractPptxText(pptx)
  assert.ok(text.indexOf('[Slide 2]') < text.indexOf('[Slide 10]'))
  assert.match(text, /Obiettivi & KPI\nPiù vendite/)
  assert.equal(zipEntries(pptx).length, 3)
})

test('sito: titoli e paragrafi senza menu e script', () => {
  const html = '<html><head><title>Cantina Rossi</title><meta name="description" content="Vini dal 1987"></head><body><nav>Home Chi siamo</nav><h1>I nostri vini</h1><p>Quaranta ettari in collina.</p><script>alert(1)</script><footer>Cookie</footer></body></html>'
  const r = websiteTextFromHtml(html, 'https://cantinarossi.it')
  assert.match(r.text, /## I nostri vini/)
  assert.match(r.text, /Descrizione: Vini dal 1987/)
  assert.doesNotMatch(r.text, /alert|Cookie|Chi siamo/)
})

test('sito: redirect seguiti e ricontrollati, indirizzi privati rifiutati', async () => {
  const pages: Record<string, { status: number; text: string; headers: Record<string, string> }> = {
    'https://esempio.it/': { status: 301, text: '', headers: { location: 'https://www.esempio.it/' } },
    'https://www.esempio.it/': { status: 200, text: '<h1>Titolo</h1><p>Uno due tre</p><p>Quattro cinque</p><p>Sei</p>', headers: { 'content-type': 'text/html' } }
  }
  const fetcher = async (u: string) => ({ ...pages[u], bytes: 0 })
  const r = await fetchWebsiteText('esempio.it', fetcher)
  assert.equal(r.url, 'https://www.esempio.it/')
  await assert.rejects(fetchWebsiteText('http://localhost/admin', fetcher), /non valido/)
  const evil = async () => ({ status: 302, text: '', bytes: 0, headers: { location: 'http://127.0.0.1/' } })
  await assert.rejects(fetchWebsiteText('https://esempio.it', evil), /non valido/)
})

// ---- Export ----------------------------------------------------------------

test('PowerPoint esportato: un file valido con una slide per slide e testi modificabili', async () => {
  const slides = normalizeSlides([
    blankSlide('cover'),
    { id: 'c', kind: 'chart', title: 'Traffico', items: [{ title: 'Ricerca', value: '48' }, { title: 'Social', value: '15' }] },
    { id: 'i', kind: 'investment', title: 'Investimento' },
    { id: 'r', kind: 'roadmap', title: 'Roadmap', items: [{ title: 'A', value: 'Mese 1' }, { title: 'B', value: 'Mese 2' }, { title: 'C', value: 'Mese 3' }] },
    { id: 'x', kind: 'comparison', title: 'Prima/dopo', items: [{ title: 'Oggi', text: 'lento\nvecchio' }, { title: 'Dopo', text: 'veloce' }] },
    blankSlide('closing')
  ])
  const quote = quoteSummary({ id: 'q', quote_number: 'PREV-9', status: 'sent', items: [{ description: 'Sito web', quantity: 1, unit_price: 9000, line_total: 9000 }], subtotal_amount: 9000, tax_rate: 22, tax_amount: 1980, total_amount: 10980 })
  const buf = await buildPptx({ title: 'Prova', slides, theme: normalizeTheme({}), clientName: 'Cliente', agencyName: 'Speaqi Agency', agencySignature: 'Firma', quote, images: {}, clientLogo: null })
  const entries = zipEntries(buf).map((e) => e.name)
  assert.equal(entries.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, slides.length)
  assert.ok(entries.some((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)), 'il grafico è nativo, con i dati modificabili')
  const text = extractPptxText(buf)
  assert.match(text, /Traffico/)
  assert.match(text, /10\.980,00/, 'l’investimento arriva dal preventivo')
})

test('PDF: il timbro cambia con versione e preventivo; la chiave di render vale per una versione', () => {
  const a = pdfStamp({ version: 3, status: 'ready' }, '2026-10-20T10:00:00Z', { name: 'A' })
  assert.notEqual(a, pdfStamp({ version: 4, status: 'ready' }, '2026-10-20T10:00:00Z', { name: 'A' }))
  assert.notEqual(a, pdfStamp({ version: 3, status: 'ready' }, '2026-10-20T11:00:00Z', { name: 'A' }))
  assert.notEqual(a, pdfStamp({ version: 3, status: 'approved' }, '2026-10-20T10:00:00Z', { name: 'A' }))
  // Marchio del cliente e foto delle slide non alzano la versione, ma cambiano il PDF.
  assert.notEqual(a, pdfStamp({ version: 3, status: 'ready' }, '2026-10-20T10:00:00Z', { name: 'A' }, { accent: '#ff0000' }))
  const withPhoto = normalizeSlides([{ id: 's', kind: 'statement', image_asset_id: PHOTO }])
  assert.notEqual(a, pdfStamp({ version: 3, status: 'ready', slides: withPhoto }, '2026-10-20T10:00:00Z', { name: 'A' }))
  process.env.AGENCY_RENDER_SECRET = 'segreto'
  const token = 'a'.repeat(64)
  const key = renderKey(token, 5)
  assert.ok(validRenderKey(token, 5, key))
  assert.ok(!validRenderKey(token, 6, key))
  assert.ok(!validRenderKey(token, 5, 'x'))
  assert.ok(!validRenderKey(token, 5, undefined))
})

test('modello: gpt-5.1 di default, sovrascrivibile, indipendente da OPENAI_MODEL', () => {
  const saved = { a: process.env.OPENAI_AGENCY_MODEL, m: process.env.OPENAI_MODEL }
  delete process.env.OPENAI_AGENCY_MODEL
  process.env.OPENAI_MODEL = 'gpt-5-mini'
  assert.equal(agencyModel(), 'gpt-5.1')
  process.env.OPENAI_AGENCY_MODEL = 'gpt-5'
  assert.equal(agencyModel(), 'gpt-5')
  if (saved.a === undefined) delete process.env.OPENAI_AGENCY_MODEL
  else process.env.OPENAI_AGENCY_MODEL = saved.a
  if (saved.m === undefined) delete process.env.OPENAI_MODEL
  else process.env.OPENAI_MODEL = saved.m
})
