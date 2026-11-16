import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryKeywords, categorySearchFilters, LEADOCEAN_CATEGORIES } from '../src/lib/leadocean-categories'

test('i filtri combinano categorie e sinonimi senza duplicati', () => {
  const terms = categoryKeywords(['tour-operator', 'ferry', 'tour-operator'])
  assert.ok(terms.includes('tour operator'))
  assert.ok(terms.includes('ferry operator'))
  assert.equal(new Set(terms).size, terms.length)
  assert.equal(new Set(LEADOCEAN_CATEGORIES.map(category => category.id)).size, LEADOCEAN_CATEGORIES.length)
  assert.ok(LEADOCEAN_CATEGORIES.length >= 30)
})

test('le persone sono filtrate per attività del datore di lavoro e profilo', () => {
  assert.deepEqual(categorySearchFilters('people', 'marketing', ['tourism-consortium']), {
    q: 'marketing', companyKeywords: ['tourism consortium', 'tourist consortium', 'consorzio turistico'],
  })
})

test('per le aziende la ricerca libera è alternativa alle categorie', () => {
  assert.deepEqual(categorySearchFilters('companies', 'tour operator', ['tour-operator']), {
    keywords: ['tour operator', 'tour organizer', 'tour organiser'],
  })
  assert.deepEqual(categorySearchFilters('companies', '', []), {})
})
