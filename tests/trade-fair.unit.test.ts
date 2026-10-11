import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  compareExhibitors,
  effectivePriority,
  FairExhibitor,
  filterExhibitors,
  followupState,
  parseExhibitorsText,
  scoreExhibitor,
  slugifyExhibitor,
  summarize,
} from '../src/lib/trade-fair'

const NOW = new Date(2026, 9, 11, 10, 0, 0)

function row(partial: Partial<FairExhibitor> & { id: string }): FairExhibitor {
  return {
    fair: 'ttg-2026', slug: partial.id, name: partial.id, stand: null, hall: null, country: null, city: null,
    category: null, description: null, website: null, email: null, phone: null, source_url: null,
    score: 0, score_reasons: [], priority: null, status: 'new', contacted_at: null, next_followup_at: null,
    notes: [], contact_id: null, created_at: '', updated_at: '', ...partial,
  }
}

describe('scoreExhibitor', () => {
  test('un ente del turismo vale piu\' di una compagnia aerea', () => {
    const ente = scoreExhibitor({ name: 'Regione Campania', category: 'Ente del turismo' })
    const aerea = scoreExhibitor({ name: 'SkyFly', category: 'Compagnia aerea' })
    assert.ok(ente.score >= 40)
    assert.ok(aerea.score < ente.score)
    assert.ok(ente.reasons.includes('Destinazione / ente del turismo'))
  })
  test('il punteggio resta fra 0 e 100', () => {
    const big = scoreExhibitor({ name: 'Museo crociere hotel tour regione', email: 'a@b.it', website: 'https://x.it' })
    assert.ok(big.score <= 100 && big.score >= 0)
    assert.equal(scoreExhibitor({ name: 'Software gestionale', category: 'airline software' }).score, 0)
  })
})

describe('priorita', () => {
  test('la scelta a mano vince sul punteggio', () => {
    assert.equal(effectivePriority({ priority: 3, score: 90 }), 3)
    assert.equal(effectivePriority({ priority: null, score: 60 }), 1)
    assert.equal(effectivePriority({ priority: null, score: 35 }), 2)
    assert.equal(effectivePriority({ priority: null, score: 5 }), 3)
  })
})

describe('follow-up e ordinamento', () => {
  test('uno scaduto passa davanti a una priorita\' alta', () => {
    const scaduto = row({ id: 'a', status: 'contacted', next_followup_at: '2026-10-01', score: 5 })
    const alta = row({ id: 'b', score: 90 })
    assert.equal(followupState(scaduto, NOW), 'overdue')
    assert.deepEqual([alta, scaduto].sort((x, y) => compareExhibitors(x, y, NOW)).map((r) => r.id), ['a', 'b'])
  })
  test('chiuso o senza data non e\' un follow-up', () => {
    assert.equal(followupState(row({ id: 'c', status: 'not_interested', next_followup_at: '2026-01-01' }), NOW), 'none')
    assert.equal(followupState(row({ id: 'd', next_followup_at: '2026-10-11' }), NOW), 'today')
  })
  test('filtri e riepilogo', () => {
    const rows = [
      row({ id: 'x', name: 'Hotel Sole', status: 'new', score: 60, email: 'a@b.it' }),
      row({ id: 'y', name: 'Museo', status: 'contacted', next_followup_at: '2026-10-05' }),
      row({ id: 'z', name: 'Airline', status: 'not_interested' }),
    ]
    assert.equal(filterExhibitors(rows, { search: 'sòle' }, NOW).length, 1)
    assert.equal(filterExhibitors(rows, { search: 'luna' }, NOW).length, 0)
    assert.equal(filterExhibitors(rows, { search: 'sole' }, NOW).length, 1)
    assert.equal(filterExhibitors(rows, { status: 'open' }, NOW).length, 2)
    assert.equal(filterExhibitors(rows, { onlyFollowup: true }, NOW)[0].id, 'y')
    assert.deepEqual(summarize(rows, NOW), { total: 3, toContact: 1, highToContact: 1, contacted: 1, overdue: 1, interested: 0 })
  })
})

describe('import da testo', () => {
  test('CSV con intestazione, alias, virgolette e doppioni', () => {
    const { items, skipped } = parseExhibitorsText(
      'Espositore;Padiglione;Stand;Paese;Sito\n"Hotel ""Sole"""; 3 ;B12;Italia;www.hotelsole.it\nhotel sole;;;;\n;;;;'
    )
    assert.equal(items.length, 1)
    assert.equal(skipped, 1)
    assert.equal(items[0].name, 'Hotel "Sole"')
    assert.equal(items[0].hall, '3')
    assert.equal(items[0].website, 'https://www.hotelsole.it')
  })
  test('senza intestazione ogni riga e\' un nome; TSV da Excel', () => {
    assert.deepEqual(parseExhibitorsText('Alpha\nBeta').items.map((i) => i.name), ['Alpha', 'Beta'])
    assert.equal(parseExhibitorsText('nome\tcategoria\nAlpha\tMusei').items[0].category, 'Musei')
  })
  test('slug', () => {
    assert.equal(slugifyExhibitor('Città & Borghi S.r.l.'), 'citta-e-borghi-s-r-l')
  })
})
