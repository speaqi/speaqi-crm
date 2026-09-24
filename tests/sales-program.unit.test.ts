import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  APPLICATION_TEXT_MAX,
  COMMISSION_LIMITS,
  SALES_PROGRAM,
  applicationSummary,
  commissionEstimate,
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
  test('il prodotto viene dal pacchetto video_map, prezzo fisso', () => {
    assert.deepEqual(salesProgramProduct(), { label: 'VIDEO NELLA MAPPA', netPrice: 400 })
  })

  test('20% il primo anno, 10% sui rinnovi, per ogni video', () => {
    assert.equal(SALES_PROGRAM.firstYearPercent, 20)
    assert.equal(SALES_PROGRAM.renewalPercent, 10)
    assert.deepEqual(commissionEstimate(10, 2), {
      clients: 10,
      videosPerClient: 2,
      videos: 20,
      revenue: 8000,
      perVideo: { firstYear: 80, renewal: 40 },
      firstYear: 1600,
      renewalPerYear: 800,
      threeYears: 3200,
    })
  })

  test('un cliente con un video', () => {
    const one = commissionEstimate(1, 1)
    assert.equal(one.firstYear, 80)
    assert.equal(one.renewalPerYear, 40)
    assert.equal(one.threeYears, 160)
  })

  test('valori sporchi: niente negativi, decimali troncati, tetti rispettati', () => {
    assert.equal(commissionEstimate(-3, 1).videos, 0)
    assert.equal(commissionEstimate('abc', 1).firstYear, 0)
    assert.equal(commissionEstimate(2.9, 1.5).videos, 2)
    const capped = commissionEstimate(100000, 1000)
    assert.equal(capped.clients, COMMISSION_LIMITS.clients)
    assert.equal(capped.videosPerClient, COMMISSION_LIMITS.videosPerClient)
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
