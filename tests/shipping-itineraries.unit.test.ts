import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { effectivePortFlags } from '../src/lib/shipping-companies'
import {
  buildPortIndex,
  CORE_PORTS,
  countryCode,
  itineraryToText,
  newPortFromStop,
  parseDepartureDates,
  parseItineraryText,
  resolvePort,
} from '../src/lib/shipping-itineraries'

const index = buildPortIndex(CORE_PORTS.map((port, position) => ({ ...port, id: `p${position}` })))
const slugOf = (stop: { name: string; alt: string | null }) => resolvePort(index, stop)?.slug ?? null

describe('parseItineraryText', () => {
  test('formato con giorno, paese, ruolo e orari; la navigazione fa avanzare il giorno', () => {
    const { stops, seaDays, ignored } = parseItineraryText(`Giorno 1 · Genova, Italia (imbarco) 17:00
2 Napoli 13:00 - 19:00
Navigazione
4 La Valletta, Malta 08:00 18:00
5 Marsiglia, Francia 09:00 17:00
6 Genova (sbarco) 08:00`)
    assert.equal(seaDays, 1)
    assert.deepEqual(ignored, [])
    assert.deepEqual(
      stops.map((stop) => [stop.day, slugOf(stop), stop.role, stop.arrival, stop.departure]),
      [
        [1, 'genova', 'embark', null, '17:00'],
        [2, 'napoli', 'call', '13:00', '19:00'],
        [4, 'la-valletta', 'call', '08:00', '18:00'],
        [5, 'marsiglia', 'call', '09:00', '17:00'],
        [6, 'genova', 'disembark', '08:00', null],
      ]
    )
    assert.equal(stops[0].country, 'IT')
    assert.equal(stops[2].country, 'MT')
  })

  test('i nomi di citta non vengono scambiati per date (Marsiglia, Genova)', () => {
    const { stops } = parseItineraryText('8 Marsiglia 09:00 17:00\n9 Genova 08:00')
    assert.deepEqual(stops.map((stop) => [stop.day, stop.name]), [[8, 'Marsiglia'], [9, 'Genova']])
  })

  test('date e giorni della settimana davanti al porto vengono saltati', () => {
    const { stops, seaDays } = parseItineraryText(`Sab 13 giu Roma (Civitavecchia) 18:00
Dom 14 giu Naples, Italy 13:00 20:00
Lun 15 giu At sea
13.06 Palermo 08:00 17:00`)
    assert.equal(seaDays, 1)
    assert.deepEqual(stops.map(slugOf), ['civitavecchia', 'napoli', 'palermo'])
    assert.deepEqual(stops.map((stop) => stop.day), [1, 2, 4])
  })

  test('orari AM/PM e porto fra parentesi', () => {
    const { stops } = parseItineraryText(`Day 1: Civitavecchia (Rome), Italy — Depart 5:00 PM
Day 2: Naples (Pompeii), Italy 7.00 18.00
Day 3: Florence/Pisa (La Spezia) 07:00 19:00
Day 4 Kotor (Montenegro) 08:00 12:30 AM`)
    assert.deepEqual(stops.map(slugOf), ['civitavecchia', 'napoli', 'la-spezia', 'kotor'])
    assert.equal(stops[0].departure, '17:00')
    assert.equal(stops[0].country, 'IT')
    assert.equal(stops[3].country, 'ME')
    assert.equal(stops[3].departure, '00:30')
  })

  test('pernottamento e imbarco/sbarco nello stesso porto', () => {
    const { stops } = parseItineraryText('1 Venezia (imbarco e sbarco) (pernottamento) 16:00')
    assert.equal(stops[0].role, 'turnaround')
    assert.equal(stops[0].overnight, true)
  })

  test('righe vuote e intestazioni non diventano tappe', () => {
    const { stops } = parseItineraryText('Giorno Porto Arrivo Partenza\n\n  \n1 Bari 08:00')
    assert.equal(stops.length, 1)
  })
})

describe('porti', () => {
  test('un porto sconosciuto viene proposto come nuovo, con il nome letto', () => {
    const [stop] = parseItineraryText('3 Tórshavn (Isole Faroe) 08:00 17:00').stops
    assert.equal(resolvePort(index, stop), null)
    const draft = newPortFromStop(stop)
    assert.equal(draft.name, 'Tórshavn')
    assert.equal(draft.slug, 'torshavn')
    assert.deepEqual(draft.aliases, ['Tórshavn (Isole Faroe)'])
  })

  test('alias e UN/LOCODE portano allo stesso porto', () => {
    assert.equal(slugOf({ name: 'ITNAP', alt: null }), 'napoli')
    assert.equal(slugOf({ name: 'Athens', alt: 'Piraeus' }), 'pireo')
    assert.equal(slugOf({ name: 'Malta', alt: null }), 'la-valletta')
  })

  test('paesi in italiano, inglese e come codice', () => {
    assert.equal(countryCode('Italia'), 'IT')
    assert.equal(countryCode('Spain'), 'ES')
    assert.equal(countryCode('gr'), 'GR')
    assert.equal(countryCode('Atlantide'), null)
  })

  test('i porti di base hanno slug unici', () => {
    const slugs = CORE_PORTS.map((port) => port.slug)
    assert.equal(new Set(slugs).size, slugs.length)
  })
})

describe('itineraryToText', () => {
  test('le tappe salvate si rileggono uguali', () => {
    const { stops } = parseItineraryText('1 Genova 17:00\n2 Napoli 13:00 19:00\n4 Palermo (pernottamento) 08:00\n5 Genova 08:00')
    const saved = stops.map((stop) => ({ ...stop, port: { id: '', slug: '', name: resolvePort(index, stop)!.name, country: null } }))
    const again = parseItineraryText(itineraryToText(saved)).stops
    assert.deepEqual(
      again.map((stop) => [stop.day, slugOf(stop), stop.role, stop.arrival, stop.departure, stop.overnight]),
      saved.map((stop) => [stop.day, slugOf(stop), stop.role, stop.arrival, stop.departure, stop.overnight])
    )
  })
})

describe('parseDepartureDates', () => {
  test('formati italiani e ISO, ordinati e senza doppioni', () => {
    assert.deepEqual(parseDepartureDates('20/06/2026, 2026-06-13; 13/6/26').dates, ['2026-06-13', '2026-06-20'])
  })

  test('date impossibili vengono segnalate, non corrette', () => {
    assert.deepEqual(parseDepartureDates('31/02/2026 domani').invalid, ['31/02/2026', 'domani'])
  })
})

describe('effectivePortFlags', () => {
  test('un itinerario che tocca Napoli accende il flag anche se il catalogo diceva no', () => {
    const company = effectivePortFlags({ calls_naples: false, calls_civitavecchia: null, itinerary_ports: ['napoli', 'palermo'] })
    assert.equal(company.calls_naples, true)
    assert.equal(company.calls_civitavecchia, null)
  })
})
