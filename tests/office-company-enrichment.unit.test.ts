import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  companyCandidates, isCompanyMailbox, isDistributingCompany, validateCompanyEnrichment, type EnrichCompany, type ModelCompanyEnrichment,
} from '../src/lib/office/entity-enricher'
import { entityEnricherHandler } from '../src/lib/server/office-agents/entity-enricher'
import { approveEnrichedCompany } from '../src/lib/server/office-company-enrichment'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

const OWNER = 'owner'
const HOME = 'https://www.dimorra.example/'
const CONTACT = 'https://www.dimorra.example/contatti'
const company = (patch: Partial<EnrichCompany> = {}): EnrichCompany => ({ id: 'co-1', name: 'Dimorra', country_code: 'IT', type_code: 'property_manager',
  aliases: [], website: HOME, email: null, phone: null, status: 'UNVERIFIED', disabled: false, details: { employees: 30 }, version: 1, ...patch })
const pages = [
  { url: HOME, text: 'Dimorra gestisce affitti brevi e case vacanza a Napoli e in Campania.' },
  { url: CONTACT, text: 'Scrivici: info@dimorra.example\nTelefono: +39 081 123 4567\nIl titolare segue le partnership.\nmario.rossi@dimorra.example' },
]
const model = (patch: Partial<ModelCompanyEnrichment> = {}): ModelCompanyEnrichment => ({
  identity_quote: 'Dimorra gestisce affitti brevi e case vacanza a Napoli e in Campania.', identity_url: HOME,
  email: 'info@dimorra.example', email_quote: 'Scrivici: info@dimorra.example', email_url: CONTACT,
  phone: '+39 081 123 4567', phone_quote: 'Telefono: +39 081 123 4567', phone_url: CONTACT,
  decision_maker_type: 'titolare', decision_maker_quote: 'Il titolare segue le partnership.', decision_maker_url: CONTACT, ...patch })

describe('Arricchimento aziende: regole pure', () => {
  test('solo chi distribuisce: un hotel singolo no, una catena sì', () => {
    assert.equal(isDistributingCompany(company()), true)
    assert.equal(isDistributingCompany(company({ type_code: 'accommodation', details: {} })), false)
    assert.equal(isDistributingCompany(company({ type_code: 'accommodation', details: { hotel_group: true } })), true)
    assert.equal(isDistributingCompany(company({ type_code: 'dmo' })), false)
  })

  test('casella d’ufficio solo sul dominio dell’azienda', () => {
    assert.equal(isCompanyMailbox('info@dimorra.example', HOME), true)
    assert.equal(isCompanyMailbox('sales@dimorra.example', HOME), true)
    assert.equal(isCompanyMailbox('booking@mail.dimorra.example', HOME), true)
    assert.equal(isCompanyMailbox('mario.rossi@dimorra.example', HOME), false)
    assert.equal(isCompanyMailbox('dimorra.info@gmail.com', HOME), false)
    assert.equal(isCompanyMailbox('info@altrosito.example', HOME), false)
  })

  test('candidati: con sito, senza CRM, con un recapito mancante; prima property manager e DMC', () => {
    const orgs = [
      company({ id: 'a', name: 'Agenzia', type_code: 'travel_agency' }),
      company({ id: 'b', name: 'Dmc grande', type_code: 'dmc', details: { employees: 80 } }),
      company({ id: 'c', name: 'Pm', type_code: 'property_manager' }),
      company({ id: 'd', name: 'Completa', email: 'info@x.example', phone: '081 1234567' }),
      company({ id: 'e', name: 'Senza sito', website: null }),
      company({ id: 'f', name: 'Nel CRM' }),
      company({ id: 'g', name: 'Letta ieri' }),
    ]
    const now = new Date('2026-10-28T06:00:00Z')
    const out = companyCandidates({ orgs, linked: new Set(['f']), blocked: new Set(), lastChecked: new Map([['g', '2026-10-27']]), now })
    assert.deepEqual(out.map((o) => o.id), ['c', 'b', 'a'])
  })

  test('tiene solo dati con la frase letta; non tocca campi pieni; scarta l’email personale', () => {
    const ok = validateCompanyEnrichment({ org: company(), pages, model: model() })
    assert.ok(ok.ready)
    assert.deepEqual(ok.proposal.fill, { email: 'info@dimorra.example', phone: '+39 081 123 4567' })
    assert.equal(ok.proposal.decision_maker?.type, 'titolare')

    const personal = validateCompanyEnrichment({ org: company(), pages, model: model({ email: 'mario.rossi@dimorra.example', email_quote: 'mario.rossi@dimorra.example', phone: '' }) })
    assert.equal(personal.ready, false)

    const invented = validateCompanyEnrichment({ org: company(), pages, model: model({ phone: '' , email_quote: 'Scrivici a info@dimorra.example oggi' }) })
    assert.equal(invented.ready, false)

    const full = validateCompanyEnrichment({ org: company({ email: 'x@dimorra.example' }), pages, model: model() })
    assert.ok(full.ready); assert.equal(full.proposal.fill.email, undefined); assert.equal(full.proposal.fill.phone, '+39 081 123 4567')
  })
})

describe('Arricchimento aziende: handler e clic', () => {
  const html: Record<string, string> = {
    [HOME]: `<html><body><p>${pages[0].text}</p><a href="/contatti">Contatti</a></body></html>`,
    [CONTACT]: `<html><body>${pages[1].text.split('\n').map((l) => `<p>${l}</p>`).join('')}</body></html>`,
  }
  function fixture(budget = 1000) {
    const db = new FakeSupabase({
      tourism_hubs: [], tourism_destinations: [], tourism_crm_links: [], office_agent_outputs: [],
      tourism_entities: [{ ...company(), user_id: OWNER, kind: 'organization' },
        { ...company({ id: 'h1', name: 'Hotel solo', type_code: 'accommodation', details: {} }), user_id: OWNER, kind: 'organization' }],
    }, {
      tourism_activate: () => ({ filled: ['email', 'phone'], contact_id: 'contact-1', contact_created: true, crm_error: null }),
    })
    const calls: string[] = []
    const fakeModel: any = async (_ctx: AgentContext, options: { input: string }) => {
      if (budget < 5) throw new BudgetExceeded(); budget -= 5; calls.push(options.input)
      return { text: JSON.stringify(model()), costCents: 5, tokensIn: 1, tokensOut: 1 }
    }
    const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.entity_enricher, user_id: OWNER }, runId: 'run', log() {},
      async reserve() { assert.fail() }, async settle() { assert.fail() },
      async addOutput(output) { const row = { id: db.nextId('output'), agent_id: 'entity_enricher', user_id: OWNER, status: 'pending', created_at: '2026-10-28T06:00:00Z', output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id },
    }
    const fetchPage = async (url: string) => html[url] ? { status: 200, text: html[url], bytes: 1, headers: {} } : { status: 404, text: '', bytes: 0, headers: {} }
    const run = () => entityEnricherHandler(db, { now: () => new Date('2026-10-28T06:00:00Z'), fetchPage, model: fakeModel })(ctx)
    return { db, run, calls }
  }

  test('senza città prioritarie legge le aziende, propone e non scrive nel catalogo', async () => {
    const f = fixture()
    const result = await f.run()
    const proposals = f.db.tables.office_agent_outputs.filter((o) => o.kind === 'proposal')
    assert.equal(proposals.length, 1)
    assert.equal(proposals[0].body.action, 'enrich_company')
    assert.equal(f.calls.length, 1, 'l’hotel singolo non si legge')
    assert.equal(f.db.tables.tourism_entities!.find((e) => e.id === 'co-1')!.email, null)
    assert.match(result!.summary, /1 aziende lette, 1 proposte/)
    await f.run()
    assert.equal(f.calls.length, 1, 'una seconda corsa non la rilegge')
  })

  test('il clic attiva l’azienda una volta sola, con i recapiti e la prova', async () => {
    const f = fixture()
    await f.run()
    const proposal = f.db.tables.office_agent_outputs.find((o) => o.kind === 'proposal')!
    const first = await approveEnrichedCompany(f.db, OWNER, proposal.id)
    assert.ok(first && !('error' in first)); assert.match(first!.notice!, /aggiunta ai contatti/)
    assert.equal(proposal.status, 'approved')
    const call = f.db.calls.find((c) => c.rpc === 'tourism_activate')!
    assert.equal(call.args.p_entity_id, 'co-1'); assert.equal(call.args.p_payload.email, 'info@dimorra.example')
    assert.match(call.args.p_payload.identity.quote, /info@dimorra\.example/)
    const second = await approveEnrichedCompany(f.db, OWNER, proposal.id)
    assert.ok(second && 'error' in second)
    assert.equal(f.db.calls.filter((c) => c.rpc === 'tourism_activate').length, 1)
  })

  test('un errore dell’attivazione lascia la proposta in attesa', async () => {
    const f = fixture()
    await f.run()
    f.db.rpcs.tourism_activate = () => { throw new Error('Ente non disponibile') }
    const proposal = f.db.tables.office_agent_outputs.find((o) => o.kind === 'proposal')!
    const result = await approveEnrichedCompany(f.db, OWNER, proposal.id)
    assert.ok(result && 'error' in result)
    assert.equal(proposal.status, 'pending'); assert.equal(proposal.body.claimed_at, null)
  })

  test('altre uscite non sono sue', async () => {
    const f = fixture()
    f.db.tables.office_agent_outputs.push({ id: 'x', user_id: OWNER, agent_id: 'entity_enricher', kind: 'proposal', status: 'pending', body: { action: 'enrich_entity' } })
    assert.equal(await approveEnrichedCompany(f.db, OWNER, 'x'), null)
  })
})
