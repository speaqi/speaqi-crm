import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQuoteRecord, QuoteInputError } from '../src/lib/server/quote-create'
import { defaultQuoteTemplate, quoteDraftFromTemplate } from '../src/lib/commercial-proposal'

test('creazione: legame Tourism e contratto entrano nello stesso INSERT del preventivo', async () => {
  let inserted: Record<string, any> | null = null
  const sb = {
    from(table: string) {
      assert.equal(table, 'quotes')
      const query: any = {
        insert(payload: Record<string, any>) { inserted = payload; return query },
        select() { return query }, eq() { return query },
        async single() { return { data: { id: 'quote-id' }, error: null } },
        async maybeSingle() { return { data: { id: 'quote-id', ...inserted }, error: null } }
      }
      return query
    }
  }
  const draft = quoteDraftFromTemplate({ ...defaultQuoteTemplate('tourism'), contract_terms: 'Testo approvato', items: [{ description: 'Servizio', details: 'Perimetro concordato', quantity: 1, unit_price: 990 }] }, {})
  const saved = await createQuoteRecord(sb, 'owner', null, { ...draft, customer_name: 'Alfa' }, { tourismDeckId: 'deck-id' })
  assert.equal(saved.tourism_deck_id, 'deck-id')
  assert.equal(saved.contract_terms, 'Testo approvato')
  assert.equal(saved.status, 'draft')
  assert.equal(saved.total_amount, 1207.8)
})

test('un contratto incompleto si salva in bozza ma si rifiuta prima di scrivere se inviato', async () => {
  let writes = 0
  const sb = { from() { writes++; throw new Error('Non deve scrivere') } }
  const draft = { customer_name: 'Alfa', items: [{ description: 'Servizio', quantity: 1, unit_price: 10 }], contract_terms: '[DA VERIFICARE]', status: 'sent' }
  await assert.rejects(createQuoteRecord(sb, 'owner', null, draft), QuoteInputError)
  assert.equal(writes, 0)
})
