import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import sharp from 'sharp'
import { DECK_TODO, applyVars, DEFAULT_DECK_TEMPLATE } from '../src/lib/tourism-deck'
import { addAssets, createDeck, deleteDeck, generateIntoDeck, loadDeck, loadPublicDeck, saveDeckEdits, setApproval, type DeckRow } from '../src/lib/server/tourism-decks'

type Row = Record<string, any>

/** DB e Storage in memoria, solo il pezzo di query builder che il modulo usa. */
class Db {
  tables: Record<string, Row[]> = { tourism_decks: [], tourism_deck_templates: [], tourism_entities: [], tourism_site_sources: [] }
  files = new Map<string, Buffer>()
  failUpdates = false
  n = 0
  from(table: string) {
    return new Q(this, table)
  }
  storage = {
    getBucket: async () => ({ data: { id: 'b' } }),
    createBucket: async () => ({ error: null }),
    from: () => ({
      upload: async (path: string, buf: Buffer) => (this.files.set(path, buf), { error: null }),
      download: async (path: string) => (this.files.has(path) ? { data: new Blob([new Uint8Array(this.files.get(path)!)]), error: null } : { data: null, error: { message: 'no' } }),
      list: async (folder: string) => ({ data: [...this.files.keys()].filter((p) => p.startsWith(folder + '/')).map((p) => ({ name: p.slice(folder.length + 1) })) }),
      remove: async (paths: string[]) => (paths.forEach((p) => this.files.delete(p)), { error: null }),
      createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })) })
    })
  }
}
class Q {
  filters: ((r: Row) => boolean)[] = []
  op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  payload: Row = {}
  constructor(private db: Db, private table: string) {}
  select() { return this }
  insert(p: Row) { this.op = 'insert'; this.payload = p; return this }
  update(p: Row) { this.op = 'update'; this.payload = p; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this }
  in(c: string, v: unknown[]) { this.filters.push((r) => v.includes(r[c])); return this }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this }
  lt(c: string, v: string) { this.filters.push((r) => String(r[c]) < v); return this }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.split('.'))
    this.filters.push((r) => parts.some(([c, op, v]) => (op === 'neq' ? r[c] !== v : op === 'lt' ? String(r[c]) < v : false)))
    return this
  }
  limit() { return this }
  order() { return this }
  single() { return this.run(true, true) }
  maybeSingle() { return this.run(true, false) }
  then(res: (v: any) => unknown, rej?: (e: unknown) => unknown) { return this.run(false, false).then(res, rej) }
  private async run(one: boolean, strict: boolean) {
    const rows = this.db.tables[this.table]
    if (this.op === 'insert') {
      const row = { id: `00000000-0000-4000-8000-${String(++this.db.n).padStart(12, '0')}`, version: 1, status: 'draft', assets: [], warnings: [], error: null, generated_at: null, approved_at: null, public_token: 'f'.repeat(63) + this.db.n, created_at: 'x', updated_at: 'x', ...this.payload }
      rows.push(row)
      return { data: structuredClone(one ? row : [row]), error: null }
    }
    const hit = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.op === 'update') {
      if (this.db.failUpdates) return { data: null, error: { message: 'boom' } }
      hit.forEach((r) => Object.assign(r, this.payload))
    }
    if (this.op === 'delete') this.db.tables[this.table] = rows.filter((r) => !hit.includes(r))
    if (one) return hit.length || !strict ? { data: structuredClone(hit[0] ?? null), error: null } : { data: null, error: { message: 'no row' } }
    return { data: structuredClone(hit), error: null }
  }
}

const USER = '11111111-1111-4111-8111-111111111111'
let db: Db
let realFetch: typeof fetch
let key: string | undefined
beforeEach(() => {
  db = new Db()
  realFetch = globalThis.fetch
  key = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'k'
})
afterEach(() => {
  globalThis.fetch = realFetch
  if (key === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = key
})

const fields = { destination: 'Capri', entity_id: null, notes: 'Isola dei Faraglioni.', input: { destinazione: 'Capri', ente: 'Capri Tourism' } }
const png = () => sharp({ create: { width: 20, height: 20, channels: 3, background: '#2b6' } }).png().toBuffer()
const provider = (slides: unknown[]) => (async () => ({ ok: true, status: 200, json: async () => ({ output_text: JSON.stringify({ slides, missing: [] }) }) })) as unknown as typeof fetch

test('createDeck parte dal modello con i segnaposto riempiti', async () => {
  const row = await createDeck(db, USER, fields)
  assert.equal(row.status, 'draft')
  assert.equal(row.slides[0].title, 'Capri, nella lingua di ogni visitatore')
  assert.equal(db.tables.tourism_deck_templates.length, 1)
})

test('un ente non del proprietario si rifiuta', async () => {
  await assert.rejects(createDeck(db, USER, { ...fields, entity_id: '99999999-9999-4999-8999-999999999999' }), /Ente non trovato/)
  assert.equal(db.tables.tourism_decks.length, 0)
})

test('i file non validi o oltre i limiti si fermano prima di salvare', async () => {
  const row = await createDeck(db, USER, fields)
  await assert.rejects(addAssets(db, db, row, [{ name: 'x.jpg', buffer: Buffer.from('<?php') }]), /formato non supportato/)
  const photo = await png()
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.png`, buffer: photo }))
  await assert.rejects(addAssets(db, db, row, nine), /Al massimo 8 foto/)
  assert.equal(db.files.size, 0)
  assert.equal(row.assets.length, 0)
})

test('foto e documenti si salvano e si registrano', async () => {
  const row = await createDeck(db, USER, fields)
  const added = await addAssets(db, db, row, [{ name: 'a.png', buffer: await png() }, { name: 'brief.txt', buffer: Buffer.from('Visitatori dal Giappone') }])
  assert.equal(added.length, 2)
  assert.equal(db.files.size, 2)
  assert.equal(db.tables.tourism_decks[0].assets.length, 2)
})

test('l’agente legge note e documenti e il deck diventa pronto', async () => {
  const row = await createDeck(db, USER, fields)
  const [photo] = await addAssets(db, db, row, [{ name: 'a.png', buffer: await png() }, { name: 'brief.txt', buffer: Buffer.from('Visitatori dal Giappone') }])
  let sent = ''
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    sent = String(init.body)
    return provider([{ id: 'cover', title: 'Capri parla giapponese', body: 'Proposta per Capri Tourism', note: '', items: [], image_asset_id: photo.id }])(_u as string, init)
  }) as typeof fetch
  const deck = await generateIntoDeck(db, db, row)
  assert.equal(deck.status, 'ready')
  assert.equal(deck.slides[0].title, 'Capri parla giapponese')
  assert.equal(deck.slides[0].image_asset_id, photo.id)
  assert.equal(deck.version, 2)
  assert.match(sent, /Visitatori dal Giappone/)
  assert.match(sent, /data:image\/jpeg;base64,/)
})

test('se l’agente fallisce il deck resta modificabile a mano', async () => {
  const row = await createDeck(db, USER, fields)
  const before = JSON.stringify(row.slides)
  globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
  const deck = await generateIntoDeck(db, db, row)
  assert.equal(deck.status, 'failed')
  assert.match(deck.error!, /HTTP 500/)
  assert.equal(JSON.stringify(deck.slides), before)
})

test('due generazioni insieme non si pestano i piedi; una ferma da tempo si riprende', async () => {
  const row = await createDeck(db, USER, fields)
  db.tables.tourism_decks[0].status = 'generating'
  db.tables.tourism_decks[0].updated_at = new Date().toISOString()
  await assert.rejects(generateIntoDeck(db, db, row), /already running/)
  db.tables.tourism_decks[0].updated_at = new Date(Date.now() - 10 * 60_000).toISOString()
  globalThis.fetch = provider([])
  assert.equal((await generateIntoDeck(db, db, row)).status, 'ready')
})

test('salvataggio con versione vecchia = conflitto; una modifica toglie l’approvazione', async () => {
  const row = await createDeck(db, USER, fields)
  const edited = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X', prezzo: '199 €/mese', contatto: 'a@b.it' })
  const saved = await saveDeckEdits(db, row, { version: 1, slides: edited })
  assert.equal(saved.version, 2)
  await assert.rejects(saveDeckEdits(db, saved, { version: 1, slides: edited }), /Version conflict/)
  const approved = await setApproval(db, saved, true)
  assert.equal(approved.status, 'approved')
  const again = await saveDeckEdits(db, approved, { version: approved.version, title: 'Nuovo titolo' })
  assert.equal(again.status, 'ready')
  assert.equal(again.approved_at, null)
})

test('una foto non del deck sparisce dalle slide salvate', async () => {
  const row = await createDeck(db, USER, fields)
  const slides = row.slides.map((s, i) => (i === 0 ? { ...s, image_asset_id: '99999999-9999-4999-8999-999999999999' } : s))
  const saved = await saveDeckEdits(db, row, { version: 1, slides })
  assert.equal(saved.slides[0].image_asset_id, null)
})

test('non si approva con [DA VERIFICARE] ancora in pagina', async () => {
  const row = await createDeck(db, USER, fields)
  await assert.rejects(setApproval(db, row, true), /Restano \d+ \[DA VERIFICARE\]/)
  assert.ok(row.slides.some((s) => JSON.stringify(s).includes(DECK_TODO)))
})

test('la vista pubblica mostra solo ciò che è approvato, con token valido', async () => {
  const row = await createDeck(db, USER, fields)
  assert.equal(await loadPublicDeck(db, 'zz'), null)
  assert.equal(await loadPublicDeck(db, row.public_token), null)
  const full = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X', prezzo: '199 €/mese', contatto: 'a@b.it' })
  const saved = await saveDeckEdits(db, row, { version: 1, slides: full })
  await setApproval(db, saved, true)
  const pub = await loadPublicDeck(db, row.public_token)
  assert.equal(pub?.destination, 'Capri')
  assert.equal((await loadDeck(db, USER, row.id)).status, 'approved')
})

test('cancellare un deck toglie foto, documenti e PDF generati', async () => {
  const row = await createDeck(db, USER, fields)
  await addAssets(db, db, row, [{ name: 'a.png', buffer: await png() }])
  db.files.set(`${row.user_id}/${row.id}/deck-v2.pdf`, Buffer.from('%PDF-1.7'))
  db.files.set('altro-utente/altro-deck/deck-v1.pdf', Buffer.from('%PDF-1.7'))
  await deleteDeck(db, db, row)
  assert.deepEqual([...db.files.keys()], ['altro-utente/altro-deck/deck-v1.pdf'])
  assert.equal(db.tables.tourism_decks.length, 0)
})
