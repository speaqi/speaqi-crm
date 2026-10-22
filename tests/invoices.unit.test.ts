import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FakeSupabase } from './fake-supabase'
import { mapArubaStatus } from '../src/lib/server/aruba-fe'
import {
  createInvoiceDraftFromQuote,
  customerFromQuote,
  formatNumero,
  sendInvoice,
  splitTaxId,
  syncInvoiceStatuses,
} from '../src/lib/server/invoices'

const OWNER = 'owner-1'

const settingsRow = {
  user_id: OWNER,
  denominazione: 'TheBestItaly',
  partita_iva: '10831191217',
  codice_fiscale: '95125440636',
  regime_fiscale: 'RF01',
  indirizzo: 'Via Toledo 1',
  cap: '80134',
  comune: 'Napoli',
  provincia: 'NA',
  nazione: 'IT',
  iban: null,
  natura_esente: null,
  bollo_virtuale: false,
  causale_extra: null,
  numero_formato: '{n}/{yyyy}',
}

const quoteRow = {
  id: 'q-1',
  user_id: OWNER,
  contact_id: 'c-1',
  quote_number: 'PRV-2026-0042',
  title: 'Video nella mappa',
  customer_name: 'Mario Rossi',
  customer_company: 'Hotel Bellavista S.r.l.',
  customer_tax_id: '01234567897',
  customer_sdi: 'M5UXCR1',
  customer_pec: null,
  customer_address: 'Corso Italia 10',
  customer_zip: '80067',
  customer_city: 'Sorrento (NA)',
  items: [{ description: 'Video nella mappa', quantity: 1, unit_price: 400 }],
  tax_rate: 22,
  discount_amount: 0,
  total_amount: 488,
  deposit_amount: 488,
  balance_amount: 0,
  payment_method: 'stripe',
}

function db() {
  let counter = 0
  return new FakeSupabase(
    {
      invoice_settings: [{ ...settingsRow }],
      quotes: [{ ...quoteRow }],
      contacts: [{ id: 'c-1', name: 'Mario Rossi' }],
      invoices: [],
    },
    { reserve_invoice_number: () => (counter += 1) + 6 }
  )
}

type FetchCall = { url: string; init?: RequestInit }
let calls: FetchCall[] = []
let uploadReply: () => Response
const realFetch = globalThis.fetch

beforeEach(() => {
  calls = []
  process.env.ARUBA_FE_USERNAME = 'utente'
  process.env.ARUBA_FE_PASSWORD = 'segreto'
  delete process.env.ARUBA_FE_ENV
  uploadReply = () => Response.json({ errorCode: '0000', errorDescription: null, uploadFileName: 'IT10831191217_abc12.xml.p7m' })
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/auth/signin')) return Response.json({ access_token: 'tok', expires_in: 1800 })
    if (String(url).includes('/services/invoice/upload')) return uploadReply()
    if (String(url).includes('getByFilename')) return Response.json({ idSdi: '123', invoices: [{ status: 'Consegnata', statusDescription: null }] })
    throw new Error(`fetch inatteso ${url}`)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('invoices', () => {
  it('riconosce partita IVA e codice fiscale dal campo unico del preventivo', () => {
    assert.deepEqual(splitTaxId('IT01234567897'), { partitaIva: '01234567897', codiceFiscale: null })
    assert.deepEqual(splitTaxId('rssmra80a01f839w'), { partitaIva: null, codiceFiscale: 'RSSMRA80A01F839W' })
    assert.deepEqual(splitTaxId(''), { partitaIva: null, codiceFiscale: null })
  })

  it('formato del numero', () => {
    assert.equal(formatNumero('{n}/{yyyy}', 12, 2026), '12/2026')
    assert.equal(formatNumero('FPR {n}/{yy}', 3, 2026), 'FPR 3/26')
    assert.equal(formatNumero('', 5, 2026), '5')
  })

  it('cliente dal preventivo, provincia dal comune', () => {
    const customer = customerFromQuote(quoteRow)
    assert.equal(customer.denominazione, 'Hotel Bellavista S.r.l.')
    assert.equal(customer.partitaIva, '01234567897')
    assert.equal(customer.comune, 'Sorrento')
    assert.equal(customer.provincia, 'NA')
    assert.equal(customer.codiceDestinatario, 'M5UXCR1')
  })

  it('una bozza per preventivo, anche chiamando due volte', async () => {
    const fake = db()
    const first = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1', { viaStripe: true })
    const second = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1', { viaStripe: true })
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(fake.tables.invoices.length, 1)
    assert.equal(first.invoice.payment_method, 'MP08')
    assert.equal(Number(first.invoice.totale), 488)
    assert.deepEqual(first.invoice.warnings, [])
  })

  it('rinnovo: una fattura per incasso Stripe', async () => {
    const fake = db()
    await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1', { viaStripe: true })
    const renewal = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1', { stripeInvoiceId: 'in_2', grossAmount: 488, periodEnd: '2027-10-22T00:00:00Z' })
    const again = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1', { stripeInvoiceId: 'in_2', grossAmount: 488 })
    assert.equal(renewal.created, true)
    assert.equal(again.created, false)
    assert.equal(renewal.invoice.source, 'stripe_renewal')
    assert.match(renewal.invoice.causale || '', /Rinnovo abbonamento/)
    assert.equal(fake.tables.invoices.length, 2)
  })

  it('invio: numero dopo i controlli, XML ad Aruba demo, stato inviata', async () => {
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    const result = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(result.ok, true)
    const sent = fake.tables.invoices[0]
    assert.equal(sent.status, 'sent')
    assert.equal(sent.numero, '7/2026')
    assert.equal(sent.aruba_env, 'demo')
    assert.equal(sent.aruba_filename, 'IT10831191217_abc12.xml.p7m')
    const upload = calls.find((call) => call.url.includes('/services/invoice/upload'))!
    assert.ok(upload.url.startsWith('https://demows.'))
    const xml = Buffer.from(JSON.parse(String(upload.init?.body)).dataFile, 'base64').toString('utf8')
    assert.match(xml, /<Numero>7\/2026<\/Numero>/)
    assert.match(xml, /<ImportoTotaleDocumento>488\.00<\/ImportoTotaleDocumento>/)
  })

  it('invio a mano: numero e XML definitivi, nessuna chiamata ad Aruba, lo stato SDI non la rilegge', async () => {
    delete process.env.ARUBA_FE_PASSWORD
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    const result = await sendInvoice(fake as any, OWNER, invoice.id, { manual: true })
    assert.equal(result.ok, true)
    const prepared = fake.tables.invoices[0]
    assert.equal(prepared.status, 'sent')
    assert.equal(prepared.numero, '7/2026')
    assert.equal(prepared.aruba_env, 'manual')
    assert.equal(prepared.aruba_filename, null)
    assert.match(prepared.xml, /<Numero>7\/2026<\/Numero>/)
    assert.equal(calls.length, 0)
    const again = await sendInvoice(fake as any, OWNER, invoice.id, { manual: true })
    assert.equal(again.ok, false)
  })

  it('un secondo invio della stessa fattura viene fermato', async () => {
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    await sendInvoice(fake as any, OWNER, invoice.id)
    const second = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(second.ok, false)
    assert.equal(calls.filter((call) => call.url.includes('/upload')).length, 1)
  })

  it('dati incompleti: nessun numero consumato, nessuna chiamata ad Aruba', async () => {
    const fake = db()
    fake.tables.quotes[0].customer_zip = ''
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    const result = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.problems?.some((p) => p.includes('CAP')))
    assert.equal(fake.tables.invoices[0].number ?? null, null)
    assert.equal(fake.calls.length, 0)
    assert.equal(calls.length, 0)
  })

  it('Aruba rifiuta: il numero resta alla fattura e il reinvio usa lo stesso numero', async () => {
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    uploadReply = () => Response.json({ errorCode: '0094', errorDescription: 'File non valido' })
    const failed = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(failed.ok, false)
    assert.equal(fake.tables.invoices[0].status, 'error')
    assert.equal(fake.tables.invoices[0].numero, '7/2026')
    assert.match(fake.tables.invoices[0].last_error, /0094/)

    uploadReply = () => Response.json({ errorCode: '0000', uploadFileName: 'IT_x.xml.p7m' })
    const retried = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(retried.ok, true)
    assert.equal(fake.tables.invoices[0].numero, '7/2026')
    assert.equal(fake.calls.filter((call) => call.rpc === 'reserve_invoice_number').length, 1)
    assert.equal(fake.tables.invoices[0].send_attempts, 2)
  })

  it('senza credenziali Aruba non parte niente', async () => {
    delete process.env.ARUBA_FE_PASSWORD
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    const result = await sendInvoice(fake as any, OWNER, invoice.id)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.status, 503)
  })

  it('stato SDI: consegnata', async () => {
    const fake = db()
    const { invoice } = await createInvoiceDraftFromQuote(fake as any, OWNER, 'q-1')
    await sendInvoice(fake as any, OWNER, invoice.id)
    const result = await syncInvoiceStatuses(fake as any)
    assert.equal(result.checked, 1)
    assert.equal(fake.tables.invoices[0].status, 'delivered')
    assert.equal(fake.tables.invoices[0].sdi_status, 'Consegnata')
  })

  it('stato SDI: al primo 429 si ferma, e non rilegge una fattura appena controllata', async () => {
    const fake = db()
    for (const id of ['a', 'b', 'c']) {
      fake.tables.invoices.push({ id, user_id: OWNER, status: 'sent', aruba_filename: `f-${id}`, aruba_env: 'demo', sent_at: new Date().toISOString(), last_synced_at: null })
    }
    fake.tables.invoices.push({ id: 'd', user_id: OWNER, status: 'sent', aruba_filename: 'f-d', aruba_env: 'demo', sent_at: new Date().toISOString(), last_synced_at: new Date().toISOString() })
    let lookups = 0
    globalThis.fetch = (async (url: string) => {
      if (String(url).endsWith('/auth/signin')) return Response.json({ access_token: 'tok', expires_in: 1800 })
      lookups += 1
      return new Response('', { status: 429 })
    }) as typeof fetch
    const result = await syncInvoiceStatuses(fake as any, 8, 0)
    assert.equal(result.rate_limited, true)
    assert.equal(lookups, 1)
    assert.equal(result.checked, 1)
  })

  it('stati Aruba -> stati del CRM', () => {
    assert.equal(mapArubaStatus('Recapito impossibile'), 'not_delivered')
    assert.equal(mapArubaStatus('Presa in carico'), 'sent')
    assert.equal(mapArubaStatus('Errore elaborazione'), 'error')
    assert.equal(mapArubaStatus('Scartata'), 'rejected')
    assert.equal(mapArubaStatus('Consegnata'), 'delivered')
    assert.equal(mapArubaStatus('Non consegnata'), 'not_delivered')
    assert.equal(mapArubaStatus('Decorrenza termini'), 'delivered')
    assert.equal(mapArubaStatus('Accettata'), 'accepted')
    assert.equal(mapArubaStatus('Rifiutata'), 'refused')
    assert.equal(mapArubaStatus('Inviata'), 'sent')
  })
})
