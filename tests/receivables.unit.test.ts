import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  normalizeReceivableName,
  parseReceivableAmount,
  Receivable,
  sortReceivables,
  summarizeReceivables,
} from '../src/lib/receivables'

function row(partial: Partial<Receivable> & { id: string }): Receivable {
  return {
    name: 'x',
    amount: 1,
    collected_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...partial,
  }
}

describe('parseReceivableAmount', () => {
  test('legge gli importi scritti all\'italiana', () => {
    assert.equal(parseReceivableAmount('1.250,50'), 1250.5)
    assert.equal(parseReceivableAmount('1250,5'), 1250.5)
    assert.equal(parseReceivableAmount('€ 300'), 300)
    assert.equal(parseReceivableAmount('300 €'), 300)
    assert.equal(parseReceivableAmount('1.250'), 1250)
    assert.equal(parseReceivableAmount('1.000.000'), 1000000)
  })

  test('legge anche il punto decimale e il formato inglese', () => {
    assert.equal(parseReceivableAmount('12.5'), 12.5)
    assert.equal(parseReceivableAmount('12.50'), 12.5)
    assert.equal(parseReceivableAmount('1,250.50'), 1250.5)
    assert.equal(parseReceivableAmount(99.999), 100)
  })

  test('rifiuta tutto cio che non e un importo positivo', () => {
    for (const value of ['', 'abc', '0', '0,00', '-5', '1,2,3', '12a', null, undefined, -3, Number.NaN]) {
      assert.equal(parseReceivableAmount(value), null, String(value))
    }
  })
})

test('normalizeReceivableName compatta gli spazi e taglia a 120', () => {
  assert.equal(normalizeReceivableName('  Mario   Rossi \n'), 'Mario Rossi')
  assert.equal(normalizeReceivableName('a'.repeat(200)).length, 120)
  assert.equal(normalizeReceivableName(undefined), '')
})

test('summarizeReceivables somma in centesimi, separando incassati e no', () => {
  const summary = summarizeReceivables([
    row({ id: '1', amount: 0.1 }),
    row({ id: '2', amount: 0.2 }),
    row({ id: '3', amount: 500, collected_at: '2026-09-10T00:00:00Z' }),
  ])
  assert.deepEqual(summary, { pending: 0.3, collected: 500, pendingCount: 2, collectedCount: 1 })
})

test('sortReceivables: da incassare dal piu vecchio, incassati dal piu recente', () => {
  const { pending, collected } = sortReceivables([
    row({ id: 'b', created_at: '2026-09-05T00:00:00Z' }),
    row({ id: 'a', created_at: '2026-09-02T00:00:00Z' }),
    row({ id: 'c', collected_at: '2026-09-03T00:00:00Z' }),
    row({ id: 'd', collected_at: '2026-09-20T00:00:00Z' }),
  ])
  assert.deepEqual(pending.map((item) => item.id), ['a', 'b'])
  assert.deepEqual(collected.map((item) => item.id), ['d', 'c'])
})
