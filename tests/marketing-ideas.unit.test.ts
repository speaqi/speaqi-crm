import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  IDEA_SEEDS,
  ideaScore,
  isSeedKey,
  mergeIdeas,
  normalizeIdeaPatch,
  normalizeNewIdea,
} from '../src/lib/marketing-ideas'

describe('idee di partenza', () => {
  test('ogni idea ha una chiave unica e i testi compilati', () => {
    const keys = IDEA_SEEDS.map((seed) => seed.key)
    assert.equal(new Set(keys).size, keys.length)
    for (const seed of IDEA_SEEDS) {
      assert.match(seed.key, /^[a-z0-9-]+$/)
      assert.ok(seed.title && seed.description && seed.nextAction, seed.key)
    }
  })

  test('parlano solo di guide e partner: niente vino, QR generici o lead', () => {
    for (const seed of IDEA_SEEDS) {
      assert.doesNotMatch(`${seed.title} ${seed.description}`, /\bvino\b|cantin|\bwine\b/i, seed.key)
    }
  })
})

describe('mergeIdeas', () => {
  test('senza righe: le idee da cui partire sono «Da validare», le altre «Backlog»', () => {
    const ideas = mergeIdeas([])
    assert.equal(ideas.length, IDEA_SEEDS.length)
    for (const idea of ideas) assert.equal(idea.status, idea.start ? 'Da validare' : 'Backlog')
    assert.ok(ideas.some((idea) => idea.start))
  })

  test('lo stato salvato vince sul predefinito', () => {
    const key = IDEA_SEEDS[0].key
    const [first] = mergeIdeas([{ idea_key: key, status: 'In corso', owner: 'Massimo', deadline: '2026-12-01', progress: 40, notes: 'ok' }])
    assert.equal(first.status, 'In corso')
    assert.equal(first.owner, 'Massimo')
    assert.equal(first.deadline, '2026-12-01')
    assert.equal(first.progress, 40)
  })

  test('uno stato sconosciuto nel database non rompe la pagina', () => {
    const key = IDEA_SEEDS[0].key
    const [first] = mergeIdeas([{ idea_key: key, status: 'boh', progress: 900 } as never])
    assert.ok(['Da validare', 'Backlog'].includes(first.status))
    assert.equal(first.progress, 100)
  })

  test('le idee scritte a mano si aggiungono, una riga di stato senza titolo no', () => {
    const ideas = mergeIdeas([
      { idea_key: 'custom-1', status: 'Pianificata', title: 'Una mia idea', category: 'Test', budget: '€5k+', description: 'd', next_action: 'n' },
      { idea_key: 'orfana', status: 'In corso' },
    ])
    assert.equal(ideas.length, IDEA_SEEDS.length + 1)
    const custom = ideas[ideas.length - 1]
    assert.equal(custom.custom, true)
    assert.equal(custom.title, 'Una mia idea')
    assert.equal(custom.status, 'Pianificata')
  })
})

describe('normalizeIdeaPatch', () => {
  test('accetta solo valori validi', () => {
    assert.deepEqual(normalizeIdeaPatch({ status: 'In corso' }), { patch: { status: 'In corso' } })
    assert.ok('error' in normalizeIdeaPatch({ status: 'Finita' }))
    assert.ok('error' in normalizeIdeaPatch({ deadline: '07/11/2026' }))
    assert.ok('error' in normalizeIdeaPatch({ deadline: '2026-02-31' }))
    assert.ok('error' in normalizeIdeaPatch({ progress: 120 }))
    assert.ok('error' in normalizeIdeaPatch({ owner: 'x'.repeat(81) }))
  })

  test('una scadenza vuota la toglie, un campo assente non si tocca', () => {
    assert.deepEqual(normalizeIdeaPatch({ deadline: '' }), { patch: { deadline: null } })
    assert.deepEqual(normalizeIdeaPatch({}), { patch: {} })
  })

  test('«Completata» porta l’avanzamento a 100, salvo che lo si dica', () => {
    assert.deepEqual(normalizeIdeaPatch({ status: 'Completata' }), { patch: { status: 'Completata', progress: 100 } })
    assert.deepEqual(normalizeIdeaPatch({ status: 'Completata', progress: 80 }), { patch: { status: 'Completata', progress: 80 } })
  })
})

describe('normalizeNewIdea e punteggio', () => {
  test('serve un titolo, il resto ha un valore di ripiego', () => {
    assert.ok('error' in normalizeNewIdea({ title: '  ' }))
    const parsed = normalizeNewIdea({ title: ' Nuova ' })
    assert.ok('idea' in parsed)
    if ('idea' in parsed) {
      assert.equal(parsed.idea.title, 'Nuova')
      assert.equal(parsed.idea.budget, '< €500')
      assert.equal(parsed.idea.category, 'Altro')
    }
    assert.ok('error' in normalizeNewIdea({ title: 'x', budget: '1 milione' }))
  })

  test('il punteggio premia ciò che porta a un accordo ed è facile da fare', () => {
    assert.ok(ideaScore({ category: 'Prodotto', budget: '< €500' }) > ideaScore({ category: 'Contenuti', budget: '< €500' }))
    assert.ok(ideaScore({ category: 'Prodotto', budget: '< €500' }) > ideaScore({ category: 'Prodotto', budget: '€5k+' }))
  })

  test('isSeedKey riconosce solo le idee di partenza', () => {
    assert.equal(isSeedKey(IDEA_SEEDS[0].key), true)
    assert.equal(isSeedKey('custom-123'), false)
  })
})
