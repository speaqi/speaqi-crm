/**
 * Speaqi Agency contro lo stack locale (tests/agency-stack): Postgres 16 con tutte le
 * migration, PostgREST vero (RLS, trigger, vincoli) e storage del gateway. L'agente
 * OpenAI è simulato qui, per provare in modo deterministico cosa fa il codice con la
 * risposta; la chiamata vera si prova a parte (tests/agency.browser.ts).
 *
 *   tests/agency-stack/stack.sh up && source <(tests/agency-stack/stack.sh env)
 *   node --import tsx --test tests/agency.stack.test.ts
 */
import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { createHmac, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  addProjectAssets,
  attachQuote,
  claimGeneration,
  createPresentation,
  createProject,
  deleteProject,
  detachQuote,
  importWebsite,
  listCategories,
  listVersions,
  loadPresentation,
  loadProject,
  loadPublicPresentation,
  presentationView,
  projectView,
  removeProjectAsset,
  renderKey,
  restoreVersion,
  runGeneration,
  runRevision,
  saveEdits,
  setApproval
} from '../src/lib/server/agency'
import { AGENCY_BUCKET } from '../src/lib/server/agency-assets'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const RUN = randomUUID().slice(0, 6).toUpperCase()
process.env.AGENCY_RENDER_SECRET = 'render-secret-di-prova'
process.env.OPENAI_API_KEY = 'sk-test-finta'

const jwt = (payload: Record<string, unknown>) => {
  const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const h = b({ alg: 'HS256', typ: 'JWT' })
  const p = b({ exp: 2000000000, ...payload })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const client = (token: string) => createClient(URL_, token, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
const service = client(jwt({ role: 'service_role' }))
const owner = client(jwt({ role: 'authenticated', sub: OWNER }))
const other = client(jwt({ role: 'authenticated', sub: OTHER }))

// ---- OpenAI simulato ------------------------------------------------------
const realFetch = globalThis.fetch
let nextModelResponse: unknown = null
const modelRequests: any[] = []
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url
  if (String(url).startsWith('https://api.openai.com/')) {
    modelRequests.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(nextModelResponse) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

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

const slide = (o: Record<string, unknown>) => ({ id: 'x', kind: 'statement', kicker: '', title: '', body: '', items: [], note: '', image_asset_id: null, layout: 'auto', ...o })
const item = (title: string, text = '', value = '') => ({ title, text, value })

let contactId = ''
let dealId = ''
let projectId = ''
let presentationId = ''
let photoId = ''
let quoteId = ''

before(async () => {
  contactId = randomUUID()
  dealId = randomUUID()
  const c = await service.from('contacts').insert({ id: contactId, user_id: OWNER, name: 'Giulia Rossi', company: 'Cantina Rossi srl', email: 'giulia@cantinarossi.it', status: 'Contacted', industry: 'Vino' })
  assert.equal(c.error, null, c.error?.message)
  const d = await service.from('deals').insert({ id: dealId, user_id: OWNER, contact_id: contactId, title: 'Trattativa', stage: 'Contacted' })
  assert.equal(d.error, null, d.error?.message)
})

test('categorie di partenza create alla prima lettura, una volta sola', async () => {
  const a = await listCategories(owner, OWNER)
  const b = await listCategories(owner, OWNER)
  assert.equal(a.length, 10)
  assert.equal(b.length, 10)
})

test('opportunità: serve un cliente del CRM; la trattativa aperta si aggancia', async () => {
  await assert.rejects(createProject(owner, OWNER, { title: 'x' }), /cliente/)
  await assert.rejects(createProject(owner, OWNER, { contact_id: randomUUID() }), /non trovato/)
  const p = await createProject(owner, OWNER, { contact_id: contactId, title: 'Nuovo sito e posizionamento', services: ['siti-web', 'seo-geo', 'non-esiste'], brief: 'Il sito ha 12.400 visite al mese, il 68% da mobile. Vogliono vendere online. Budget indicativo 15.000 euro.' })
  projectId = p.id
  assert.equal(p.client_name, 'Cantina Rossi srl')
  assert.equal(p.deal_id, dealId)
  assert.deepEqual(p.services, ['siti-web', 'seo-geo'])
  const act = await service.from('activities').select('content').eq('contact_id', contactId)
  assert.ok((act.data || []).some((a: any) => /Speaqi Agency/.test(a.content)), 'l’apertura finisce nella timeline del contatto')
})

test('materiali: Word, PowerPoint, foto e logo; un file non valido non lascia niente', async () => {
  const row = await loadProject(owner, OWNER, projectId)
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Fondata nel 1987, 40 ettari di vigneto.</w:t></w:r></w:p></w:body></w:document>' })
  const pptx = zip({ 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Obiettivo: export in Germania</a:t></a:r></a:p></p:sld>' })
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#7a1f3d' } }).png().toBuffer()
  await assert.rejects(addProjectAssets(owner, service, row, [{ name: 'ok.docx', buffer: docx }, { name: 'virus.exe', buffer: Buffer.from('MZ') }]), /formato non supportato/)
  assert.equal((await loadProject(owner, OWNER, projectId)).assets.length, 0)
  const added = await addProjectAssets(owner, service, row, [
    { name: 'brief.docx', buffer: docx },
    { name: 'kickoff.pptx', buffer: pptx },
    { name: 'vigna.png', buffer: png },
    { name: 'logo.png', buffer: png, role: 'logo' }
  ])
  photoId = added.find((a) => a.name === 'vigna.png')!.id
  const saved = await loadProject(owner, OWNER, projectId)
  assert.equal(saved.assets.length, 4)
  assert.equal(saved.client_brand.logo_asset_id, added.find((a) => a.kind === 'logo')!.id)
  const file = await service.storage.from(AGENCY_BUCKET).download(saved.assets[0].path)
  assert.equal(file.error, null)
})

test('sito del cliente letto e salvato fra i materiali (una lettura nuova sostituisce la vecchia)', async () => {
  const row = await loadProject(owner, OWNER, projectId)
  const fetcher = async (u: string) => ({ url: u, title: 'Cantina Rossi', truncated: false, text: `Sito: ${u}\n## I nostri vini\nQuaranta ettari in collina.` })
  await importWebsite(owner, service, row, 'https://cantinarossi.it', fetcher as any)
  await importWebsite(owner, service, row, 'https://www.cantinarossi.it/', fetcher as any)
  const saved = await loadProject(owner, OWNER, projectId)
  assert.equal(saved.assets.filter((a) => a.kind === 'website').length, 1)
  assert.equal(saved.website_url, 'https://cantinarossi.it')
})

test('presentazione: bozza v1 con la sua versione; l’opportunità passa a "Proposta"', async () => {
  const project = await loadProject(owner, OWNER, projectId)
  const p = await createPresentation(owner, project, {})
  presentationId = p.id
  assert.equal(p.status, 'draft')
  assert.equal(p.version, 1)
  assert.equal(p.slides[0].kind, 'cover')
  assert.equal((await loadProject(owner, OWNER, projectId)).stage, 'proposal')
  assert.equal((await listVersions(owner, p)).length, 1)
})

test('generazione: l’agente legge tutti i materiali; il codice decide cosa resta', async () => {
  nextModelResponse = {
    title: 'Un sito che vende in tre lingue',
    style: 'editorial',
    analysis: {
      client_summary: 'Cantina storica con 40 ettari.',
      sector: 'Vino',
      needs: ['Vendere online'],
      objectives: ['Export in Germania'],
      verified_facts: [{ fact: '68% delle visite da mobile', source: 'brief' }, { fact: 'Fondata nel 1987', source: 'brief.docx' }],
      assumptions: ['Il pubblico tedesco cerca in tedesco'],
      missing: ['Referente marketing'],
      strategy: { positioning: 'Cantina di territorio', proposal: 'Nuovo sito multilingua e SEO/GEO', services: ['Siti web', 'SEO'] }
    },
    slides: [
      slide({ id: 'cover', kind: 'cover', title: 'Un sito che vende in tre lingue', body: 'Proposta per Cantina Rossi', image_asset_id: photoId }),
      slide({ id: 'context', kind: 'context', title: 'Dal 1987, 40 ettari: una storia che il sito non racconta', items: [item('68% da mobile', 'Dal brief'), item('Nessuno shop', 'Vendita solo in cantina')] }),
      slide({ id: 'problems', kind: 'problems', title: 'Tre freni alle vendite', items: [item('Lento'), item('Solo italiano'), item('Invisibile alle AI')] }),
      slide({ id: 'benefits', kind: 'benefits', title: 'Con il nuovo sito +40% di ordini', items: [item('Più ordini'), item('Più export')] }),
      slide({ id: 'investment', kind: 'investment', title: 'L’investimento: 15.000 euro', items: [item('Sito', '', '9.000 €')] }),
      slide({ id: 'photo2', kind: 'statement', title: 'Stessa foto', image_asset_id: photoId }),
      slide({ id: 'closing', kind: 'closing', title: 'Partiamo', body: 'info@speaqi.com' })
    ]
  }
  const row = await loadPresentation(owner, OWNER, presentationId)
  const claimed = await claimGeneration(owner, row)
  await assert.rejects(claimGeneration(owner, row), /already running/, 'una generazione alla volta')
  const done = await runGeneration(owner, service, claimed)
  assert.equal(done.status, 'ready', done.error || '')
  assert.equal(done.version, 2)
  const req = modelRequests.at(-1)
  const text = JSON.stringify(req.input[1].content)
  assert.match(text, /Fondata nel 1987/, 'Word letto')
  assert.match(text, /export in Germania/, 'PowerPoint letto')
  assert.match(text, /Quaranta ettari in collina/, 'sito letto')
  assert.match(text, /LOGO DEL CLIENTE/)
  assert.ok(req.input[1].content.some((p: any) => p.type === 'input_image'))
  const byId = new Map(done.slides.map((s) => [s.id, s]))
  assert.match(byId.get('benefits')!.title, /\[DA VERIFICARE\]/, 'risultato inventato sostituito')
  assert.equal(byId.get('investment')!.items.length, 0)
  assert.match(byId.get('investment')!.title, /\[DA VERIFICARE\]/, 'nessuna cifra nella slide investimento')
  assert.equal(byId.get('cover')!.image_asset_id, photoId)
  assert.equal(byId.get('photo2')!.image_asset_id, null)
  const project = await loadProject(owner, OWNER, projectId)
  assert.equal(project.analysis.verified_facts?.length, 2)
  assert.ok(done.warnings.some((w) => /Referente marketing/.test(w.message)))
})

test('modifica a mano: versione controllata e storicizzata', async () => {
  const row = await loadPresentation(owner, OWNER, presentationId)
  const project = await loadProject(owner, OWNER, projectId)
  await assert.rejects(saveEdits(owner, row, project, { version: row.version - 1, title: 'X' }), /Version conflict/)
  const slides = row.slides.map((s) => (s.id === 'benefits' ? { ...s, title: 'Più ordini, anche dall’estero' } : s))
  const saved = await saveEdits(owner, row, project, { version: row.version, slides, reason: 'Titolo benefici' })
  assert.equal(saved.version, row.version + 1)
  const versions = await listVersions(owner, saved)
  assert.equal(versions[0].version, saved.version)
  assert.equal(versions[0].reason, 'Titolo benefici')
  const v = await service.from('agency_presentation_versions').update({ reason: 'x' }).eq('presentation_id', presentationId).select()
  assert.ok(v.error, 'una versione salvata non si riscrive')
})

test('approvazione bloccata dai [DA VERIFICARE] e dall’investimento senza preventivo', async () => {
  const row = await loadPresentation(owner, OWNER, presentationId)
  await assert.rejects(setApproval(owner, row, true), /DA VERIFICARE/)
})

test('preventivo: si collega solo se dello stesso cliente; la slide investimento lo legge', async () => {
  quoteId = randomUUID()
  const q = await service.from('quotes').insert({
    id: quoteId, user_id: OWNER, contact_id: contactId, quote_number: `PREV-AG-1-${RUN}`, status: 'sent', title: 'Sito e SEO', customer_name: 'Cantina Rossi',
    items: [{ description: 'Sito web', quantity: 1, unit_price: 9000, line_total: 9000 }, { description: 'SEO e GEO', details: 'Primo trimestre', quantity: 1, unit_price: 2400, line_total: 2400 }],
    subtotal_amount: 11400, tax_rate: 22, tax_amount: 2508, total_amount: 13908, deposit_amount: 0, balance_amount: 13908
  })
  assert.equal(q.error, null, q.error?.message)
  const foreign = randomUUID()
  const otherContact = randomUUID()
  await service.from('contacts').insert({ id: otherContact, user_id: OWNER, name: 'Altro cliente', status: 'New' })
  await service.from('quotes').insert({ id: foreign, user_id: OWNER, contact_id: otherContact, quote_number: `PREV-AG-2-${RUN}`, status: 'sent', customer_name: 'Altro', items: [] })
  const project = await loadProject(owner, OWNER, projectId)
  await assert.rejects(attachQuote(owner, project, foreign), /altro cliente/)
  await attachQuote(owner, project, quoteId)
  const p = await createPresentation(owner, project, {})
  assert.equal(p.quote_id, quoteId, 'una presentazione nuova mostra il preventivo dell’opportunità')

  // La presentazione principale: collega il preventivo e completa i [DA VERIFICARE].
  const row = await loadPresentation(owner, OWNER, presentationId)
  const slides = row.slides.map((s) =>
    s.id === 'investment' ? { ...s, title: 'L’investimento' } : s.id === 'benefits' ? { ...s, title: 'Più ordini, anche dall’estero' } : s
  )
  const saved = await saveEdits(owner, row, project, { version: row.version, slides, quote_id: quoteId })
  const view = await presentationView(owner, service, saved)
  assert.equal(view.todo, 0, JSON.stringify(view.slides.map((s) => s.title)))
  assert.equal(view.quote?.total, 13908)
  assert.equal(view.quote?.lines.length, 2)
})

test('vista pubblica: bozza solo con la chiave di render, approvata con il link', async () => {
  const row = await loadPresentation(owner, OWNER, presentationId)
  assert.equal(await loadPublicPresentation(service, row.public_token), null)
  const draft = await loadPublicPresentation(service, row.public_token, renderKey(row.public_token, row.version))
  assert.equal(draft?.draft, true)
  assert.equal(await loadPublicPresentation(service, row.public_token, renderKey(row.public_token, row.version - 1)), null, 'chiave di una versione vecchia')
  const approved = await setApproval(owner, row, true)
  const pub = await loadPublicPresentation(service, approved.public_token)
  assert.equal(pub?.draft, false)
  assert.equal(pub?.quote?.total, 13908)
  assert.ok(pub?.quote?.public_token, 'preventivo inviato: il link al preventivo si mostra')
  assert.ok(pub?.client_logo, 'logo del cliente firmato')
  assert.ok(Object.keys(pub?.images || {}).length >= 1)
  const project = await loadProject(owner, OWNER, projectId)
  await saveEdits(owner, approved, project, { version: approved.version, title: 'Cambiata' })
  assert.equal(await loadPublicPresentation(service, approved.public_token), null, 'una modifica spegne il link')
})

test('revisione con l’AI: solo le slide interessate, e si torna indietro con le versioni', async () => {
  const before = await loadPresentation(owner, OWNER, presentationId)
  nextModelResponse = {
    summary: 'Tolta la parte economica, aggiunta una roadmap di sei mesi, tono più istituzionale.',
    style: 'institutional',
    operations: [
      { op: 'delete', id: 'investment', after_id: null, slide: null },
      { op: 'insert', id: '', after_id: 'problems', slide: slide({ kind: 'roadmap', title: 'Sei mesi, quattro fasi', items: [item('Analisi', '', 'Mese 1'), item('Design', '', 'Mese 2'), item('Sviluppo', '', 'Mese 3-5'), item('Lancio', '', 'Mese 6')] }) },
      { op: 'update', id: 'closing', after_id: null, slide: slide({ id: 'closing', kind: 'closing', title: 'Restiamo a vostra disposizione', body: 'info@speaqi.com' }) }
    ]
  }
  const claimed = await claimGeneration(owner, before)
  const done = await runRevision(owner, service, claimed, 'Più istituzionale, aggiungi una roadmap di sei mesi, elimina la parte economica')
  assert.equal(done.status, 'ready', done.error || '')
  assert.equal(done.theme.style, 'institutional')
  assert.ok(!done.slides.some((s) => s.kind === 'investment'))
  const ids = done.slides.map((s) => s.id)
  assert.equal(ids[ids.indexOf('problems') + 1], 'roadmap')
  const untouched = before.slides.find((s) => s.id === 'context')
  assert.deepEqual(done.slides.find((s) => s.id === 'context'), untouched, 'le altre slide restano identiche')
  assert.match(done.last_change, /roadmap/)
  const sentSlides = JSON.parse(modelRequests.at(-1).input[1].content.find((p: any) => /PRESENTAZIONE ATTUALE/.test(p.text)).text.replace(/^[^\n]*\n/, ''))
  assert.equal(sentSlides.length, before.slides.length, 'l’agente riceve il deck attuale')

  const project = await loadProject(owner, OWNER, projectId)
  const restored = await restoreVersion(owner, done, project, before.version)
  assert.ok(restored.slides.some((s) => s.kind === 'investment'))
  assert.equal(restored.version, done.version + 1, 'il ripristino è una versione nuova')
})

test('un errore dell’agente lascia le slide com’erano, con il motivo', async () => {
  const before = await loadPresentation(owner, OWNER, presentationId)
  nextModelResponse = { slides: 'rotto' }
  const claimed = await claimGeneration(owner, before)
  const failed = await runGeneration(owner, service, claimed)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error || '', /senza slide/)
  assert.deepEqual(failed.slides, before.slides)
})

test('RLS e proprietario: un altro utente non vede né aggancia', async () => {
  const seen = await other.from('agency_projects').select('id')
  assert.equal(seen.data?.length, 0)
  const sneaky = await other.from('agency_presentations').insert({ user_id: OTHER, project_id: projectId, title: 'x' })
  assert.ok(sneaky.error, 'presentazione sul progetto di un altro')
  const sneakyQuote = await other.from('quotes').insert({ user_id: OTHER, quote_number: 'X', customer_name: 'x', agency_project_id: projectId })
  assert.ok(sneakyQuote.error, 'preventivo agganciato al progetto di un altro')
  const steal = await other.from('agency_projects').insert({ user_id: OTHER, contact_id: contactId, client_name: 'x', title: 'x' })
  assert.ok(steal.error, 'contatto di un altro')
})

test('vista del progetto e pulizia: rimozione file, scollegamento, cancellazione', async () => {
  const project = await loadProject(owner, OWNER, projectId)
  const view = await projectView(owner, service, project)
  assert.equal(view.contact?.id, contactId)
  assert.equal(view.deal?.id, dealId)
  assert.ok(view.presentations.length >= 2)
  assert.equal(view.quotes[0].number, `PREV-AG-1-${RUN}`)
  await removeProjectAsset(owner, service, project, photoId)
  const pres = await loadPresentation(owner, OWNER, presentationId)
  assert.ok(!pres.slides.some((s) => s.image_asset_id === photoId), 'la foto tolta esce dalle slide')
  await detachQuote(owner, project, quoteId)
  assert.equal((await loadPresentation(owner, OWNER, presentationId)).quote_id, null)
  await attachQuote(owner, project, quoteId)
  const paths = project.assets.map((a) => a.path)
  await deleteProject(owner, service, project)
  assert.equal((await owner.from('agency_projects').select('id').eq('id', projectId)).data?.length, 0)
  const q = await service.from('quotes').select('agency_project_id').eq('id', quoteId).single()
  assert.equal(q.data?.agency_project_id, null, 'il preventivo resta, senza collegamento')
  for (const p of paths) {
    const f = await service.storage.from(AGENCY_BUCKET).download(p)
    assert.ok(f.error, `file rimasto: ${p}`)
  }
})

test('regressione Tourism: la presa in carico della generazione funziona con PostgREST vero', async () => {
  const { generateIntoDeck } = await import('../src/lib/server/tourism-decks')
  const ins = await owner.from('tourism_decks').insert({ user_id: OWNER, title: 'Capri · Ente', destination: 'Capri', slides: [{ id: 'cover', kind: 'cover', title: 'Capri' }] }).select('*').single()
  assert.equal(ins.error, null, ins.error?.message)
  nextModelResponse = { slides: [{ id: 'cover', title: 'Capri, nella lingua di ogni visitatore', body: 'Proposta per Ente', note: '', items: [], image_asset_id: null }], missing: [] }
  const done = await generateIntoDeck(owner, service, ins.data as any)
  assert.equal(done.status, 'ready', done.error || '')
  assert.equal(done.slides[0].title, 'Capri, nella lingua di ogni visitatore')
  await owner.from('tourism_decks').delete().eq('id', ins.data.id)
})
