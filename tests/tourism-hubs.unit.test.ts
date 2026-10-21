import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  airportsFromOurAirports,
  dedupeHubs,
  distanceKm,
  hubImportSql,
  hubSlug,
  normalizeHub,
  summarizeHubs,
} from '../src/lib/tourism-hubs'

const ROW = {
  ident: 'LIRN',
  type: 'large_airport',
  name: 'Naples International Airport',
  latitude_deg: '40.886002',
  longitude_deg: '14.2908',
  continent: 'EU',
  iso_country: 'IT',
  iso_region: 'IT-72',
  municipality: 'Napoli',
  scheduled_service: 'yes',
  icao_code: 'LIRN',
  iata_code: 'NAP',
  gps_code: 'LIRN',
  wikipedia_link: 'https://en.wikipedia.org/wiki/Naples_International_Airport',
  keywords: 'Capodichino, Ugo Niutta, NAP',
}

test('slug come quello dei porti, senza trattino finale', () => {
  assert.equal(hubSlug('Roma Termini'), 'roma-termini')
  assert.equal(hubSlug('Tromsø Lufthavn'), 'tromso-lufthavn')
  assert.ok(!hubSlug('a '.repeat(60)).endsWith('-'))
})

test("un aeroporto grande con voli di linea entra, con citta' e codici", () => {
  const { hubs } = airportsFromOurAirports([ROW])
  assert.equal(hubs.length, 1)
  const [nap] = hubs
  assert.equal(nap.slug, 'nap')
  assert.equal(nap.iata, 'NAP')
  assert.equal(nap.icao, 'LIRN')
  assert.equal(nap.size, 'large')
  assert.equal(nap.region, 'Europa')
  assert.equal(nap.destination, 'Napoli')
  assert.deepEqual(nap.aliases, ['Capodichino', 'Ugo Niutta', 'NAP'])
  assert.equal(nap.external_ids.ourairports, 'LIRN')
})

test('eliporti, piste senza voli di linea, chiusi e senza IATA restano fuori con il motivo', () => {
  const { hubs, skipped } = airportsFromOurAirports([
    { ...ROW, type: 'heliport' },
    { ...ROW, type: 'small_airport' },
    { ...ROW, type: 'closed' },
    { ...ROW, scheduled_service: 'no' },
    { ...ROW, iata_code: '' },
  ])
  assert.equal(hubs.length, 0)
  assert.deepEqual(skipped, { 'non grande o medio': 2, chiuso: 1, 'senza voli di linea': 1, 'senza codice IATA': 1 })
})

test("la citta' servita e' quella prima della parentesi", () => {
  const { hubs } = airportsFromOurAirports([{ ...ROW, iata_code: 'CDG', municipality: "Paris (Roissy-en-France, Val-d'Oise)" }])
  assert.equal(hubs[0].destination, 'Paris')
})

test('un numero senza anno non entra, e nemmeno la sua fonte', () => {
  const hub = normalizeHub({ mode: 'sea', name: 'Napoli', passengers: 1600000, stats_source: 'x' })
  assert.equal(hub.passengers, null)
  assert.equal(hub.stats_source, null)
  const dated = normalizeHub({ mode: 'sea', name: 'Napoli', passengers: 1600000, passengers_year: 2025, stats_source: 'https://adsp.it', intl_share: 140 })
  assert.equal(dated.passengers, 1600000)
  assert.equal(dated.intl_share, null)
})

test('coordinate a meta e codici storti si scartano, il tipo sconosciuto no', () => {
  const hub = normalizeHub({ mode: 'rail', name: 'Roma Termini', latitude: 41.9, longitude: 'x', uic: '83-0', country: 'italia' })
  assert.equal(hub.latitude, null)
  assert.equal(hub.uic, null)
  assert.equal(hub.country, null)
  assert.throws(() => normalizeHub({ mode: 'bus', name: 'X' }), /sconosciuto/)
  assert.throws(() => normalizeHub({ mode: 'air', name: '  ' }), /senza nome/)
})

test('doppioni per codice si fondono, slug uguali di hub diversi si distinguono', () => {
  const a = normalizeHub({ mode: 'air', name: 'Santa Cruz', iata: 'SRZ', country: 'BO' })
  const b = normalizeHub({ mode: 'air', name: 'Santa Cruz', iata: 'SPC', country: 'ES' })
  const c = normalizeHub({ mode: 'air', name: 'Santa Cruz Viru Viru', slug: 'other', iata: 'SRZ' })
  const { hubs, duplicates } = dedupeHubs([a, b, c])
  assert.equal(hubs.length, 2)
  assert.equal(duplicates.length, 1)
  assert.deepEqual(hubs.map((hub) => hub.slug), ['santa-cruz', 'santa-cruz-spc'])
})

test('distanza Napoli Capodichino → porto di Napoli: pochi chilometri', () => {
  const km = distanceKm({ latitude: 40.886, longitude: 14.2908 }, { latitude: 40.84, longitude: 14.25 })
  assert.ok(km > 4 && km < 8, String(km))
})

test("il blocco SQL fissa il proprietario e rifiuta cio' che il database rifiuterebbe", () => {
  const hub = normalizeHub({ mode: 'air', name: "L'Aquila", iata: 'QAQ' })
  const sql = hubImportSql([hub], '11111111-1111-4111-8111-111111111111')
  assert.match(sql, /set_config\('request\.jwt\.claim\.sub','11111111-1111-4111-8111-111111111111',true\)/)
  assert.match(sql, /L''Aquila/)
  assert.throws(() => hubImportSql([hub], "x'; drop table x;--"), /Proprietario/)
  assert.throws(() => hubImportSql([], '11111111-1111-4111-8111-111111111111'), /da 1 a 500/)
})

test('il catalogo aeroporti versionato e valido e senza codici doppi', () => {
  const catalog = JSON.parse(readFileSync(new URL('../scripts/data/tourism-airports.json', import.meta.url), 'utf8'))
  const hubs = catalog.hubs.map((row: Record<string, unknown>) => normalizeHub(row))
  const summary = summarizeHubs(hubs)
  assert.ok(summary.total > 3000, String(summary.total))
  assert.equal(summary.with_coordinates, summary.total)
  for (const key of ['iata', 'icao', 'slug'] as const) {
    const values = hubs.map((hub: Record<string, string | null>) => hub[key]).filter(Boolean)
    assert.equal(new Set(values).size, values.length, `${key} doppi`)
  }
  for (const iata of ['NAP', 'FCO', 'CIA', 'MXP', 'VCE', 'JFK', 'NRT', 'BCN']) {
    assert.ok(hubs.some((hub: { iata: string }) => hub.iata === iata), `manca ${iata}`)
  }
})
