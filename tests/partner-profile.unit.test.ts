import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findPlaces, profilePartner } from '../src/lib/office/partner-profile'

test('incoming a Napoli con email: si scrive, rivendita e pacchetti', () => {
  const p = profilePartner({ name: 'Worldtours', type_code: 'dmc', email: 'info@worldtours.it', website: 'https://worldtours.it',
    description: 'Worldtours is an incoming tour operator based in Naples, Italy. We organise private tours and transfers.' })
  assert.equal(p.activities[0], 'incoming')
  assert.equal(p.audience, 'foreign')
  assert.deepEqual(p.places.map((x) => x.key), ['napoli'])
  assert.deepEqual(p.offers, ['resale', 'packages'])
  assert.equal(p.next, 'write')
  assert.ok(p.value >= 80)
})

test('senza email ma con sito: si legge solo la pagina contatti', () => {
  const p = profilePartner({ name: 'Rome And Italy', type_code: 'dmc', website: 'https://romeanditaly.com',
    description: 'Rome and Italy is a DMC with offices in Rome and Florence, tailor-made tours for international guests.' })
  assert.equal(p.next, 'find_email')
  assert.deepEqual(p.places.map((x) => x.key).sort(), ['firenze', 'roma'])
})

test('lavora dove non abbiamo la guida: entra nella domanda per destinazione', () => {
  const p = profilePartner({ name: 'Authentic Experiences In Sardinia', type_code: 'travel_agency', email: 'info@x.it',
    description: 'Travel agency based in Alghero, specialized in tailor-made itineraries across Sardinia for foreign guests.' })
  assert.equal(p.next, 'guide_needed')
  assert.ok(p.places.some((x) => x.key === 'sardegna' && x.coverage === 'missing'))
})

test('tutta Italia senza un posto preciso: può vendere ogni guida', () => {
  const p = profilePartner({ name: 'Girolibero', type_code: 'tour_operator', email: 'info@girolibero.it',
    description: 'We are an Italian tour operator providing cycling holidays in Italy and Europe.' })
  assert.equal(p.national, true)
  assert.equal(p.next, 'write')
})

test('dati scarsi: il sito si legge solo se vale la pena', () => {
  const generic = 'Espositore TTG Travel Experience 2026. Categorie pubblicate: non disponibili. Identità e classificazione da verificare.'
  const tour = profilePartner({ name: 'Askos Tours', type_code: 'dmc', website: 'https://askos.it', email: 'info@askos.it', description: generic })
  assert.equal(tour.thin, true)
  assert.equal(tour.next, 'read_site')
  const nothing = profilePartner({ name: 'Latteria Sociale', type_code: 'other', website: 'https://latteria.it', description: generic })
  assert.equal(nothing.next, 'skip')
  // Il posto nel nome basta: si scrive senza leggere.
  const named = profilePartner({ name: 'Milan Open Tour', type_code: 'tour_operator', email: 'info@mot.it', description: '' })
  assert.equal(named.next, 'write')
})

test('enti e consorzi: proposta di guida della destinazione; strutture ricettive fuori', () => {
  const dmo = profilePartner({ name: 'Visit Brescia', type_code: 'dmo', email: 'info@visitbrescia.it', description: 'Official tourism board of Brescia.' })
  assert.equal(dmo.next, 'destination_body')
  assert.deepEqual(dmo.offers, ['destination'])
  const relais = profilePartner({ name: 'Residenza dei Ricci Tuscany Relais', type_code: 'other', website: 'https://x.it', description: '' })
  assert.equal(relais.next, 'skip')
  assert.ok(relais.why.includes('struttura ricettiva'))
})

test('luoghi: parole intere, nomi stranieri e aree', () => {
  assert.deepEqual(findPlaces('Boat tours on the Amalfi Coast and Capri').map((p) => p.key), ['capri', 'costiera-amalfitana'])
  assert.deepEqual(findPlaces('Romania e Bulgaria').map((p) => p.key), [])
  assert.deepEqual(findPlaces('Tour in Sicily: Taormina and Etna').map((p) => p.key), ['catania', 'taormina', 'sicilia'])
})

test('una tecnologia o un altro mestiere non si scrive', () => {
  const p = profilePartner({ name: 'Lybra Tech', type_code: 'technology', email: 'info@lybra.tech', description: 'Software house: booking engine and channel manager for hotels in Rome.' })
  assert.equal(p.next, 'skip')
  assert.deepEqual(p.offers, ['partnership'])
})
