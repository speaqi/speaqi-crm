import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DECK_TEMPLATE, deckLanguage, normalizeTemplate } from '../src/lib/tourism-deck'
import { DEFAULT_DECK_TEMPLATE_EN, DESTINATIONS_BASE_EN, EN_SLIDE_TEXT } from '../src/lib/tourism-deck-en'
import { DECK_ENGLISH_RULE, buildAgentRequest } from '../src/lib/server/tourism-deck-agent'

test('la base inglese ha le stesse slide della italiana: stessi id, tipi, immagini e icone', () => {
  const it = DEFAULT_DECK_TEMPLATE.slides
  const en = DEFAULT_DECK_TEMPLATE_EN.slides
  assert.equal(DEFAULT_DECK_TEMPLATE_EN.base, DESTINATIONS_BASE_EN)
  assert.deepEqual(en.map((s) => [s.id, s.kind, s.tone, s.art, s.qr, s.fixed]), it.map((s) => [s.id, s.kind, s.tone, s.art, s.qr, s.fixed]))
  for (const [i, slide] of it.entries()) {
    assert.equal(en[i].items.length, slide.items.length, `voci di ${slide.id}`)
    assert.deepEqual(en[i].items.map((x) => [x.icon, x.highlight, x.art]), slide.items.map((x) => [x.icon, x.highlight, x.art]), `icone di ${slide.id}`)
  }
  // Ogni slide con parole nella base italiana ha il suo testo inglese, e non resta italiano.
  for (const slide of it) if (slide.title) assert.ok(EN_SLIDE_TEXT[slide.id], `manca l'inglese di ${slide.id}`)
  assert.equal(normalizeTemplate(DEFAULT_DECK_TEMPLATE_EN).slides.length, it.length)
})

test('i segnaposto restano dove stavano e le parole italiane non restano', () => {
  const all = (t: typeof DEFAULT_DECK_TEMPLATE) => t.slides.flatMap((s) => [s.title, s.kicker, s.body, s.note, s.footnote, ...s.items.flatMap((i) => [i.title, i.text, i.value])].filter(Boolean) as string[])
  const placeholders = (t: typeof DEFAULT_DECK_TEMPLATE) => all(t).join('\n').match(/\{\{\w+\}\}/g)
  assert.deepEqual(placeholders(DEFAULT_DECK_TEMPLATE_EN), placeholders(DEFAULT_DECK_TEMPLATE))
  const text = all(DEFAULT_DECK_TEMPLATE_EN).join('\n')
  for (const word of ['Il tuo', 'mappa digitale', 'visitatori', 'gratuita', 'Domande', 'destinazione.', 'Candida']) assert.ok(!text.includes(word), `resta italiano: ${word}`)
})

test('la lingua di un deck: inglese solo se lo dice l’input', () => {
  assert.equal(deckLanguage({ lingua: 'en' }), 'en')
  assert.equal(deckLanguage({}), 'it')
  assert.equal(deckLanguage(null), 'it')
  assert.equal(deckLanguage({ lingua: 'fr' as never }), 'it')
})

test('l’agente scrive in inglese solo per un deck inglese', () => {
  const args = (lingua?: 'en') => ({ template: DEFAULT_DECK_TEMPLATE_EN, input: { destinazione: 'Sibiu', ente: 'Sibiu County Tourism Association', ...(lingua ? { lingua } : {}) }, notes: '', materials: { documents: [], photos: [] } })
  const english = JSON.stringify(buildAgentRequest(args('en'), 'm').input[0])
  const italian = JSON.stringify(buildAgentRequest(args(), 'm').input[0])
  assert.ok(english.includes('INGLESE') && english.includes(JSON.stringify(DECK_ENGLISH_RULE).slice(1, 40)))
  assert.ok(!italian.includes('INGLESE'))
})
