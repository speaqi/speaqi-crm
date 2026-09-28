import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  itineraryPoints,
  legArc,
  legArrow,
  mercatorY,
  parseCoordinates,
  routeColor,
  routeLegs,
  shipKey,
  shipsOf,
  unwrapLng,
  validLatLng,
} from '../src/lib/shipping-routes'

const NAPOLI = { id: 'p-nap', slug: 'napoli', name: 'Napoli', country: 'IT', latitude: 40.8359, longitude: 14.2488 }
const PALERMO = { id: 'p-pmo', slug: 'palermo', name: 'Palermo', country: 'IT', latitude: '38.1256', longitude: '13.3611' }
const DUBAI = { id: 'p-dxb', slug: 'dubai', name: 'Dubai', country: 'AE', latitude: 25.27, longitude: 55.29 }
const NOWHERE = { id: 'p-x', slug: 'x', name: 'Porto senza posizione', country: null, latitude: null, longitude: null }

function stop(position: number, port: any, extra: Record<string, unknown> = {}) {
  return {
    position,
    day: position,
    port_id: port.id,
    role: 'call' as const,
    arrival: null,
    departure: null,
    overnight: false,
    notes: null,
    port,
    ...extra,
  }
}

describe('itineraryPoints', () => {
  test('legge anche le coordinate che arrivano come stringhe e ordina per posizione', () => {
    const { points, missing } = itineraryPoints({ stops: [stop(2, PALERMO), stop(1, NAPOLI)] as any })
    assert.deepEqual(points.map((point) => point.name), ['Napoli', 'Palermo'])
    assert.equal(points[1].lat, 38.1256)
    assert.deepEqual(missing, [])
  })

  test('un porto senza coordinate resta fuori dal disegno ma viene detto, una volta sola', () => {
    const { points, missing } = itineraryPoints({
      stops: [stop(1, NAPOLI), stop(2, NOWHERE), stop(3, PALERMO), stop(4, NOWHERE)] as any,
    })
    assert.equal(points.length, 2)
    assert.deepEqual(missing, [{ port_id: 'p-x', name: 'Porto senza posizione' }])
  })
})

describe('routeLegs', () => {
  test('una tratta per ogni coppia di tappe consecutive', () => {
    const { points } = itineraryPoints({ stops: [stop(1, NAPOLI), stop(2, PALERMO), stop(3, NAPOLI)] as any })
    const legs = routeLegs(points)
    assert.deepEqual(legs.map((leg) => `${leg.from.name}>${leg.to.name}`), ['Napoli>Palermo', 'Palermo>Napoli'])
  })

  test('due tappe di fila nello stesso porto sono una sosta, non una freccia', () => {
    const { points } = itineraryPoints({ stops: [stop(1, NAPOLI), stop(2, DUBAI), stop(3, DUBAI), stop(4, NAPOLI)] as any })
    assert.equal(routeLegs(points).length, 2)
  })
})

describe('geometria', () => {
  test("l'arco parte e arriva sui due porti", () => {
    const arc = legArc({ lat: 40.8, lng: 14.2 }, { lat: 38.1, lng: 13.4 })
    assert.equal(arc.length, 25)
    assert.ok(Math.abs(arc[0].lat - 40.8) < 1e-6 && Math.abs(arc[0].lng - 14.2) < 1e-6)
    assert.ok(Math.abs(arc[24].lat - 38.1) < 1e-6 && Math.abs(arc[24].lng - 13.4) < 1e-6)
  })

  test('andata e ritorno si piegano da parti opposte', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 0, lng: 10 }
    const out = legArc(a, b)[12]
    const back = legArc(b, a)[12]
    assert.ok(out.lat > 0, 'verso est, arco a nord (sinistra del verso di marcia)')
    assert.ok(back.lat < 0, 'verso ovest, arco a sud')
  })

  test("la strada corta passa per l'antimeridiano", () => {
    assert.equal(unwrapLng(170, -170), 190)
    assert.equal(unwrapLng(-170, 170), -190)
    assert.equal(unwrapLng(14, 13), 13)
    const arc = legArc({ lat: 21.3, lng: -157.9 }, { lat: 35.4, lng: 139.6 })
    assert.ok(arc.every((point) => point.lng <= -157.9 && point.lng >= -220.4), 'resta nel Pacifico')
  })

  test('la freccia punta nel verso della tratta, in gradi a schermo', () => {
    const east = legArrow(legArc({ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, 0))
    assert.ok(Math.abs(east.angle) < 1)
    const north = legArrow(legArc({ lat: 0, lng: 0 }, { lat: 10, lng: 0 }, 0))
    assert.ok(Math.abs(north.angle + 90) < 1)
    const west = legArrow(legArc({ lat: 0, lng: 10 }, { lat: 0, lng: 0 }, 0))
    assert.ok(Math.abs(Math.abs(west.angle) - 180) < 1)
  })

  test("Mercatore: zero all'equatore, cresce verso i poli e non esplode", () => {
    assert.ok(Math.abs(mercatorY(0)) < 1e-9)
    assert.ok(mercatorY(60) > 60)
    assert.ok(Number.isFinite(mercatorY(90)))
  })
})

describe('navi', () => {
  test('lo stesso nome scritto in modi diversi e la stessa nave', () => {
    assert.equal(shipKey('MSC World Europa'), shipKey(' msc  world-europa '))
    assert.equal(shipKey(null), '')
  })

  test('una riga per nave e compagnia, con i suoi itinerari', () => {
    const company = { id: 'c-msc', name: 'MSC Crociere', slug: 'msc' }
    const ships = shipsOf([
      { id: 'i1', ship: 'MSC Magnifica', company_id: 'c-msc', company },
      { id: 'i2', ship: 'msc magnifica', company_id: 'c-msc', company },
      { id: 'i3', ship: 'MSC World Europa', company_id: 'c-msc', company },
      { id: 'i4', ship: null, company_id: 'c-msc', company },
    ] as any)
    assert.deepEqual(ships.map((ship) => [ship.name, ship.itinerary_ids]), [
      ['MSC Magnifica', ['i1', 'i2']],
      ['MSC World Europa', ['i3']],
    ])
  })
})

describe('parseCoordinates', () => {
  test('accetta le forme in cui si copiano da Google Maps', () => {
    assert.deepEqual(parseCoordinates('40.8359, 14.2488'), { lat: 40.8359, lng: 14.2488 })
    assert.deepEqual(parseCoordinates('40,8359 14,2488'), { lat: 40.8359, lng: 14.2488 })
    assert.deepEqual(parseCoordinates('-33.86;151.21'), { lat: -33.86, lng: 151.21 })
    assert.deepEqual(
      parseCoordinates('https://www.google.com/maps/place/Napoli/@40.8359,14.2488,13z'),
      { lat: 40.8359, lng: 14.2488 }
    )
  })

  test('rifiuta testo e coordinate fuori scala', () => {
    assert.equal(parseCoordinates('Napoli'), null)
    assert.equal(parseCoordinates('95, 14'), null)
    assert.equal(parseCoordinates(''), null)
    assert.equal(validLatLng(null, 14), null)
  })
})

test('i colori girano senza uscire dalla tavolozza', () => {
  assert.equal(routeColor(0), routeColor(15))
  assert.ok(routeColor(-1).startsWith('#'))
})
