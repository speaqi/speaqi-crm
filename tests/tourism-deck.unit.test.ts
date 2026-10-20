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

test('il modello segue la proposta destinazioni: dodici slide nello stesso ordine', () => {
  const ids = DEFAULT_DECK_TEMPLATE.slides.map((s) => s.id)
  assert.deepEqual(ids, ['cover', 'territorio', 'problema', 'soluzione', 'prova', 'contenuti', 'lingue', 'visitatore', 'metodo', 'prezzo', 'area-riservata', 'demo'])
  // La mappa e' gratuita: nessun importo in euro nel modello.
  assert.ok(!JSON.stringify(DEFAULT_DECK_TEMPLATE).includes('€'))
  assert.match(DEFAULT_DECK_TEMPLATE.vars.prezzo, /100\.000 accessi/)
})

test('i segnaposto si riempiono e ciò che manca resta da verificare', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'Capri Tourism' })
  assert.equal(slides[0].title, 'La mappa perfetta per Capri Tourism')
  assert.equal(slides[1].title, 'Tutto Capri in una mappa sola')
  // Condizioni e contatto non sono stati dati: restano quelle del modello, il contatto da verificare.
  const byId = (id: string) => slides.find((s) => s.id === id)!
  assert.match(byId('prezzo').note, /^In cambio: in cambio garantite almeno 100\.000 accessi/)
  assert.match(byId('demo').body, /\[DA VERIFICARE\]/)
  // I numeri del territorio non si indovinano.
  assert.match(byId('territorio').items[0].text, /\[DA VERIFICARE: quanti\]/)
  assert.ok(countTodo(slides) >= 4)
})

test('senza destinazione il segnaposto non sparisce in silenzio', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, {})
  assert.match(slides[0].title, /\[DA VERIFICARE\]/)
})

test('condizioni inserite sostituiscono quelle del modello; restano solo i numeri del territorio', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X', prezzo: 'almeno 50.000 accessi all’anno', contatto: 'info@example.com' })
  assert.equal(slides.find((s) => s.id === 'prezzo')!.note, 'In cambio: almeno 50.000 accessi all’anno')
  assert.equal(countTodo(slides), 3)
  assert.equal(countTodo(slides.filter((s) => s.id !== 'territorio')), 0)
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
      { id: 'visitatore', title: 'Capri ha voce', kind: 'closing', items: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }, { title: 'C', text: 'c' }, { title: 'D', text: 'd' }, { title: 'E', text: 'e' }], hint: 'ignorami' },
      { id: 'inventata', title: 'no' }
    ]
  })
  const content = merged.find((s) => s.id === 'visitatore')!
  assert.equal(content.title, 'Capri ha voce')
  assert.equal(content.kind, 'steps')
  assert.equal(content.items.length, 4)
  assert.equal(content.items[0].title, 'A')
  assert.equal(content.hint, base.find((s) => s.id === 'visitatore')!.hint)
  assert.equal(merged.length, base.length)
})

test('una risposta vuota non svuota la slide', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const merged = mergeGenerated(base, { slides: [{ id: 'problema', title: '', body: '' }] })
  assert.deepEqual(merged[2], base[2])
})

test('un importo inventato diventa da verificare, uno scritto nei materiali resta', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const corpus = buildCorpus(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri' }, ['Il comune propone un budget di 5.000 € per il progetto.'])
  const edited = base.map((s) =>
    s.id === 'prezzo' ? { ...s, note: 'Offerta: 99 €/mese, oppure 5.000 € una tantum' } : s
  )
  const { slides, warnings } = guardGenerated(edited, corpus, [])
  const note = slides.find((s) => s.id === 'prezzo')!.note
  assert.equal(note, `Offerta: ${DECK_TODO}/mese, oppure 5.000 € una tantum`)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /99/)
})

test('un numero senza riscontro si segnala senza toccare il testo', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'X' })
  const edited = base.map((s) => (s.id === 'problema' ? { ...s, body: 'Con 1200 luoghi e dal 2026.' } : s))
  const { slides, warnings } = guardGenerated(edited, buildCorpus(DEFAULT_DECK_TEMPLATE, {}, []), [])
  assert.equal(slides.find((s) => s.id === 'problema')!.body, 'Con 1200 luoghi e dal 2026.')
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
