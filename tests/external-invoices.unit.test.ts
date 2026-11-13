import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeSupabase } from './fake-supabase'
import { reconcileInvoiceRecord } from '../src/lib/server/external-invoices'
const base = { id:'i1',user_id:'u1',status:'draft',number:null,numero:null,issue_date:'2026-01-01',send_attempts:0,externally_issued:false,aruba_env:null,aruba_filename:null,totale:100 }
const input = { number:'12/2026',issued:'2026-01-03',paymentState:'paid',paidAt:'2026-01-05',total:100 }
test('riconcilia una bozza una sola volta senza invii e conserva lo storico', async () => {
  const db = new FakeSupabase({ invoices:[{...base}] })
  const result = await reconcileInvoiceRecord(db,'u1','i1',input)
  assert.equal(result.ok,true)
  const invoice = db.tables.invoices[0]
  assert.equal(invoice.status,'sent'); assert.equal(invoice.externally_issued,true); assert.equal(invoice.payment_state,'paid'); assert.equal(invoice.paid_at,'2026-01-05'); assert.equal(invoice.number,null); assert.equal(invoice.external_snapshot.status,'draft')
  assert.equal((await reconcileInvoiceRecord(db,'u1','i1',input)).ok,false)
  assert.equal(db.calls.length,0)
})
test('non sovrascrive fatture numerate o già inviate; riconosce XML numerato manuale solo con stessi dati', async () => {
  const db = new FakeSupabase({ invoices:[{...base,status:'sent',number:12,numero:'12/2026',aruba_env:'manual',issue_date:'2026-01-03',send_attempts:1}] })
  assert.equal((await reconcileInvoiceRecord(db,'u1','i1',{...input,number:'13'})).ok,false)
  const ok = await reconcileInvoiceRecord(db,'u1','i1',input)
  assert.equal(ok.ok,true); assert.equal(db.tables.invoices[0].number,12); assert.equal(db.tables.invoices[0].numero,'12/2026')
  const sent = new FakeSupabase({ invoices:[{...base,status:'sent',number:12,aruba_env:'production',aruba_filename:'file'}] })
  assert.equal((await reconcileInvoiceRecord(sent,'u1','i1',input)).ok,false)
  assert.equal((await reconcileInvoiceRecord(sent,'other','i1',input)).ok,false)
})
