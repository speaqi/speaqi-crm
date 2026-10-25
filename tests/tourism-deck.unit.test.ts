import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DECK_ART,
  DEFAULT_DECK_TEMPLATE,
  DECK_TODO,
  DESTINATIONS_BASE,
  applyVars,
  buildCorpus,
  countTodo,
  guardGenerated,
  mergeGenerated,
  normalizeTemplate,
  resolveVars
} from '../src/lib/tourism-deck'

import { GENERIC } from './deck-template-fixture'

const ASSET = '11111111-1111-4111-8111-111111111111'

test('la base è la presentazione «Speaqi Guides · Destinazioni»: quattordici slide nello stesso ordine', () => {
  const ids = DEFAULT_DECK_TEMPLATE.slides.map((s) => s.id)
  assert.deepEqual(ids, ['cover', 'partenza', 'proposta', 'cosa-ottieni', 'lingue', 'catalogo', 'provala', 'in-azione', 'collaborazione', 'requisiti', 'come-si-parte', 'servizi', 'domande', 'chiusura'])
  assert.equal(DEFAULT_DECK_TEMPLATE.base, DESTINATIONS_BASE)
  // La mappa è gratuita: nessun importo in euro, e nulla da completare a mano.
  assert.ok(!JSON.stringify(DEFAULT_DECK_TEMPLATE).includes('€'))
  assert.equal(countTodo(applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Bergamo', ente: 'Visit Bergamo' })), 0)
  // Le immagini fisse esistono davvero fra quelle servite.
  for (const s of DEFAULT_DECK_TEMPLATE.slides) {
    for (const key of [s.art, s.qr]) if (key) assert.ok(DECK_ART[key].startsWith('/deck/destinazioni/'))
  }
  // La base resta tale anche dopo una lettura dal database.
  const read = normalizeTemplate(JSON.parse(JSON.stringify(DEFAULT_DECK_TEMPLATE)))
  assert.equal(read.base, DESTINATIONS_BASE)
  assert.deepEqual(read.slides, DEFAULT_DECK_TEMPLATE.slides)
})

test('la destinazione entra nel nome: copertina, cosa ottiene, chiusura', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Bergamo', ente: 'Visit Bergamo' })
  const byId = (id: string) => slides.find((s) => s.id === id)!
  assert.equal(byId('cover').kicker, 'Speaqi Guides per Bergamo')
  assert.equal(byId('cosa-ottieni').title, 'Cosa ottiene Bergamo.')
  assert.match(byId('chiusura').title, /Facciamo la mappa di Bergamo\.$/)
  assert.equal(byId('requisiti').items[0].value, '250.000')
  assert.equal(byId('catalogo').items[0].highlight, true)
})

test('senza destinazione il segnaposto non sparisce in silenzio', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, {})
  assert.match(slides[0].kicker!, /\[DA VERIFICARE\]/)
  assert.ok(countTodo(slides) > 0)
})

test('le slide fisse restano parola per parola: l’agente sceglie solo la foto', () => {
  const base = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Bergamo', ente: 'Visit Bergamo' })
  const merged = mergeGenerated(base, {
    slides: [
      { id: 'cover', title: 'Bergamo ti aspetta', body: 'altro', items: [], image_asset_id: ASSET },
      { id: 'requisiti', title: 'Chiunque può candidarsi', items: [{ title: 'zero presenze', text: '' }] },
      { id: 'partenza', title: 'I visitatori arrivano.\nLe informazioni sono sparse.', items: [{ title: 'Tante lingue', text: 'tedeschi e americani, ognuno con la sua' }] }
    ]
  })
  const byId = (id: string) => merged.find((s) => s.id === id)!
  assert.equal(byId('cover').title, base[0].title)
  assert.equal(byId('cover').body, base[0].body)
  assert.equal(byId('cover').image_asset_id, ASSET)
  assert.deepEqual(byId('requisiti'), base.find((s) => s.id === 'requisiti'))
  // La slide del punto di partenza si personalizza, ma non perde le voci né il loro numero.
  assert.equal(byId('partenza').items[0].text, 'tedeschi e americani, ognuno con la sua')
  assert.equal(byId('partenza').items.length, 3)
})

test('i campi nuovi si leggono con giudizio: immagini solo per chiave, icone dall’elenco', () => {
  const t = normalizeTemplate({
    slides: [{
      id: 'x', kind: 'cards', title: 'T', kicker: 'K', footnote: 'F', tone: 'viola', art: 'https://evil.example/x.png', qr: 'qr-napoli', fixed: 'sì',
      items: [{ title: 'A', text: 'a', value: '12', icon: 'bomba', highlight: 'true' }, { title: 'B', text: 'b', icon: 'globe', highlight: true }]
    }]
  })
  const s = t.slides[0]
  assert.equal(s.kicker, 'K')
  assert.equal(s.footnote, 'F')
  assert.equal(s.tone, undefined)
  assert.equal(s.art, undefined)
  assert.equal(s.qr, 'qr-napoli')
  assert.equal(s.fixed, undefined)
  assert.deepEqual(s.items[0], { title: 'A', text: 'a', value: '12' })
  assert.deepEqual(s.items[1], { title: 'B', text: 'b', icon: 'globe', highlight: true })
})

test('i segnaposto si riempiono e ciò che manca resta da verificare', () => {
  const slides = applyVars(GENERIC, { destinazione: 'Capri', ente: 'Capri Tourism' })
  assert.equal(slides[0].title, 'La mappa perfetta per Capri Tourism')
  assert.equal(slides[1].title, 'Tutto Capri in una mappa sola')
  const byId = (id: string) => slides.find((s) => s.id === id)!
  assert.match(byId('prezzo').note, /^In cambio: in cambio garantite almeno 100\.000 accessi/)
  assert.match(byId('demo').body, /\[DA VERIFICARE\]/)
  assert.match(byId('territorio').items[0].text, /\[DA VERIFICARE: quanti\]/)
  assert.ok(countTodo(slides) >= 4)
})

test('condizioni inserite sostituiscono quelle del modello; restano solo i numeri del territorio', () => {
  const slides = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X', prezzo: 'almeno 50.000 accessi all’anno', contatto: 'info@example.com' })
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
  const base = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X' })
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
  const base = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X' })
  const merged = mergeGenerated(base, { slides: [{ id: 'problema', title: '', body: '' }] })
  assert.deepEqual(merged[2], base[2])
})

test('un importo inventato diventa da verificare, uno scritto nei materiali resta', () => {
  const base = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X' })
  const corpus = buildCorpus(GENERIC, { destinazione: 'Capri' }, ['Il comune propone un budget di 5.000 € per il progetto.'])
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
  const base = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X' })
  const edited = base.map((s) => (s.id === 'problema' ? { ...s, body: 'Con 1200 luoghi e dal 2026.' } : s))
  const { slides, warnings } = guardGenerated(edited, buildCorpus(GENERIC, {}, []), [])
  assert.equal(slides.find((s) => s.id === 'problema')!.body, 'Con 1200 luoghi e dal 2026.')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].message, /1200/)
})

test('una foto che non è del deck si toglie', () => {
  const base = applyVars(GENERIC, { destinazione: 'Capri', ente: 'X' }).map((s, i) => (i < 2 ? { ...s, image_asset_id: i === 0 ? ASSET : '22222222-2222-4222-8222-222222222222' } : s))
  const { slides } = guardGenerated(base, '', [ASSET])
  assert.equal(slides[0].image_asset_id, ASSET)
  assert.equal(slides[1].image_asset_id, null)
})

test('resolveVars non lascia mai un valore vuoto', () => {
  const v = resolveVars(GENERIC, { destinazione: '  ' })
  assert.equal(v.destinazione, DECK_TODO)
  assert.equal(v.ente, DECK_TODO)
})

test('base Partner: dodici slide, condizioni da scrivere, contatti di Speaqi in chiusura', async () => {
  const { PARTNER_DECK_TEMPLATE, PARTNER_BASE, deckModel } = await import('../src/lib/tourism-deck')
  assert.equal(PARTNER_DECK_TEMPLATE.base, PARTNER_BASE)
  assert.equal(PARTNER_DECK_TEMPLATE.slides.length, 12)
  // Passa intatta dalla normalizzazione: è la stessa forma di un modello salvato.
  assert.deepEqual(normalizeTemplate(PARTNER_DECK_TEMPLATE).slides, PARTNER_DECK_TEMPLATE.slides)
  for (const s of PARTNER_DECK_TEMPLATE.slides) {
    for (const key of [s.art, s.qr]) if (key) assert.ok(DECK_ART[key])
  }
  // Nessun prezzo o percentuale scritti nel modello: arrivano solo da chi la prepara.
  assert.ok(!/€|\d+\s?%/.test(JSON.stringify(PARTNER_DECK_TEMPLATE)))
  const empty = applyVars(PARTNER_DECK_TEMPLATE, { destinazione: 'Venezia', ente: 'Hotel Laguna' })
  assert.equal(countTodo(empty), 1)
  const filled = applyVars(PARTNER_DECK_TEMPLATE, { destinazione: 'Venezia', ente: 'Hotel Laguna', prezzo: '20% su ogni guida venduta dal vostro QR' })
  assert.equal(countTodo(filled), 0)
  assert.ok(JSON.stringify(filled).includes('Hotel Laguna'))
  assert.equal(deckModel({ modello: 'partner' }), 'partner')
  assert.equal(deckModel({}), 'destinazione')
  assert.equal(deckModel(null), 'destinazione')
})
