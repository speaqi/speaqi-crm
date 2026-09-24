import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, test } from 'node:test'
import {
  SPEAQI_PACKAGES,
  quoteDraftFromPackage,
  quoteLineFromPackage,
} from '../src/lib/speaqi-quote-packages'
import {
  applyBillingRules,
  calculateQuoteTotals,
  normalizeBillingInterval,
  normalizeQuoteItems,
} from '../src/lib/server/quotes'
import {
  buildSubscriptionCheckoutParams,
  catalogAmountCents,
  catalogPriceCents,
  invoicePeriodEnd,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  subscriptionPeriodEnd,
  toCents,
  verifyStripeSignature,
} from '../src/lib/server/stripe'
import { clientIp, parseSignPayload, validateSignatureDataUrl } from '../src/lib/server/quote-signature'
import {
  escapeLike,
  generateSalesToken,
  hashSalesToken,
  isWellFormedSalesToken,
  parseSalesQuotePayload,
} from '../src/lib/server/sales-links'

const SECRET = 'whsec_test_secret'

function signedHeader(body: string, timestamp: number, secret = SECRET) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
  return `t=${timestamp},v1=${signature}`
}

/** PNG finto ma plausibile: firma magica corretta e peso di una firma vera. */
function fakePng(bytes = 2000) {
  const buffer = Buffer.alloc(bytes, 7)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  return `data:image/png;base64,${buffer.toString('base64')}`
}

describe('verifyStripeSignature', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' })
  const now = 1_800_000_000

  test('accetta una firma valida', () => {
    assert.deepEqual(verifyStripeSignature(body, signedHeader(body, now), SECRET, now), { ok: true, timestamp: now })
  })

  test('rifiuta segreto sbagliato e corpo alterato', () => {
    assert.equal(verifyStripeSignature(body, signedHeader(body, now, 'whsec_other'), SECRET, now).ok, false)
    assert.equal(verifyStripeSignature(`${body} `, signedHeader(body, now), SECRET, now).ok, false)
  })

  test('rifiuta un evento fuori tolleranza (replay)', () => {
    const result = verifyStripeSignature(body, signedHeader(body, now - 301), SECRET, now)
    assert.deepEqual(result, { ok: false, reason: 'timestamp_out_of_tolerance' })
  })

  test('basta un v1 valido fra piu firme (rotazione del segreto)', () => {
    const valid = signedHeader(body, now).split(',')[1]
    const header = `t=${now},v1=${'0'.repeat(64)},${valid}`
    assert.equal(verifyStripeSignature(body, header, SECRET, now).ok, true)
  })

  test('header malformato, assente o solo v0', () => {
    assert.equal(verifyStripeSignature(body, null, SECRET, now).ok, false)
    assert.equal(verifyStripeSignature(body, 'garbage', SECRET, now).ok, false)
    assert.equal(verifyStripeSignature(body, `t=${now},v0=abc`, SECRET, now).ok, false)
    assert.equal(verifyStripeSignature(body, `v1=abc`, SECRET, now).ok, false)
  })
})

describe('importi dell’abbonamento video', () => {
  test('400 + IVA 22% = 488, tutto dovuto subito, saldo zero', () => {
    const draft = quoteDraftFromPackage('video_map', 'line-1')
    const items = normalizeQuoteItems(draft.items)
    const totals = calculateQuoteTotals(items, {
      taxRate: 22,
      paymentTermsMode: draft.payment_terms_mode,
      depositPercent: draft.deposit_percent,
    })
    assert.equal(totals.subtotal_amount, 400)
    assert.equal(totals.tax_amount, 88)
    assert.equal(totals.total_amount, 488)
    assert.equal(totals.deposit_amount, 488)
    assert.equal(totals.balance_amount, 0)
  })

  test('centesimi esatti per Stripe', () => {
    assert.equal(toCents(488), 48800)
    assert.equal(toCents(400 * 1.22), 48800)
    assert.equal(toCents('488.00'), 48800)
  })
})

describe('pacchetti', () => {
  test('video_map: abbonamento annuale con carta, prezzo fisso 400 senza barrato', () => {
    const draft = quoteDraftFromPackage('video_map', 'line-1')
    assert.equal(draft.billing_interval, 'year')
    assert.equal(draft.payment_method, 'stripe')
    assert.equal(draft.deposit_percent, 100)
    assert.equal(draft.items[0].unit_price, 400)
    assert.equal(draft.items[0].list_unit_price, undefined)
    assert.equal(normalizeQuoteItems(draft.items)[0].list_unit_price, undefined)
  })

  test('platform resta una tantum e senza listino', () => {
    const draft = quoteDraftFromPackage('platform', 'line-1')
    assert.equal(draft.billing_interval, 'one_time')
    assert.equal('payment_method' in draft, false)
    assert.equal(quoteLineFromPackage('platform', 'x').list_unit_price, undefined)
    assert.equal(SPEAQI_PACKAGES.platform.unit_price, 990)
  })
})

describe('applyBillingRules', () => {
  test('un abbonamento forza carta, 100% e nota', () => {
    const result = applyBillingRules({
      billing_interval: 'year',
      payment_method: 'bank_transfer',
      payment_terms_mode: 'manual',
      deposit_percent: 30,
      deposit_manual_amount: 50,
      payment_terms_note: '',
    })
    assert.equal(result.payment_method, 'stripe')
    assert.equal(result.payment_terms_mode, 'percent')
    assert.equal(result.deposit_percent, 100)
    assert.equal(result.deposit_manual_amount, null)
    assert.ok(String(result.payment_terms_note).includes('rinnovo automatico'))
  })

  test('una tantum resta com’era', () => {
    const input = { billing_interval: 'boh', payment_method: 'both', deposit_percent: 30 }
    const result = applyBillingRules(input)
    assert.equal(result.billing_interval, 'one_time')
    assert.equal(result.payment_method, 'both')
    assert.equal(result.deposit_percent, 30)
  })

  test('normalizeBillingInterval', () => {
    assert.equal(normalizeBillingInterval('year'), 'year')
    assert.equal(normalizeBillingInterval(undefined), 'one_time')
    assert.equal(normalizeBillingInterval('monthly', 'year'), 'year')
  })
})

describe('buildSubscriptionCheckoutParams', () => {
  const params = buildSubscriptionCheckoutParams({
    token: 'tok123',
    quoteId: '11111111-1111-1111-1111-111111111111',
    quoteNumber: 'PREV-1',
    totalAmount: 366,
    currency: 'EUR',
    customerEmail: 'bar@example.com',
    productName: 'Video nella mappa (PREV-1)',
    origin: 'https://crm.speaqi.com/',
  })

  test('abbonamento annuale solo carta', () => {
    assert.equal(params.get('metadata[pricing]'), 'inline')
    assert.equal(params.get('mode'), 'subscription')
    assert.equal(params.get('payment_method_types[0]'), 'card')
    assert.equal(params.get('line_items[0][price_data][recurring][interval]'), 'year')
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), '36600')
    assert.equal(params.get('line_items[0][price_data][currency]'), 'eur')
    assert.equal(params.get('customer_email'), 'bar@example.com')
  })

  test('metadata anche sull’abbonamento, per i rinnovi', () => {
    assert.equal(params.get('metadata[quote_id]'), '11111111-1111-1111-1111-111111111111')
    assert.equal(params.get('subscription_data[metadata][quote_id]'), '11111111-1111-1111-1111-111111111111')
    assert.equal(params.get('subscription_data[metadata][quote_token]'), 'tok123')
  })

  test('ritorno con {CHECKOUT_SESSION_ID} intatto', () => {
    assert.equal(
      params.get('success_url'),
      'https://crm.speaqi.com/preventivo?id=tok123&checkout=success&session_id={CHECKOUT_SESSION_ID}'
    )
  })
})

describe('catalogo Stripe: Video nella mappa', () => {
  const price = { active: true, type: 'recurring', recurring: { interval: 'year', interval_count: 1 }, currency: 'eur', unit_amount: 48800 }
  const coupon = { valid: true, duration: 'forever', amount_off: 12200, currency: 'eur' }

  test('prezzo pieno da solo: 488 €, cioè 400 € + IVA', () => {
    assert.equal(catalogPriceCents(price), 48800)
    assert.equal(catalogPriceCents(price), toCents(488))
    assert.equal(catalogPriceCents({ ...price, active: false }), null)
    assert.equal(catalogPriceCents({ ...price, recurring: { interval: 'month' } }), null)
    assert.equal(catalogPriceCents({ ...price, currency: 'usd' }), null)
  })

  test('488 € − 122 € per sempre = 366 €: i preventivi firmati a 300 € + IVA', () => {
    assert.equal(catalogAmountCents(price, coupon), 36600)
    assert.equal(catalogAmountCents(price, coupon), toCents(366))
  })

  test('coupon in percentuale', () => {
    assert.equal(catalogAmountCents(price, { valid: true, duration: 'forever', percent_off: 25 }), 36600)
  })

  test('scarta ciò che farebbe addebitare altro', () => {
    assert.equal(catalogAmountCents(price, { ...coupon, duration: 'once' }), null)
    assert.equal(catalogAmountCents(price, { ...coupon, valid: false }), null)
    assert.equal(catalogAmountCents(price, { ...coupon, currency: 'usd' }), null)
    assert.equal(catalogAmountCents({ ...price, recurring: { interval: 'month' } }, coupon), null)
    assert.equal(catalogAmountCents({ ...price, active: false }, coupon), null)
    assert.equal(catalogAmountCents({ ...price, currency: 'usd' }, coupon), null)
    assert.equal(catalogAmountCents(price, { ...coupon, amount_off: 48800 }), null)
  })

  test('parametri del checkout col catalogo', () => {
    const params = buildSubscriptionCheckoutParams({
      token: 'tok',
      quoteId: 'q',
      quoteNumber: 'PREV-1',
      totalAmount: 366,
      productName: 'Video',
      origin: 'https://crm.speaqi.com',
      catalog: { priceId: 'price_123', couponId: 'coupon_abc' },
    })
    assert.equal(params.get('line_items[0][price]'), 'price_123')
    assert.equal(params.get('discounts[0][coupon]'), 'coupon_abc')
    assert.equal(params.get('line_items[0][price_data][unit_amount]'), null)
    assert.equal(params.get('metadata[pricing]'), 'catalog')
    assert.equal(params.get('subscription_data[metadata][pricing]'), 'catalog')
  })

  test('parametri del checkout col catalogo senza coupon', () => {
    const params = buildSubscriptionCheckoutParams({
      token: 'tok',
      quoteId: 'q',
      quoteNumber: 'PREV-2',
      totalAmount: 488,
      productName: 'Video',
      origin: 'https://crm.speaqi.com',
      catalog: { priceId: 'price_123', couponId: null },
    })
    assert.equal(params.get('line_items[0][price]'), 'price_123')
    assert.equal(params.has('discounts[0][coupon]'), false)
    assert.equal(params.get('metadata[pricing]'), 'catalog')
  })
})

describe('letture Stripe tolleranti', () => {
  test('invoice nel formato recente (parent.subscription_details)', () => {
    const invoice = {
      parent: { subscription_details: { subscription: 'sub_new', metadata: { quote_id: 'q1' } } },
      lines: { data: [{ period: { end: 1_800_000_000 } }] },
    }
    assert.equal(invoiceSubscriptionId(invoice), 'sub_new')
    assert.deepEqual(invoiceSubscriptionMetadata(invoice), { quote_id: 'q1' })
    assert.equal(invoicePeriodEnd(invoice), new Date(1_800_000_000 * 1000).toISOString())
  })

  test('invoice nel formato legacy', () => {
    assert.equal(invoiceSubscriptionId({ subscription: 'sub_old' }), 'sub_old')
    assert.equal(invoiceSubscriptionId({ subscription: { id: 'sub_obj' } }), 'sub_obj')
    assert.equal(invoiceSubscriptionId({}), null)
  })

  test('fine periodo dall’item o dalla radice', () => {
    assert.equal(
      subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1_800_000_000 }] } }),
      new Date(1_800_000_000 * 1000).toISOString()
    )
    assert.equal(subscriptionPeriodEnd({ current_period_end: 1_700_000_000 }), new Date(1_700_000_000 * 1000).toISOString())
    assert.equal(subscriptionPeriodEnd({}), null)
  })
})

describe('firma disegnata', () => {
  test('PNG valido', () => {
    assert.deepEqual(validateSignatureDataUrl(fakePng()), { ok: true })
  })

  test('rifiuta JPEG, vuota, troppo pesante, base64 rotto e byte sbagliati', () => {
    assert.equal(validateSignatureDataUrl('data:image/jpeg;base64,AAAA').ok, false)
    assert.equal(validateSignatureDataUrl(fakePng(100)).ok, false)
    assert.equal(validateSignatureDataUrl(fakePng(210 * 1024)).ok, false)
    assert.equal(validateSignatureDataUrl('data:image/png;base64,@@@').ok, false)
    const wrongMagic = `data:image/png;base64,${Buffer.alloc(2000, 1).toString('base64')}`
    assert.equal(validateSignatureDataUrl(wrongMagic).ok, false)
  })

  test('parseSignPayload: nome, accettazione e rinnovo', () => {
    const base = {
      token: 't',
      acceptance_token: 'a',
      signer_name: '  Mario   Rossi ',
      accepted: true,
      renewal_accepted: true,
      signature_png: fakePng(),
    }
    const parsed = parseSignPayload(base, { requireRenewalClause: true })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.value.signerName, 'Mario Rossi')
    assert.equal(parseSignPayload({ ...base, renewal_accepted: false }, { requireRenewalClause: true }).ok, false)
    assert.equal(parseSignPayload({ ...base, renewal_accepted: false }).ok, true)
    assert.equal(parseSignPayload({ ...base, accepted: 'true' }).ok, false)
    assert.equal(parseSignPayload({ ...base, acceptance_token: '' }).ok, false)
    assert.equal(parseSignPayload({ ...base, signer_name: 'Al' }).ok, false)
  })

  test('clientIp prende il primo x-forwarded-for', () => {
    assert.equal(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4')
    assert.equal(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' })), '5.6.7.8')
    assert.equal(clientIp(new Headers()), null)
  })
})

describe('link vendita', () => {
  test('token generati ben formati e hash deterministico', () => {
    const token = generateSalesToken()
    assert.equal(isWellFormedSalesToken(token), true)
    assert.equal(hashSalesToken(token), hashSalesToken(token))
    assert.match(hashSalesToken(token), /^[0-9a-f]{64}$/)
    assert.notEqual(generateSalesToken(), token)
  })

  test('token malformati rifiutati prima del database', () => {
    assert.equal(isWellFormedSalesToken('corto'), false)
    assert.equal(isWellFormedSalesToken(`${'a'.repeat(42)}/`), false)
    assert.equal(isWellFormedSalesToken(undefined), false)
  })

  test('parseSalesQuotePayload', () => {
    const ok = parseSalesQuotePayload({
      company: 'Bar Centrale',
      contact_name: 'Anna Bianchi',
      email: ' Anna@Example.IT ',
      tax_id: '01234567890',
      sdi: 'abc1234',
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.value.email, 'anna@example.it')
      assert.equal(ok.value.packageKey, 'video_map')
      assert.equal(ok.value.sdi, 'ABC1234')
      assert.equal(ok.value.phone, null)
    }
    assert.equal(parseSalesQuotePayload({ company: 'X', contact_name: 'Y', email: 'no', tax_id: '1' }).ok, false)
    assert.equal(parseSalesQuotePayload({ contact_name: 'Y', email: 'a@b.it', tax_id: '1' }).ok, false)
    assert.equal(
      parseSalesQuotePayload({ company: 'X', contact_name: 'Y', email: 'a@b.it', tax_id: '1', package_key: 'boh' }).ok,
      false
    )
  })

  test('escapeLike neutralizza i jolly', () => {
    assert.equal(escapeLike('mario_rossi%@x.it'), 'mario\\_rossi\\%@x.it')
  })
})
