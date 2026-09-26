import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'

import {
  matchesShippingPortFilter,
  normalizeShippingCatalog,
  normalizeShippingEntry,
  normalizeShippingPhone,
  shippingContactPayload,
  shippingContactPriority,
  shippingPortsLabel,
  slugifyShippingName,
  summarizeShipping,
} from '../src/lib/shipping-companies'

function entry(raw: Record<string, unknown>) {
  const result = normalizeShippingEntry({ name: 'Test Line', ...raw })
  if ('error' in result) throw new Error(result.error)
  return result.entry
}

describe('normalizeShippingEntry', () => {
  test('ripulisce i campi e ricava lo slug dal nome', () => {
    const company = entry({
      name: '  P&O   Cruises ',
      website: 'www.pocruises.com/',
      email: 'MAILTO:Press@Example.com',
      phone: '+44 344 338 8635',
      ships_example: ['Arvia', 'Arvia', 'Iona'],
    })
    assert.equal(company.name, 'P&O Cruises')
    assert.equal(company.slug, 'p-and-o-cruises')
    assert.equal(company.website, 'https://www.pocruises.com')
    assert.equal(company.email, 'press@example.com')
    assert.equal(company.phone, '+44 344 338 8635')
    assert.deepEqual(company.ships, ['Arvia', 'Iona'])
  })

  test('scarta telefono, email e sito non plausibili invece di salvarli', () => {
    const company = entry({ phone: 'chiamare la sede', email: 'info at costa', website: 'n/a' })
    assert.equal(company.phone, null)
    assert.equal(company.email, null)
    assert.equal(company.website, null)
  })

  test('uno scalo non verificato resta null, non diventa "no"', () => {
    const company = entry({ calls_naples: true, calls_civitavecchia: 'forse' })
    assert.equal(company.calls_naples, true)
    assert.equal(company.calls_civitavecchia, null)
  })

  test('una compagnia cessata o confluita non e attiva', () => {
    assert.equal(entry({ ports_note: 'CESSATA: confluita in Polar Latitudes' }).active, false)
    assert.equal(entry({ ports_note: 'CONFLUITA IN Grimaldi' }).active, false)
    assert.equal(entry({ ports_note: 'Napoli–Capri' }).active, true)
  })

  test('un ufficio Italia vuoto non viene salvato', () => {
    assert.equal(entry({ italy_office: { city: null, phone: 'n/a' } }).italy_office, null)
    assert.deepEqual(entry({ italy_office: { city: 'Napoli', phone: '+39 081 7942111' } }).italy_office, {
      city: 'Napoli',
      address: null,
      phone: '+39 081 7942111',
      email: null,
    })
  })

  test('rifiuta una voce senza nome', () => {
    assert.ok('error' in normalizeShippingEntry({ slug: 'x' }))
  })
})

describe('normalizeShippingCatalog', () => {
  test('tiene la prima voce di uno slug e riporta le scartate', () => {
    const { entries, errors } = normalizeShippingCatalog([
      { name: 'MSC Crociere', slug: 'msc-crociere' },
      { name: 'MSC Cruises', slug: 'msc-crociere' },
      { slug: 'senza-nome' },
    ])
    assert.equal(entries.length, 1)
    assert.equal(entries[0].name, 'MSC Crociere')
    assert.equal(errors.length, 2)
  })
})

describe('scali', () => {
  const both = entry({ calls_naples: true, calls_civitavecchia: true })
  const naples = entry({ calls_naples: true, calls_civitavecchia: false })
  const none = entry({ calls_naples: false, calls_civitavecchia: false })
  const unknown = entry({ calls_naples: null, calls_civitavecchia: true })

  test('i filtri per porto', () => {
    assert.deepEqual(
      [both, naples, none, unknown].map((company) => matchesShippingPortFilter(company, 'either')),
      [true, true, false, true]
    )
    assert.equal(matchesShippingPortFilter(naples, 'both'), false)
    assert.equal(matchesShippingPortFilter(both, 'both'), true)
    assert.equal(matchesShippingPortFilter(none, 'none'), true)
    assert.equal(matchesShippingPortFilter(unknown, 'none'), false)
    assert.equal(matchesShippingPortFilter(unknown, 'unknown'), true)
    assert.equal(matchesShippingPortFilter(unknown, 'civitavecchia'), true)
  })

  test('priorita e etichetta', () => {
    assert.equal(shippingContactPriority(both), 2)
    assert.equal(shippingContactPriority(naples), 1)
    assert.equal(shippingContactPriority(none), 0)
    assert.equal(shippingPortsLabel(both), 'Napoli + Civitavecchia (Roma)')
    assert.equal(shippingPortsLabel(none), 'Né Napoli né Civitavecchia')
    assert.equal(shippingPortsLabel(entry({})), 'Scali da verificare')
  })

  test('il riepilogo conta ogni porto una volta', () => {
    const summary = summarizeShipping([both, naples, none, unknown])
    assert.equal(summary.total, 4)
    assert.equal(summary.naples, 2)
    assert.equal(summary.civitavecchia, 2)
    assert.equal(summary.both, 1)
    assert.equal(summary.unknown, 1)
  })
})

describe('shippingContactPayload', () => {
  test('crea un contatto holding, fuori dalle campagne automatiche', () => {
    const company = entry({
      name: 'MSC Crociere',
      kind: 'cruise',
      hq_country: 'Switzerland',
      phone: '+41 22 000 0000',
      italy_office: { city: 'Napoli', phone: '+39 081 7942111' },
      calls_naples: true,
      calls_civitavecchia: true,
    })
    const payload = shippingContactPayload(company, 'user-1')
    assert.equal(payload.legacy_id, 'shipping-msc-crociere')
    assert.equal(payload.contact_scope, 'holding')
    assert.equal(payload.list_name, 'Compagnie di navigazione')
    assert.equal(payload.marketing_eligibility, 'review')
    // Da un ufficio commerciale italiano si parte prima che dal centralino di Ginevra.
    assert.equal(payload.phone, '+39 081 7942111')
    assert.equal(payload.priority, 2)
    assert.match(payload.note, /Scali: Napoli \+ Civitavecchia/)
  })
})

describe('utility', () => {
  test('slug', () => {
    assert.equal(slugifyShippingName('Croisières de France'), 'croisieres-de-france')
    assert.equal(slugifyShippingName('A-ROSA Flussschiff'), 'a-rosa-flussschiff')
  })

  test('telefono', () => {
    assert.equal(normalizeShippingPhone('800 333303'), '800 333303')
    assert.equal(normalizeShippingPhone('+49 228 9260-0'), '+49 228 9260-0')
    assert.equal(normalizeShippingPhone('12'), null)
  })
})

describe('catalogo in scripts/data', () => {
  test('ogni voce passa la validazione e gli slug sono unici', () => {
    const file = path.join(__dirname, '..', 'scripts', 'data', 'shipping-companies.json')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { entries, errors } = normalizeShippingCatalog(raw)
    assert.deepEqual(errors, [])
    assert.equal(entries.length, raw.length)
    assert.ok(entries.some((company) => company.calls_naples && company.calls_civitavecchia))
  })
})
