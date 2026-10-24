import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_DECK_TEMPLATE,
  DESTINATION_DECK_TEMPLATE,
  DISTRIBUTION_DECK_TEMPLATE,
  DECK_BASE_TEMPLATES,
  DECK_KINDS,
  DECK_MAX_SLIDES,
  DECK_VAR_NAMES,
  DESTINATION_ENTITY_TYPES,
  DISTRIBUTION_ENTITY_TYPES,
  baseTemplateFor,
  suggestDeckKind,
  DECK_TODO,
  applyVars,
  buildCorpus,
  countTodo,
  guardGenerated,
  mergeGenerated,
  normalizeTemplate,
  resolveVars
} from '../src/lib/tourism-deck'
import { TOURISM_TYPES } from '../src/lib/tourism'

const ASSET = '11111111-1111-4111-8111-111111111111'

test('la base destinazioni segue la pagina destinations: tredici slide nello stesso ordine', () => {
  const ids = DEFAULT_DECK_TEMPLATE.slides.map((s) => s.id)
  assert.deepEqual(ids, ['cover', 'territorio', 'problema', 'soluzione', 'prova', 'contenuti', 'visitatore', 'modello', 'requisiti', 'metodo', 'prezzo', 'opzionali', 'demo'])
  assert.equal(DEFAULT_DECK_TEMPLATE, DESTINATION_DECK_TEMPLATE)
  // La mappa e' gratuita: nessun importo in euro nel modello.
  assert.ok(!JSON.stringify(DEFAULT_DECK_TEMPLATE).includes('€'))
  assert.match(DEFAULT_DECK_TEMPLATE.vars.prezzo, /2 canali di distribuzione/)
  // Le soglie della candidatura sono quelle pubblicate, non altre.
  const requisiti = DEFAULT_DECK_TEMPLATE.slides.find((s) => s.id === 'requisiti')!
  assert.equal(requisiti.items.length, 5)
  assert.match(requisiti.items[0].text, /250\.000/)
  // I servizi opzionali sono su proposta separata, non inclusi.
  assert.deepEqual(DEFAULT_DECK_TEMPLATE.slides.find((s) => s.id === 'opzionali')!.items.map((i) => i.title), ['iConcierge', 'Eventi', 'Contenuti multilingue'])
})

test('la base distribuzione segue la presentazione di partnership: dodici slide, revenue sharing e pilota di 90 giorni', () => {
  const ids = DISTRIBUTION_DECK_TEMPLATE.slides.map((s) => s.id)
  assert.deepEqual(ids, ['cover', 'opportunita', 'prodotto', 'lingue', 'prova', 'partnership', 'distribuzione', 'esperienze', 'oltre', 'modello', 'pilota', 'chiusura'])
  const byId = (id: string) => DISTRIBUTION_DECK_TEMPLATE.slides.find((s) => s.id === id)!
  assert.deepEqual(byId('modello').items.map((i) => i.title), ['20%', '35%', '50%'])
  assert.deepEqual(byId('pilota').items.map((i) => i.title), ['30 giorni', '60 giorni', '90 giorni'])
  assert.match(DISTRIBUTION_DECK_TEMPLATE.vars.prezzo, /zero investimento iniziale/)
  // Il dato del partner non si inventa: il numero di viaggiatori e il contatto restano da verificare.
  const slides = applyVars(DISTRIBUTION_DECK_TEMPLATE, { destinazione: 'Roma', ente: 'Aeroporti di Roma' })
  assert.equal(slides[0].title, 'Roma, nella lingua di ogni viaggiatore.')
  assert.equal(slides[0].body, 'Un servizio in più per i clienti di Aeroporti di Roma. Un ricavo in più per Aeroporti di Roma.')
  assert.match(slides.find((s) => s.id === 'opportunita')!.body, /\[DA VERIFICARE: numero, anno e fonte\]/)
  assert.match(slides.find((s) => s.id === 'chiusura')!.body, /\[DA VERIFICARE\]/)
  assert.equal(countTodo(slides), 2)
  // Le condizioni indicate dall'utente sostituiscono quelle del modello.
  const custom = applyVars(DISTRIBUTION_DECK_TEMPLATE, { destinazione: 'Roma', ente: 'X', prezzo: 'Commissione fissa del 15%', contatto: 'a@b.it' })
  assert.equal(custom.find((s) => s.id === 'modello')!.body, 'Commissione fissa del 15%')
  assert.equal(countTodo(custom), 1)
})

test('le due basi sopravvivono alla normalizzazione senza tagli e usano solo segnaposto noti', () => {
  for (const kind of DECK_KINDS) {
    const base = DECK_BASE_TEMPLATES[kind]
    assert.ok(base.slides.length <= DECK_MAX_SLIDES, kind)
    const normalized = normalizeTemplate(base, kind)
    // Un testo oltre i limiti verrebbe tagliato in silenzio: il modello salvato non sarebbe piu' quello scritto qui.
    assert.deepEqual(normalized.slides, base.slides, kind)
    assert.deepEqual(normalized.vars, base.vars, kind)
    assert.equal(new Set(base.slides.map((s) => s.id)).size, base.slides.length, kind)
    const placeholders = new Set([...JSON.stringify(base).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1].toLowerCase()))
    for (const name of placeholders) assert.ok((DECK_VAR_NAMES as readonly string[]).includes(name), `${kind}: {{${name}}}`)
    // Ogni slide spiega all'agente cosa personalizzare.
    for (const slide of base.slides) assert.ok(slide.hint.length > 10, `${kind}/${slide.id}`)
  }
  assert.notDeepEqual(DECK_BASE_TEMPLATES.destination.slides.map((s) => s.id), DECK_BASE_TEMPLATES.distribution.slides.map((s) => s.id))
})

test('baseTemplateFor restituisce una copia: modificarla non tocca la base', () => {
  const copy = baseTemplateFor('distribution')
  copy.slides[0].title = 'cambiato'
  assert.notEqual(DISTRIBUTION_DECK_TEMPLATE.slides[0].title, 'cambiato')
})

test('un modello vuoto torna alla base del suo tipo, non sempre alle destinazioni', () => {
  assert.deepEqual(normalizeTemplate({ slides: [] }, 'distribution').slides.map((s) => s.id), DISTRIBUTION_DECK_TEMPLATE.slides.map((s) => s.id))
  assert.deepEqual(normalizeTemplate({ slides: [] }).slides.map((s) => s.id), DESTINATION_DECK_TEMPLATE.slides.map((s) => s.id))
})

test('il tipo di presentazione si suggerisce dal tipo di ente, poi dal nome; nel dubbio non si indovina', () => {
  assert.equal(suggestDeckKind({ type_code: 'dmo' })?.kind, 'destination')
  assert.equal(suggestDeckKind({ type_code: 'municipality' })?.kind, 'destination')
  assert.equal(suggestDeckKind({ type_code: 'cruise_line', name: 'MSC Crociere' })?.kind, 'distribution')
  assert.equal(suggestDeckKind({ type_code: 'tour_operator' }, 'Tour operator')?.reason, 'L’ente è «Tour operator»: porta o vende ai visitatori.')
  // Aeroporti e porti non hanno un tipo: il nome decide, ma solo se parla chiaro.
  assert.equal(suggestDeckKind({ type_code: 'other', name: 'Aeroporti di Roma' })?.kind, 'distribution')
  assert.equal(suggestDeckKind({ type_code: null, name: 'Autorità di Sistema Portuale del Mar Tirreno' })?.kind, 'distribution')
  assert.equal(suggestDeckKind({ type_code: 'other', name: 'Fondazione Capri' }), null)
  assert.equal(suggestDeckKind({}), null)
  // Il tipo vince sul nome: un ente del turismo con "porto" nel nome resta un ente del turismo.
  assert.equal(suggestDeckKind({ type_code: 'dmo', name: 'Visit Porto' })?.kind, 'destination')
})

test('ogni tipo di ente ha una base: aggiungerne uno a TOURISM_TYPES obbliga a decidere', () => {
  const assigned = [...DESTINATION_ENTITY_TYPES, ...DISTRIBUTION_ENTITY_TYPES] as string[]
  assert.equal(new Set(assigned).size, assigned.length, 'un tipo non può stare in tutte e due')
  for (const code of Object.keys(TOURISM_TYPES)) {
    if (code !== 'other') assert.ok(assigned.includes(code), `tipo senza base: ${code}`)
  }
  for (const code of assigned) assert.ok(code in TOURISM_TYPES, `tipo inesistente: ${code}`)
})

test('i segnaposto si riempiono e ciò che manca resta da verificare', () => {
  const slides = applyVars(DEFAULT_DECK_TEMPLATE, { destinazione: 'Capri', ente: 'Capri Tourism' })
  assert.equal(slides[0].title, 'La mappa perfetta per Capri Tourism')
  assert.equal(slides[1].title, 'Tutto Capri in una mappa sola')
  // Condizioni e contatto non sono stati dati: restano quelle del modello, il contatto da verificare.
  const byId = (id: string) => slides.find((s) => s.id === id)!
  assert.match(byId('prezzo').note, /^In cambio: distribuite le guide Speaqi sui canali concordati/)
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
