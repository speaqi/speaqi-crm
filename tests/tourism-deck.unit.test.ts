import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_DECK_TEMPLATE,
  DECK_TODO,
  applyVars,
  buildCorpus,
  countTodo,
  guardGenerated,
  mergeGenerated,
  normalizeTemplate,
  resolveVars
} from '../src/lib/tourism-deck'

const ASSET = '11111111-1111-4111-8111-111111111111'

test('il modello TTG ha promessa, contenuti, visitatore, metodo e prezzo', () => {
  const ids = DEFAULT_DECK_TEMPLATE.slides.map((s) => s.id)
  assert.deepEqual(ids, ['cover', 'promise', 'content', 'visitor', 'method', 'closing'])
})

test('i segnaposto si riempiono e ciò che manca resta da verificare', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'Capri Tourism' })
  assert.equal(slides[0].title, 'Capri, nella lingua di ogni visitatore')
  assert.equal(slides[0].body, 'Proposta per Capri Tourism')
  // Prezzo e contatto non sono stati dati: il prezzo resta quello del modello con la sua nota, il contatto da verificare.
  assert.match(slides[4].note, /249 €\/mese/)
  assert.match(slides[4].note, /\[DA VERIFICARE per questo ente\]/)
  assert.match(slides[5].body, /\[DA VERIFICARE\]/)
  assert.ok(countTodo(slides) >= 2)
})

test('senza destinazione il segnaposto non sparisce in silenzio', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, {})
  assert.match(slides[0].title, /\[DA VERIFICARE\]/)
})

test('un prezzo inserito sostituisce quello del modello e toglie la nota', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X', prezzo: '199 €/mese tutto compreso', contatto: 'info@example.com' })
  assert.equal(slides[4].note, 'Offerta Destinazioni: 199 €/mese tutto compreso')
  assert.equal(countTodo(slides), 0)
})

test('un modello non valido torna a quello di base', () => {
  assert.deepEqual(normalizeTemplate({ slides: [] }).slides.map((s) => s.id), DEFAULT_DECK_TEMPLATE.slides.map((s) => s.id))
  assert.equal(normalizeTemplate(null).version, 1)
})

test('gli id delle slide restano unici e i tipi sconosciuti diventano statement', () => {
  const t = normalizeTemplate({ slides: [{ id: 'a', kind: 'boh', title: 'x' }, { id: 'A', kind: 'cards', title: 'y' }] })
  assert.deepEqual(t.slides.map((s) => s.id), ['a', 'a-2'])
  assert.equal(t.slides[0].kind, 'statement')
})

test('l’agente non cambia tipo, numero di voci o istruzione di una slide', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const merged = mergeGenerated(base, {
    slides: [
      { id: 'content', title: 'Capri ha voce', kind: 'closing', items: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }, { title: 'C', text: 'c' }, { title: 'D', text: 'd' }, { title: 'E', text: 'e' }], hint: 'ignorami' },
      { id: 'inventata', title: 'no' }
    ]
  })
  const content = merged.find((s) => s.id === 'content')!
  assert.equal(content.title, 'Capri ha voce')
  assert.equal(content.kind, 'cards')
  assert.equal(content.items.length, 4)
  assert.equal(content.items[0].title, 'A')
  assert.equal(content.hint, base.find((s) => s.id === 'content')!.hint)
  assert.equal(merged.length, base.length)
})

test('una risposta vuota non svuota la slide', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const merged = mergeGenerated(base, { slides: [{ id: 'promise', title: '', body: '' }] })
  assert.deepEqual(merged[1], base[1])
})

test('un importo inventato diventa da verificare, uno scritto nei materiali resta', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const corpus = buildCorpus(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri' }, ['Il comune propone un budget di 5.000 € per il progetto.'])
  const edited = base.map((s) =>
    s.id === 'method' ? { ...s, note: 'Offerta: 99 €/mese, oppure 5.000 € una tantum' } : s
  )
  const { slides, warnings } = guardGenerated(edited, corpus, [])
  const note = slides.find((s) => s.id === 'method')!.note
  assert.equal(note, `Offerta: ${DECK_TODO}/mese, oppure 5.000 € una tantum`)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /99/)
})

test('un numero senza riscontro si segnala senza toccare il testo', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const edited = base.map((s) => (s.id === 'promise' ? { ...s, body: 'Con 1200 luoghi e dal 2026.' } : s))
  const { slides, warnings } = guardGenerated(edited, buildCorpus(DEFAULT_DECK_TEMPLATE, {}, []), [])
  assert.equal(slides.find((s) => s.id === 'promise')!.body, 'Con 1200 luoghi e dal 2026.')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /1200/)
})

test('una foto che non è del deck si toglie', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' }).map((s, i) => (i < 2 ? { ...s, image_asset_id: i === 0 ? ASSET : '22222222-2222-4222-8222-222222222222' } : s))
  const { slides } = guardGenerated(base, '', [ASSET])
  assert.equal(slides[0].image_asset_id, ASSET)
  assert.equal(slides[1].image_asset_id, null)
})

test('resolveVars non lascia mai un valore vuoto', () => {
  const v = resolveVars(DEFAULT_DECK_TEMPLATE, { destinazione: '  ' })
  assert.equal(v.destinazione, DECK_TODO)
  assert.equal(v.ente, DECK_TODO)
})
