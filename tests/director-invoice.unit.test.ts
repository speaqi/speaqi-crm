import assert from 'node:assert/strict'
import test from 'node:test'
import { invoiceFor } from '../src/lib/server/office-director-orders'
import { invoiceOnAcceptance } from '../src/lib/server/quote-acceptance-invoice'
import { FakeSupabase } from './fake-supabase'

const USER = 'owner'
const quote = (patch: Record<string, unknown> = {}) => ({
  id: 'q1', user_id: USER, quote_number: 'PREV-20260922-1B14FC', title: 'Offerta Speaqi', customer_name: 'Rosario Piscitelli', customer_company: 'SNAV SPA',
  customer_email: 'r@snav.it', total_amount: 1464, subtotal_amount: 1200, tax_rate: 22, discount_amount: 0, deposit_amount: 0, balance_amount: 0,
  items: [{ title: 'Mappa', quantity: 1, unit_price: 1200 }], status: 'sent', payment_state: 'pending', payment_method: 'bank_transfer',
  billing_interval: 'one_time', contact_id: 'c1', accepted_at: null, ...patch,
})
const db = (q = quote()) => new FakeSupabase({ quotes: [q], invoices: [], invoice_settings: [], contacts: [{ id: 'c1', user_id: USER, name: 'Rosario Piscitelli' }], activities: [] })
const plan = (patch: Record<string, unknown> = {}) => ({ intent: 'invoice' as const, quote_number: 'PREV-20260922-1B14FC', customer: null, approved: false, ...patch })

test('preventivo inviato e non approvato: niente fattura, si dice come dare l’ok', async () => {
  const d = db()
  const out = await invoiceFor(d, USER, plan())
  assert.equal(out.status, 'waiting_you')
  assert.match(out.reply, /inviato, non ancora approvato/)
  assert.match(out.reply, /SNAV SPA ha approvato PREV-20260922-1B14FC, fai la fattura/)
  assert.equal(d.tables.invoices.length, 0)
  assert.equal(d.tables.quotes[0].status, 'sent')
})

test('«SNAV ha approvato, fai la fattura»: accettato, bozza pronta, niente SDI, una volta sola', async () => {
  const d = db()
  const out = await invoiceFor(d, USER, plan({ approved: true }))
  assert.equal(out.status, 'done')
  assert.equal(d.tables.quotes[0].status, 'accepted')
  assert.ok(d.tables.quotes[0].accepted_at)
  assert.equal(d.tables.invoices.length, 1)
  assert.equal(d.tables.invoices[0].status, 'draft')
  assert.match(out.reply, /segnato come accettato/)
  assert.match(out.reply, /Non l’ho inviata/)
  assert.equal(d.tables.activities.length, 1)
  const again = await invoiceFor(d, USER, plan({ approved: true }))
  assert.equal(d.tables.invoices.length, 1)
  assert.doesNotMatch(again.reply, /segnato come accettato/)
  assert.match(again.reply, /c’era già/)
})

test('un abbonamento con carta non si fattura prima del pagamento', async () => {
  const d = db(quote({ billing_interval: 'year', payment_method: 'stripe' }))
  const out = await invoiceFor(d, USER, plan({ approved: true }))
  assert.match(out.reply, /abbonamento con carta/)
  assert.equal(d.tables.invoices.length, 0)
  assert.equal(d.tables.quotes[0].status, 'sent')
})

test('numero sbagliato: si mostrano i preventivi in attesa', async () => {
  const d = db()
  const out = await invoiceFor(d, USER, plan({ quote_number: 'PREV-20260101-AAAAAA' }))
  assert.match(out.reply, /Quelli in attesa sono:\n• PREV-20260922-1B14FC \(SNAV SPA, 1\.464 €\)/)
})

test('accettato dal link o nella scheda: la bozza nasce da sola; non per gli abbonamenti, non due volte', async () => {
  const old = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_NOTIFY_CHAT_ID }
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_NOTIFY_CHAT_ID
  try {
    const d = db(quote({ status: 'accepted', public_token: 'tok' }))
    const first = await invoiceOnAcceptance(d, { publicToken: 'tok' }, 'firma')
    assert.ok(first?.invoiceId)
    assert.equal(first?.sent, false)
    assert.equal(d.tables.invoices.length, 1)
    assert.equal((await invoiceOnAcceptance(d, { quoteId: 'q1' }, 'scheda'))?.invoiceId, first?.invoiceId)
    assert.equal(d.tables.invoices.length, 1)
    const sent = db()
    assert.equal(await invoiceOnAcceptance(sent, { quoteId: 'q1' }, 'scheda'), null)
    const sub = db(quote({ status: 'accepted', billing_interval: 'year' }))
    assert.equal(await invoiceOnAcceptance(sub, { quoteId: 'q1' }, 'scheda'), null)
  } finally {
    if (old.token !== undefined) process.env.TELEGRAM_BOT_TOKEN = old.token
    if (old.chat !== undefined) process.env.TELEGRAM_NOTIFY_CHAT_ID = old.chat
  }
})
