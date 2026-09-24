import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  APPLICATION_TEXT_MAX,
  SALES_PROGRAM,
  applicationSummary,
  commissionExamples,
  parseSalesApplication,
  salesProgramProduct,
} from '../src/lib/sales-program'

const valid = {
  name: ' Luca   Bianchi ',
  email: ' Luca@Example.IT ',
  phone: '+39 333 1234567',
  area: 'Napoli e provincia',
  experience: 'Agente di commercio per 5 anni',
  has_vat_number: 'yes',
  privacy: true,
}

describe('provvigioni', () => {
  test('il prodotto viene dal pacchetto video_map', () => {
    assert.deepEqual(salesProgramProduct(), { label: 'VIDEO NELLA MAPPA', netPrice: 300, listPrice: 400 })
  })

  test('esempi coerenti con le percentuali', () => {
    assert.equal(SALES_PROGRAM.firstYearPercent, 30)
    assert.equal(SALES_PROGRAM.renewalPercent, 10)
    assert.deepEqual(commissionExamples(10), {
      perSale: { firstYear: 90, renewal: 30 },
      portfolio: { clients: 10, firstYear: 900, renewalPerYear: 300 },
    })
  })
})

describe('parseSalesApplication', () => {
  test('candidatura valida e normalizzata', () => {
    const parsed = parseSalesApplication(valid)
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.value.name, 'Luca Bianchi')
      assert.equal(parsed.value.email, 'luca@example.it')
      assert.equal(parsed.value.hasVatNumber, true)
      assert.equal(parsed.value.availability, null)
      assert.ok(applicationSummary(parsed.value).includes('Zona: Napoli e provincia'))
    }
  })

  test('campi obbligatori e consenso', () => {
    assert.equal(parseSalesApplication({ ...valid, name: '' }).ok, false)
    assert.equal(parseSalesApplication({ ...valid, email: 'luca' }).ok, false)
    assert.equal(parseSalesApplication({ ...valid, phone: '12' }).ok, false)
    assert.equal(parseSalesApplication({ ...valid, area: ' ' }).ok, false)
    assert.equal(parseSalesApplication({ ...valid, privacy: 'true' }).ok, false)
    assert.equal(parseSalesApplication(null).ok, false)
  })

  test('honeypot compilato = spam silenzioso', () => {
    const parsed = parseSalesApplication({ ...valid, website: 'http://spam.example' })
    assert.equal(parsed.ok, false)
    assert.equal('spam' in parsed && parsed.spam, true)
  })

  test('esperienza troncata e partita IVA non indicata', () => {
    const parsed = parseSalesApplication({ ...valid, experience: 'x'.repeat(5000), has_vat_number: '' })
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.value.experience?.length, APPLICATION_TEXT_MAX)
      assert.equal(parsed.value.hasVatNumber, null)
    }
  })
})
