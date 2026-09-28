import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  comparePorts,
  formatPassengers,
  guideChoiceOf,
  guideChoicePatch,
  normalizePortWorldPatch,
  portsToCsv,
  summarizeGuides,
} from '../src/lib/shipping-ports'

const port = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  country: 'IT',
  company_ids: [] as string[],
  itinerary_count: 0,
  ...extra,
})

describe('classifica dei porti', () => {
  test('passeggeri prima; chi non ha statistica va dopo, ordinato per compagnie', () => {
    const ports = [
      port('Salerno', { company_ids: ['a', 'b', 'c'] }),
      port('Napoli', { cruise_passengers: 1_900_000, company_ids: ['a'] }),
      port('Civitavecchia', { cruise_passengers: 3_600_000 }),
      port('Amalfi', { company_ids: ['a'] }),
      port('Zero', { cruise_passengers: 0 }),
    ]
    assert.deepEqual(ports.sort(comparePorts('passengers')).map((p) => p.name), ['Civitavecchia', 'Napoli', 'Zero', 'Salerno', 'Amalfi'])
  })

  test('a parità si scende su itinerari e poi nome, così l’ordine non balla', () => {
    const ports = [port('B', { company_ids: ['x'] }), port('A', { company_ids: ['x'] }), port('C', { company_ids: ['x'], itinerary_count: 2 })]
    assert.deepEqual(ports.sort(comparePorts('companies')).map((p) => p.name), ['C', 'A', 'B'])
  })

  test('numeri leggibili', () => {
    assert.equal(formatPassengers(3_600_000), '3,6 mln')
    assert.equal(formatPassengers(850_400), '850 mila')
    assert.equal(formatPassengers(4200), '4200')
    assert.equal(formatPassengers(null), null)
  })

  test('riepilogo: i crocieristi coperti sono quelli dei porti con la guida pubblicata', () => {
    const summary = summarizeGuides([
      port('Roma', { cruise_passengers: 3_000_000, guide_status: 'live' }),
      port('Napoli', { cruise_passengers: 1_000_000, guide_status: 'in_progress' }),
      port('Amalfi'),
    ])
    assert.equal(summary.total, 3)
    assert.equal(summary.passengers, 4_000_000)
    assert.equal(summary.covered, 3_000_000)
    assert.equal(summary.byStatus.none, 1)
    assert.equal(summary.byStatus.live, 1)
  })
})

describe('normalizePortWorldPatch', () => {
  test('tocca solo i campi presenti', () => {
    assert.deepEqual(normalizePortWorldPatch({ guide_status: 'planned' }), { patch: { guide_status: 'planned' } })
    assert.deepEqual(normalizePortWorldPatch({ cruise_calls: '12' }), { patch: { cruise_calls: 12 } })
  })

  test('numeri scritti all’italiana e campi svuotati', () => {
    const result = normalizePortWorldPatch({ cruise_passengers: '1.250.000', passengers_year: '2025', cruise_calls: '', region: 'Asia' })
    assert.deepEqual(result, { patch: { region: 'Asia', cruise_passengers: 1_250_000, passengers_year: 2025, cruise_calls: null } })
  })

  test('rifiuta regioni fuori elenco, stati inventati e passeggeri senza anno', () => {
    assert.ok('error' in normalizePortWorldPatch({ region: 'Atlantide' }))
    assert.ok('error' in normalizePortWorldPatch({ guide_status: 'forse' }))
    assert.ok('error' in normalizePortWorldPatch({ cruise_passengers: '-3' }))
    assert.ok('error' in normalizePortWorldPatch({ cruise_passengers: '5000', passengers_year: '' }))
    assert.ok('error' in normalizePortWorldPatch({ passengers_year: '1850' }))
  })
})

describe('priorità della superguida', () => {
  test('una guida pubblicata o scartata perde la priorità insieme al cambio di stato', () => {
    assert.deepEqual(normalizePortWorldPatch({ guide_status: 'live' }), { patch: { guide_status: 'live', guide_priority: null } })
    assert.ok('error' in normalizePortWorldPatch({ guide_status: 'skip', guide_priority: 1 }))
    assert.ok('error' in normalizePortWorldPatch({ guide_priority: 4 }))
    assert.deepEqual(normalizePortWorldPatch({ guide_priority: '' }), { patch: { guide_priority: null } })
  })

  test('la scelta sulla riga è stato + priorità; in lavorazione tiene la priorità che c’era', () => {
    assert.deepEqual(guideChoicePatch('planned:1'), { guide_status: 'planned', guide_priority: 1 })
    assert.deepEqual(guideChoicePatch('skip'), { guide_status: 'skip', guide_priority: null })
    assert.deepEqual(guideChoicePatch('in_progress'), { guide_status: 'in_progress' })
    assert.equal(guideChoicePatch('forse'), null)
    assert.equal(guideChoiceOf({ guide_status: 'planned', guide_priority: 3 }), 'planned:3')
    assert.equal(guideChoiceOf({ guide_status: 'skip', guide_priority: null }), 'skip')
  })

  test('ordine di lavoro: in corso, poi da fare per priorità e passeggeri, poi il resto; pubblicate e scartate in fondo', () => {
    const ports = [
      port('Canaveral', { guide_status: 'skip', cruise_passengers: 8_600_000 }),
      port('Napoli', { guide_status: 'live', cruise_passengers: 1_800_000 }),
      port('Sorrento', { guide_status: 'planned', guide_priority: 2 }),
      port('Barcellona', { guide_status: 'planned', guide_priority: 1, cruise_passengers: 4_000_000 }),
      port('Nassau', { guide_status: 'planned', guide_priority: 1, cruise_passengers: 6_000_000 }),
      port('Roma', { guide_status: 'in_progress', guide_priority: 1 }),
      port('Boh'),
    ]
    assert.deepEqual(ports.sort(comparePorts('guide')).map((p) => p.name), ['Roma', 'Nassau', 'Barcellona', 'Sorrento', 'Boh', 'Napoli', 'Canaveral'])
  })
})

describe('portsToCsv', () => {
  test('punto e virgola, BOM per Excel e celle con separatori tra virgolette', () => {
    const csv = portsToCsv([port('Roma; Civitavecchia', { destination: 'Roma', company_ids: ['a', 'b'], guide_status: 'planned' })], (id) =>
      id === 'a' ? 'MSC' : 'Costa'
    )
    assert.ok(csv.startsWith('﻿Porto;'))
    const row = csv.split('\r\n')[1]
    assert.ok(row.startsWith('"Roma; Civitavecchia";Roma;IT;'))
    assert.ok(row.includes(';Da fare;'))
    assert.ok(row.includes('Costa, MSC'))
  })
})

describe('posizione del porto', () => {
  test('latitudine e longitudine vanno insieme, arrotondate al milionesimo', () => {
    assert.deepEqual(normalizePortWorldPatch({ latitude: '40.83591234', longitude: 14.2488 }), {
      patch: { latitude: 40.835912, longitude: 14.2488 },
    })
    assert.deepEqual(normalizePortWorldPatch({ latitude: null, longitude: '' }), {
      patch: { latitude: null, longitude: null },
    })
  })

  test('una coordinata sola o fuori scala viene rifiutata', () => {
    assert.ok('error' in normalizePortWorldPatch({ latitude: 40.8 }))
    assert.ok('error' in normalizePortWorldPatch({ latitude: 95, longitude: 14 }))
  })

  test('una modifica che non parla di posizione non la tocca', () => {
    const result = normalizePortWorldPatch({ guide_status: 'live' })
    assert.ok('patch' in result && !('latitude' in result.patch))
  })
})
