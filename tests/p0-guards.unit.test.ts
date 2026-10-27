import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  quoteSignatureMismatches,
  signedQuoteEconomicChangeMessage,
  signedQuoteEconomicChanges,
} from '../src/lib/server/quotes'

const current = {
  items: [
    {
      id: 'item-1',
      description: 'Piattaforma Speaqi',
      details: null,
      quantity: 1,
      unit_price: 990,
      line_total: 990,
    },
  ],
  discount_amount: 0,
  tax_rate: 22,
  payment_terms_mode: 'percent',
  deposit_percent: 30,
  deposit_manual_amount: null,
  currency: 'EUR',
  billing_interval: 'one_time',
  payment_method: 'bank_transfer',
  valid_until: '2026-12-31',
}

describe('signedQuoteEconomicChanges', () => {
  test('nessuna modifica economica su un preventivo firmato', () => {
    assert.deepEqual(signedQuoteEconomicChanges({}, current), [])
  })

  test('le stesse righe con id diversi non sono una modifica', () => {
    const body = {
      items: [{ ...current.items[0], id: 'item-2', line_total: 990 }],
    }
    assert.deepEqual(signedQuoteEconomicChanges(body, current), [])
  })

  test('cambiare prezzo, IVA, valuta, acconto o periodicità viene bloccato', () => {
    assert.deepEqual(
      signedQuoteEconomicChanges({ items: [{ ...current.items[0], unit_price: 1200 }] }, current),
      ['items']
    )
    assert.deepEqual(signedQuoteEconomicChanges({ tax_rate: 0 }, current), ['tax_rate'])
    assert.deepEqual(signedQuoteEconomicChanges({ currency: 'USD' }, current), ['currency'])
    assert.deepEqual(signedQuoteEconomicChanges({ deposit_percent: 0 }, current), ['deposit_percent'])
    assert.deepEqual(signedQuoteEconomicChanges({ billing_interval: 'year' }, current), ['billing_interval'])
    assert.deepEqual(signedQuoteEconomicChanges({ valid_until: '2027-01-31' }, current), ['valid_until'])
  })

  test('un preventivo esente (IVA 0) resta esente', () => {
    const exempt = { ...current, tax_rate: 0, deposit_percent: 0 }
    assert.deepEqual(signedQuoteEconomicChanges({ tax_rate: 0, deposit_percent: 0 }, exempt), [])
    assert.match(signedQuoteEconomicChangeMessage(['items', 'tax_rate']), /righe offerta, IVA/)
  })

  test('quantità frazionarie e fallback null non eludono il blocco', () => {
    assert.deepEqual(signedQuoteEconomicChanges({ items: [{ ...current.items[0], quantity: 1.001 }] }, current), ['items'])
    const exempt = { ...current, tax_rate: 0, deposit_percent: 0 }
    for (const value of [null, '', 'non-un-numero']) {
      assert.deepEqual(signedQuoteEconomicChanges({ tax_rate: value, deposit_percent: value }, exempt), ['tax_rate', 'deposit_percent'])
    }
    assert.deepEqual(signedQuoteEconomicChanges({ total_amount: 1209.01 }, { ...current, total_amount: 1207.8 }), ['total_amount'])
  })
})

describe('quoteSignatureMismatches', () => {
  const quote = {
    items: current.items,
    subtotal_amount: 990,
    discount_amount: 0,
    tax_rate: 22,
    tax_amount: 217.8,
    total_amount: 1207.8,
    currency: 'EUR',
    billing_interval: 'one_time',
  }
  const snapshot = {
    items: current.items,
    subtotal: 990,
    discount: 0,
    tax_rate: 22,
    tax: 217.8,
    total: 1207.8,
    currency: 'EUR',
    billing_interval: 'one_time',
  }

  test('snapshot identico', () => {
    assert.deepEqual(quoteSignatureMismatches(snapshot, quote), [])
  })

  test('stesso totale ma righe diverse', () => {
    const changed = {
      ...snapshot,
      items: [{ ...current.items[0], description: 'Altra offerta' }],
    }
    assert.deepEqual(quoteSignatureMismatches(changed, quote), ['items'])
  })

  test('stesso numero ma valuta o periodicità diverse', () => {
    assert.deepEqual(
      quoteSignatureMismatches({ ...snapshot, currency: 'USD' }, quote),
      ['currency']
    )
    assert.deepEqual(
      quoteSignatureMismatches({ ...snapshot, billing_interval: 'year' }, quote),
      ['billing_interval']
    )
  })

  test('l’ordine delle chiavi delle righe non conta', () => {
    const reordered = {
      ...snapshot,
      items: [
        {
          line_total: 990,
          unit_price: 990,
          quantity: 1,
          details: null,
          description: 'Piattaforma Speaqi',
          id: 'item-1',
        },
      ],
    }
    assert.deepEqual(quoteSignatureMismatches(reordered, quote), [])
  })

  test('id rigenerati e line_total derivati non cambiano le condizioni firmate', () => {
    assert.deepEqual(quoteSignatureMismatches(snapshot, {
      ...quote, items: [{ ...current.items[0], id: 'regenerated', line_total: undefined }],
    }), [])
    assert.deepEqual(quoteSignatureMismatches(snapshot, {
      ...quote, items: [{ ...current.items[0], quantity: 1.001 }],
    }), ['items'])
  })
})

describe('buildGmailConnectUrl (PKCE)', () => {
  const keys = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'GMAIL_TOKEN_ENCRYPTION_KEY',
  ] as const
  const saved = new Map<string, string | undefined>()

  before(() => {
    for (const key of keys) saved.set(key, process.env[key])
    process.env.GOOGLE_CLIENT_ID = 'client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
    process.env.GOOGLE_REDIRECT_URI = 'https://crm.example.com/api/gmail/callback'
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'test-encryption-key'
  })
  after(() => {
    for (const key of keys) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test('include code_challenge S256 quando richiesto', async () => {
    const { buildGmailConnectUrl } = await import('../src/lib/server/gmail')
    const url = new URL(buildGmailConnectUrl('state-1', 'challenge-1'))
    assert.equal(url.searchParams.get('state'), 'state-1')
    assert.equal(url.searchParams.get('code_challenge'), 'challenge-1')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  })
})
