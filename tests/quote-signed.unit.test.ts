import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeNumber, signedQuoteEconomicChanges } from '../src/lib/server/quotes'
import { stripeFetch, subscriptionCheckoutIdempotencyKey } from '../src/lib/server/stripe'

describe('checkout abbonamento: un solo abbonamento per due clic', () => {
  const base = { quoteId: 'q1', totalCents: 48800, pricing: 'inline' as const, previousSessionId: null }

  test('stesso stato letto, stessa chiave', () => {
    assert.equal(subscriptionCheckoutIdempotencyKey(base), subscriptionCheckoutIdempotencyKey({ ...base }))
  })

  test('sessione salvata diversa, importo o prezzo diversi: chiave diversa', () => {
    const key = subscriptionCheckoutIdempotencyKey(base)
    assert.notEqual(key, subscriptionCheckoutIdempotencyKey({ ...base, previousSessionId: 'cs_old' }))
    assert.notEqual(key, subscriptionCheckoutIdempotencyKey({ ...base, totalCents: 36600 }))
    assert.notEqual(key, subscriptionCheckoutIdempotencyKey({ ...base, pricing: 'catalog' }))
  })

  test('stripeFetch manda la chiave solo sulle POST', async () => {
    const originalFetch = globalThis.fetch
    const originalKey = process.env.STRIPE_SECRET_KEY
    const seen: Array<Record<string, string>> = []
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) })
      return new Response(JSON.stringify({ id: 'cs_1' }), { status: 200 })
    }) as typeof fetch
    try {
      await stripeFetch('/checkout/sessions', { params: new URLSearchParams({ a: '1' }), idempotencyKey: 'k1' })
      await stripeFetch('/checkout/sessions/cs_1', { idempotencyKey: 'k2' })
    } finally {
      globalThis.fetch = originalFetch
      if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY
      else process.env.STRIPE_SECRET_KEY = originalKey
    }
    assert.equal(seen[0]['Idempotency-Key'], 'k1')
    assert.equal(seen[1]['Idempotency-Key'], undefined)
  })
})

const signedQuote = {
  items: [
    { description: 'Video nella mappa', details: null, quantity: 1, unit_price: 400, list_unit_price: 500, line_total: 400 },
    { id: 'b', description: 'Opzione A', quantity: 1, unit_price: 100, line_total: 100, choice_group_id: 'g', selected: true },
    { id: 'c', description: 'Opzione B', quantity: 1, unit_price: 200, line_total: 200, choice_group_id: 'g', selected: false },
  ],
  discount_amount: 0,
  tax_rate: 0,
  payment_terms_mode: 'percent',
  deposit_percent: 30,
  deposit_manual_amount: null,
  currency: 'EUR',
  billing_interval: null,
}

describe('preventivo firmato: campi economici', () => {
  test('rimandare il preventivo com’era non è un cambiamento', () => {
    // Il costruttore rimanda le righe lette (gli id possono cambiare) e i numeri come stringhe.
    const body = {
      status: 'paid',
      items: signedQuote.items.map((item, index) => ({ ...item, id: `nuovo-${index}` })),
      discount_amount: '0',
      tax_rate: 0,
      payment_terms_mode: 'percent',
      deposit_percent: '30.00',
      deposit_manual_amount: null,
      billing_interval: 'one_time',
      customer_tax_id: 'IT01234567890',
    }
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, body), [])
  })

  test('solo stato o dati di fatturazione: nessun blocco', () => {
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { status: 'paid' }), [])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { customer_pec: 'a@pec.it', title: 'Nuovo titolo' }), [])
  })

  test('prezzo, descrizione o scelta di una riga cambiati', () => {
    const repriced = signedQuote.items.map((item, index) => (index === 0 ? { ...item, unit_price: 300 } : item))
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { items: repriced }), ['righe'])
    const renamed = signedQuote.items.map((item, index) => (index === 0 ? { ...item, description: 'Altro' } : item))
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { items: renamed }), ['righe'])
    const otherChoice = signedQuote.items.map((item) =>
      item.choice_group_id ? { ...item, selected: item.id === 'c' } : item
    )
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { items: otherChoice }), ['righe'])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { items: signedQuote.items.slice(0, 1) }), ['righe'])
  })

  test('IVA 0% resta 0%: cambiarla è un cambiamento', () => {
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { tax_rate: 0 }), [])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { tax_rate: 22 }), ['IVA'])
    // IVA mai salvata vale 22, come al salvataggio.
    assert.deepEqual(signedQuoteEconomicChanges({ ...signedQuote, tax_rate: null }, { tax_rate: 22 }), [])
  })

  test('acconto e condizioni di pagamento', () => {
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { deposit_percent: 50 }), ['acconto'])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { payment_terms_mode: 'manual' }), ['condizioni di pagamento'])
    const manual = { ...signedQuote, payment_terms_mode: 'manual', deposit_percent: 33.33, deposit_manual_amount: 150 }
    // In modalità manuale la percentuale è derivata: non si confronta.
    assert.deepEqual(signedQuoteEconomicChanges(manual, { deposit_percent: 40, deposit_manual_amount: 150 }), [])
    assert.deepEqual(signedQuoteEconomicChanges(manual, { deposit_manual_amount: 200 }), ['acconto'])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { discount_amount: 50 }), ['sconto'])
  })

  test('valuta e tipo di pagamento', () => {
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { currency: 'eur' }), [])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { currency: 'USD' }), ['valuta'])
    assert.deepEqual(signedQuoteEconomicChanges(signedQuote, { billing_interval: 'year' }), [
      'tipo di pagamento (una tantum o annuale)',
    ])
  })

  test('un valore salvato a 0 non diventa il default', () => {
    // Era `Number(current.tax_rate || 22)`: un preventivo esente tornava al 22%.
    assert.equal(normalizeNumber(0, 22), 0)
    assert.equal(normalizeNumber(null, 22), 22)
    assert.equal(normalizeNumber(undefined, 30), 30)
  })
})

describe('risposte API dei preventivi', () => {
  test('il token di accettazione non esce', async () => {
    const { normalizeQuoteRow } = await import('../src/lib/server/quote-create')
    const row = normalizeQuoteRow({ id: 'q', quote_acceptance_token: 'segreto', public_token: 'pub', contact: [{ id: 'c' }], items: null })
    assert.equal('quote_acceptance_token' in row, false)
    assert.equal(row.public_token, 'pub')
    assert.deepEqual(row.contact, { id: 'c' })
    assert.deepEqual(row.items, [])
  })
})
