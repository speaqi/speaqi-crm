import assert from 'node:assert/strict'
import { describe, test, mock } from 'node:test'
import { financeClosedMonth, financeContactCorrection, financeReminder, officeRomeDay, type FinanceQuote } from '../src/lib/office/finance'
import { financeHandler } from '../src/lib/server/office-agents/finance'
import { OFFICE_AGENT_DEFINITIONS, ensureOfficeAgents } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import type { InvoiceRow } from '../src/lib/server/invoices'
import type { CRMContact } from '../src/types'
import { inspectAutomaticDraft } from '../src/lib/server/automation-send'
import { FakeSupabase } from './fake-supabase'

const OWNER = 'owner'
const NOW = new Date('2026-11-01T09:00:00Z')
const contact: CRMContact = { id: 'contact', user_id: OWNER, name: 'Referente', email: 'ufficio@example.it', company: 'Ente', status: 'Quote', priority: 1,
  billing_zip: '80067', billing_city: 'Sorrento (NA)', billing_address: 'Corso Italia 1', billing_sdi: 'M5UXCR1', billing_tax_id: '10831191217', created_at: '2026-01-01', updated_at: '2026-01-01' }
const quote = (patch: Partial<FinanceQuote> = {}): FinanceQuote => ({ id: 'q', user_id: OWNER, quote_number: 'PRV-2026-42', contact_id: contact.id, status: 'paid', payment_state: 'paid', total_amount: 100,
  paid_at: '2026-10-31T22:00:00Z', created_at: '2026-09-01T00:00:00Z', ...patch })
const settings = { user_id: OWNER, denominazione: 'TheBestItaly', partita_iva: '10831191217', codice_fiscale: '95125440636', regime_fiscale: 'RF01', indirizzo: 'Via 1', cap: '80100', comune: 'Napoli', provincia: 'NA', nazione: 'IT', iban: null, natura_esente: null, bollo_virtuale: false, causale_extra: null, numero_formato: '{n}' }
const invoice = (patch: Partial<InvoiceRow> = {}): InvoiceRow => ({ id: 'i', user_id: OWNER, quote_id: 'q', contact_id: contact.id, source: 'quote', stripe_invoice_id: null, status: 'draft', year: null, number: null, numero: null, issue_date: '2026-10-01', customer: { denominazione: 'Ente', partitaIva: '10831191217', codiceFiscale: null, codiceDestinatario: null, pec: null, indirizzo: '', cap: '', comune: '', provincia: null, nazione: 'IT' },
  lines: [{ description: 'Servizio', quantity: 1, unitPrice: 100, vatRate: 22 }], payment_method: 'MP05', causale: null, imponibile: 100, imposta: 22, totale: 122, warnings: [], xml: null, send_attempts: 0, aruba_env: null, aruba_filename: null, sdi_status: null, sdi_detail: null, last_error: null, sent_at: null, last_synced_at: null, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z', ...patch })

function fixture() {
  const db = new FakeSupabase({ quotes: [quote()], invoices: [], invoice_settings: [settings], contacts: [contact], email_drafts: [], office_agent_outputs: [] })
  db.rpcs.create_office_email_draft = (args) => {
    const old = db.tables.email_drafts.find((d) => d.office_key === args.p_key)
    if (old) return { id: old.id, created: false }
    if (db.tables.email_drafts.some((d) => d.contact_id === args.p_contact_id && d.status === 'pending')) return { id: null, created: false }
    const row = { id: 'draft', user_id: OWNER, contact_id: args.p_contact_id, source: 'office', status: 'pending', office_key: args.p_key }
    db.tables.email_drafts.push(row)
    return { id: row.id, created: true }
  }
  const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.finance, user_id: OWNER }, runId: 'run',
    async reserve() { assert.fail('Finanza deterministica non deve chiamare modelli') }, async settle() { assert.fail() }, log() {},
    async addOutput(output) { const row = { id: db.nextId('output'), agent_id: 'finance', user_id: OWNER, output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id },
  }
  return { db, ctx }
}

describe('Finanza: regole pure', () => {
  test('mese italiano, capodanno, somme in centesimi e rinnovi con fonti', () => {
    assert.equal(officeRomeDay(new Date('2026-10-31T23:30:00Z')), '2026-11-01')
    const result = financeClosedMonth([quote({ total_amount: 0.1 }), quote({ id: 'q2', total_amount: 0.2 }), quote({ id: 'fuori', total_amount: 999, paid_at: '2026-10-31T23:30:00Z' })], [invoice({ status: 'sent', totale: 0.1, sent_at: '2026-10-31T22:00:00Z' }), invoice({ id: 'r', source: 'stripe_renewal', totale: 10, created_at: '2026-10-05T10:00:00Z' })], NOW)
    assert.equal(result.month, '2026-10'); assert.equal(result.incassato_registrato_cents, 1030); assert.equal(result.fatturato_cents, 10); assert.equal(result.differenza_cents, 1020)
    assert.deepEqual(result.sources.paid_quote_ids, ['q', 'q2']); assert.deepEqual(result.sources.renewal_invoice_ids, ['r'])
    assert.equal(financeClosedMonth([], [], new Date('2027-01-01T08:00:00Z')).month, '2026-12')
    assert.equal(financeClosedMonth([], [], new Date('2026-10-31T22:30:00Z')).is_first_day, false)
  })
  test('correzioni solo dal contatto, senza sovrascrivere dati validi o indovinare il paese', () => {
    const customer = invoice().customer
    const patch = financeContactCorrection({ ...customer, cap: '00100' }, contact)
    assert.equal(patch.cap, undefined); assert.equal(patch.indirizzo, contact.billing_address); assert.equal(patch.provincia, 'NA'); assert.equal(patch.nazione, undefined)
    assert.equal(financeContactCorrection(customer, { ...contact, billing_zip: 'errato' }).cap, undefined)
    assert.equal(financeContactCorrection(customer, { ...contact, billing_sdi: null, billing_pec: null }).codiceDestinatario, undefined)
  })
  test('bonifico oltre 15 giorni, Stripe fallito, esclusioni e chiave stabile', () => {
    const bank = quote({ status: 'accepted', payment_state: 'pending', payment_method: 'bank_transfer', accepted_at: '2026-10-01T08:00:00Z' })
    const reminder = financeReminder(bank, contact, NOW)
    assert.ok(reminder); assert.match(reminder.note, /PRV-2026-42/)
    assert.equal(financeReminder({ ...bank, accepted_at: NOW.toISOString() }, contact, NOW), null)
    assert.equal(financeReminder(bank, { ...contact, hidden: true }, NOW), null)
    assert.equal(financeReminder(bank, { ...contact, email_unsubscribed_at: NOW.toISOString() }, NOW), null)
    assert.equal(financeReminder(quote({ subscription_status: 'active' }), contact, NOW), null)
    assert.equal(financeReminder(quote({ subscription_status: 'past_due', updated_at: '2026-10-05' }), contact, NOW)?.key, financeReminder(quote({ subscription_status: 'past_due', updated_at: '2026-10-06' }), contact, NOW)?.key)
  })
})

describe('Finanza: compito senza invii', () => {
  test('riusa la bozza fattura, non duplica report e propone correzioni con fonte', async () => {
    const { db, ctx } = fixture()
    const fetch = mock.method(globalThis, 'fetch', async () => { assert.fail('Nessuna chiamata esterna, nemmeno Aruba upload') })
    try {
      const run = financeHandler(db, () => NOW)
      await run(ctx); await run(ctx)
      assert.equal(db.tables.invoices.length, 1); assert.equal(db.tables.invoices[0].status, 'draft')
      assert.equal(db.tables.invoices[0].number, undefined)
      assert.equal(db.tables.office_agent_outputs.filter((o) => o.kind === 'report').length, 2)
      assert.equal(fetch.mock.callCount(), 0)
      const first = fixture(); first.db.tables.invoices = [invoice()]
      await financeHandler(first.db, () => NOW)(first.ctx)
      const fix = first.db.tables.office_agent_outputs.find((o) => o.kind === 'data_fix')
      assert.equal(fix?.body.fonte.id, contact.id); assert.equal(fix?.body.proposta.cap, contact.billing_zip)
      assert.equal(first.db.tables.invoices[0].customer.cap, '')
    } finally { fetch.mock.restore() }
  })
  test('solleciti idempotenti e mai candidati all’invio automatico', async () => {
    const { db, ctx } = fixture()
    db.tables.quotes = [quote({ status: 'accepted', payment_state: 'pending', payment_method: 'bank_transfer', accepted_at: '2026-10-01T08:00:00Z' })]
    const run = financeHandler(db, () => NOW)
    await run(ctx); await run(ctx)
    assert.equal(db.tables.email_drafts.length, 1)
    const result = await inspectAutomaticDraft(db, { workspaceUserId: OWNER, senderUserId: OWNER, timezone: 'Europe/Rome' }, 'draft', 0)
    assert.equal(result.result?.reason, 'manual_draft')
  })
  test('l’installazione e idempotente e non riaccende né cambia i budget del titolare', async () => {
    const old = process.env.AUTOMATION_WORKSPACE_USER_ID; process.env.AUTOMATION_WORKSPACE_USER_ID = OWNER
    const db = new FakeSupabase({ office_agents: [] })
    try {
      await ensureOfficeAgents(db, OWNER)
      db.tables.office_agents[0].enabled = true; db.tables.office_agents[0].daily_budget_cents = 8
      await ensureOfficeAgents(db, OWNER)
      assert.equal(db.tables.office_agents.length, 1); assert.equal(db.tables.office_agents[0].enabled, true); assert.equal(db.tables.office_agents[0].daily_budget_cents, 8)
      await ensureOfficeAgents(db, 'altro'); assert.equal(db.tables.office_agents.length, 1)
    } finally { if (old === undefined) delete process.env.AUTOMATION_WORKSPACE_USER_ID; else process.env.AUTOMATION_WORKSPACE_USER_ID = old }
  })
})

test('tutti gli esiti SDI e i solleciti Stripe restano senza chiamate Aruba o invii', async () => {
  const { db, ctx } = fixture()
  db.tables.quotes = [quote({ subscription_status: 'past_due' })]
  db.tables.invoices = [invoice({ status: 'rejected', sdi_detail: 'CAP non valido' }), invoice({ id: 'non-consegnata', quote_id: null, source: 'manual', status: 'not_delivered' })]
  const fetch = mock.method(globalThis, 'fetch', async () => { assert.fail('Nessuna chiamata di rete autorizzata dal compito Finanza') })
  try {
    await financeHandler(db, () => new Date('2026-11-02T08:30:00Z'))(ctx)
    const report = db.tables.office_agent_outputs.find((row) => row.kind === 'report')
    assert.ok(report)
    assert.equal(report.body.esiti_sdi.length, 2)
    assert.match(report.body.esiti_sdi[0].explanation, /CAP non valido/)
    assert.equal(db.tables.email_drafts.length, 1)
    assert.equal(fetch.mock.callCount(), 0)
    assert.ok(!db.tables.office_agent_outputs.some((row) => row.title.startsWith('Mese chiuso')))
  } finally { fetch.mock.restore() }
})
