import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWaiting,
  clientHeadline,
  countMapStages,
  findMapRow,
  formatEuroPlain,
  mergeMapStatus,
  searchPattern,
  summarizeMoney,
  type MoneyQuote,
} from '../src/lib/command-center'

const NOW = new Date('2026-10-22T10:00:00Z')

function quote(overrides: Partial<MoneyQuote>): MoneyQuote {
  return { id: 'q', quote_number: 'PRV-1', status: 'sent', total_amount: 488, ...overrides }
}

describe('command center', () => {
  it('soldi: incassato del mese, da fatturare, rinnovi e pagamenti falliti', () => {
    const quotes = [
      quote({ id: 'a', status: 'paid', paid_at: '2026-10-05T09:00:00Z', customer_company: 'Hotel A' }),
      quote({ id: 'b', status: 'paid', paid_at: '2026-09-30T23:30:00Z', total_amount: 990 }), // 1 ottobre in Italia
      quote({ id: 'c', status: 'paid', paid_at: '2026-09-10T09:00:00Z', total_amount: 100 }),
      quote({ id: 'd', status: 'paid', paid_at: '2026-08-01T09:00:00Z', billing_interval: 'year', subscription_status: 'active', current_period_end: '2026-11-10T00:00:00Z' }),
      quote({ id: 'e', status: 'paid', paid_at: '2026-01-01T09:00:00Z', billing_interval: 'year', subscription_status: 'past_due', current_period_end: '2027-01-01T00:00:00Z' }),
      quote({ id: 'f', status: 'cancelled', paid_at: '2026-10-02T09:00:00Z' }),
    ]
    const invoices = [
      { id: 'i1', quote_id: 'c', source: 'quote', status: 'delivered', totale: 100, sent_at: '2026-10-03T09:00:00Z' },
      { id: 'i2', quote_id: 'd', source: 'quote', status: 'draft', totale: 488, sent_at: null },
    ]
    const money = summarizeMoney(quotes, invoices, NOW)
    assert.equal(money.paid_month, 1478)
    assert.equal(money.paid_month_count, 2)
    assert.equal(money.invoiced_month, 100)
    assert.deepEqual(money.to_invoice.map((q) => q.id).sort(), ['a', 'b', 'e'])
    assert.deepEqual(money.renewals.map((r) => r.id), ['d'])
    assert.deepEqual(money.past_due.map((q) => q.id), ['e'])
  })

  it('aspetta te: prima i guasti, poi le cose da fare', () => {
    const items = buildWaiting({
      invoices: [
        { id: '1', quote_id: null, source: 'quote', status: 'draft', totale: 488, customer: { denominazione: 'Hotel A' } },
        { id: '2', quote_id: null, source: 'quote', status: 'rejected', totale: 100, numero: '3', customer: { denominazione: 'B' } },
        { id: '3', quote_id: null, source: 'quote', status: 'delivered', totale: 100 },
      ],
      presentations: [{ id: 'p', title: 'Sito Rossi', status: 'ready' }, { id: 'p2', title: 'x', status: 'draft' }],
      decks: [],
      pastDue: [{ id: 'q', label: 'Hotel C', contact_id: 'c1' }],
      toInvoiceCount: 2,
    })
    assert.deepEqual(items.map((i) => i.kind), ['past_due', 'invoice_problem', 'invoice_draft', 'to_invoice', 'presentation'])
    assert.equal(items[0].href, '/scheda/c1')
    assert.match(items[2].detail, /488 €/)
  })

  it('mappe: StudioMap e Speaqi uniti per id, le guide fuori catalogo restano', () => {
    const rows = mergeMapStatus(
      [
        { slug: 'capri', name: 'Capri', status: 'su_speaqi', places: 120, ready_places: 100, speaqi_map_id: 'm-capri' },
        { slug: 'bari', name: 'Bari', status: 'pronta', places: 40, ready_places: 35, speaqi_map_id: null },
        { slug: 'lecce', name: 'Lecce', status: 'in_lavorazione', places: 10, ready_places: 2, speaqi_map_id: null },
      ],
      [
        { id: 'm-capri', slug: 'caprispeaqiguide', name: 'Capri', is_paid: true, price_cents: 990, points: 105 },
        { id: 'm-napoli', slug: 'napolimap', name: 'Napoli', is_paid: true, price_cents: 990, points: 430 },
      ]
    )
    assert.deepEqual(rows.map((r) => [r.name, r.stage]), [['Capri', 'online'], ['Napoli', 'online'], ['Bari', 'pronta'], ['Lecce', 'in_lavorazione']])
    assert.equal(rows[0].places, 105)
    assert.deepEqual(countMapStages(rows), { online: 2, su_speaqi: 0, pronta: 1, in_lavorazione: 1 })
    assert.equal(findMapRow(rows, 'capri')?.speaqi_slug, 'caprispeaqiguide')
    assert.equal(findMapRow(rows, 'caprispeaqiguide')?.name, 'Capri')
    assert.equal(findMapRow(rows, 'NAPOLI')?.speaqi_slug, 'napolimap')
    assert.equal(findMapRow(rows, 'roma'), null)
  })

  it('senza StudioMap si vedono comunque le guide online', () => {
    const rows = mergeMapStatus(null, [{ id: 'x', slug: 'roma', name: 'Roma', is_paid: false, price_cents: null, points: 50 }])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].stage, 'online')
  })

  it('la ricerca non lascia passare la sintassi di PostgREST', () => {
    assert.equal(searchPattern('Hotel, (Bella)%vista'), '%Hotel Bella vista%')
    assert.equal(searchPattern(' a '), null)
  })

  it('stato del cliente in una frase', () => {
    assert.equal(clientHeadline({ status: 'quote', openDeal: null, quotes: [quote({ status: 'sent' })], signedQuoteIds: 1 }), 'Ha firmato, manca il pagamento.')
    assert.equal(clientHeadline({ status: 'paid', openDeal: null, quotes: [quote({ status: 'paid', billing_interval: 'year', subscription_status: 'active' })], signedQuoteIds: 1 }), 'Cliente con abbonamento attivo.')
    assert.equal(clientHeadline({ status: 'new', openDeal: { stage: 'contacted' }, quotes: [], signedQuoteIds: 0 }), 'Trattativa aperta, fase contacted.')
  })

  it('euro', () => {
    assert.equal(formatEuroPlain(1478), '1.478 €')
    assert.equal(formatEuroPlain(12.5), '12,50 €')
  })
})
