import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  contactLinks, enrichTargets, isInstitutionalEmail, matchOrganization, validateEnrichment, type EnrichOrg, type EnrichTarget, type ModelEnrichment,
} from '../src/lib/office/entity-enricher'
import { entityEnricherHandler, pageTextFromHtml } from '../src/lib/server/office-agents/entity-enricher'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { OFFICE_AGENT_HANDLERS } from '../src/lib/server/office-agents/registry'
import { AUTOMATION_JOBS } from '../src/lib/automation-schedule'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

const OWNER = 'owner'
const org = (patch: Partial<EnrichOrg> = {}): EnrichOrg => ({ id: 'org-1', name: 'Office de Tourisme de Marseille', country_code: 'FR', type_code: 'dmo',
  aliases: [], website: 'https://www.marseille-tourisme.example', email: null, phone: null, status: 'UNVERIFIED', disabled: false, ...patch })
const target: EnrichTarget = { key: 'FR:marsiglia', city: 'Marsiglia', country: 'FR', names: ['Marsiglia', 'Marseille'], priority: 1, in_progress: true, place_id: null }
const URL_HOME = 'https://www.marseille-tourisme.example/'
const URL_CONTACT = 'https://www.marseille-tourisme.example/contact'
const pages = [
  { url: URL_HOME, text: 'L’Office de Tourisme de Marseille accueille les visiteurs toute l’année.\nNous assurons la promotion touristique de Marseille et de sa métropole.' },
  { url: URL_CONTACT, text: 'Écrivez-nous : info@marseille-tourisme.example\nTéléphone : +33 4 91 13 89 00\nLe directeur général de l’Office conduit la stratégie.\nContact presse: jean.dupont@marseille-tourisme.example' },
]
const model = (patch: Partial<ModelEnrichment> = {}): ModelEnrichment => ({
  identity_quote: 'L’Office de Tourisme de Marseille accueille les visiteurs toute l’année.', identity_url: URL_HOME,
  coverage_relation: 'PROMOTES', coverage_quote: 'Nous assurons la promotion touristique de Marseille et de sa métropole.', coverage_url: URL_HOME,
  email: 'info@marseille-tourisme.example', email_quote: 'Écrivez-nous : info@marseille-tourisme.example', email_url: URL_CONTACT,
  phone: '+33 4 91 13 89 00', phone_quote: 'Téléphone : +33 4 91 13 89 00', phone_url: URL_CONTACT,
  decision_maker_type: 'direttore', decision_maker_quote: 'Le directeur général de l’Office conduit la stratégie.', decision_maker_url: URL_CONTACT, ...patch })

describe('Arricchimento enti: regole pure', () => {
  test('città dai porti prioritari: destinazione o nome fra parentesi, nomi locali, Napoli fuori', () => {
    const targets = enrichTargets({ places: [{ id: 'place-mrs', name: 'Marseille', country_code: 'FR', aliases: [] }], destinations: [], hubs: [
      { id: 'h1', name: 'Marsiglia', destination: null, country: 'FR', guide_status: 'in_progress', guide_priority: 1 },
      { id: 'h2', name: 'Pireo (Atene)', destination: null, country: 'GR', guide_status: 'planned', guide_priority: 2 },
      { id: 'h3', name: 'Napoli', destination: null, country: 'IT', guide_status: 'live', guide_priority: 1 },
      { id: 'h4', name: 'Molo Beverello', destination: 'Naples', country: 'IT', guide_status: 'planned', guide_priority: 1 },
      { id: 'h5', name: 'Savona', destination: null, country: 'IT', guide_status: 'planned', guide_priority: 3 },
    ] })
    assert.deepEqual(targets.map((t) => t.city), ['Marsiglia', 'Atene'])
    assert.ok(targets[0].names.includes('Marseille')); assert.equal(targets[0].place_id, 'place-mrs')
    assert.ok(targets[1].names.includes('Athens'))
  })

  test('l’ente: stesso paese, tipo di governo, città come parola intera, con un sito', () => {
    const valencia: EnrichTarget = { ...target, city: 'Valencia', country: 'ES', names: ['Valencia'] }
    const orgs = [org({ id: 'regione', name: 'Turisme Comunitat Valenciana', country_code: 'ES' }),
      org({ id: 'comune', name: 'Ajuntament de Valencia', country_code: 'ES', type_code: 'municipality' }),
      org({ id: 'cvb', name: 'Turismo Valencia Convention Bureau', country_code: 'ES', type_code: 'cvb' }),
      org({ id: 'senza-sito', name: 'Visit Valencia', country_code: 'ES', website: null })]
    assert.equal(matchOrganization(valencia, orgs)!.id, 'cvb')
    assert.equal(matchOrganization(valencia, orgs.filter((o) => o.id === 'regione')), null)
    assert.equal(matchOrganization(target, [org({ disabled: true })]), null)
  })

  test('solo caselle d’ufficio: niente nome.cognome, niente PEC', () => {
    for (const ok of ['info@visit.example', 'turismo.comune@x.it', 'iat@genova.example', 'office.tourisme@x.fr']) assert.equal(isInstitutionalEmail(ok), true, ok)
    for (const no of ['jean.dupont@x.fr', 'mrossi@x.it', 'turismo@pec.comune.x.it', 'protocollo@cert.x.it', 'non-email']) assert.equal(isInstitutionalEmail(no), false, no)
  })

  test('proposta pronta: ogni dato con la sua frase, presa dalla pagina', () => {
    const result = validateEnrichment({ org: org(), target, pages, model: model() })
    assert.equal(result.ready, true)
    if (!result.ready) return
    assert.deepEqual(result.proposal.fill, { email: 'info@marseille-tourisme.example', phone: '+33 4 91 13 89 00' })
    assert.equal(result.proposal.evidence.coverage.relation, 'PROMOTES')
    assert.equal(result.proposal.decision_maker!.type, 'direttore')
  })

  test('un dato senza prova è scartato: frase inventata, fonte non letta, valore fuori dalla frase, email personale', () => {
    const invented = validateEnrichment({ org: org(), target, pages, model: model({ email_quote: 'Scrivete a info@marseille-tourisme.example per tutto.' }) })
    assert.ok(!invented.ready || !invented.proposal.fill.email); assert.ok(invented.rejected.some((r) => /non si trova/.test(r)))
    const otherSite = validateEnrichment({ org: org(), target, pages, model: model({ phone_url: 'https://altro.example/' }) })
    assert.ok(otherSite.ready && !otherSite.proposal.fill.phone); assert.ok(otherSite.rejected.some((r) => /fonte non fra/.test(r)))
    const mismatch = validateEnrichment({ org: org(), target, pages, model: model({ phone: '+33 4 00 00 00 00' }) })
    assert.ok(mismatch.ready && !mismatch.proposal.fill.phone)
    const personal = validateEnrichment({ org: org(), target, pages, model: model({ email: 'jean.dupont@marseille-tourisme.example', email_quote: 'Contact presse: jean.dupont@marseille-tourisme.example' }) })
    assert.ok(personal.ready && !personal.proposal.fill.email); assert.ok(personal.rejected.some((r) => /personale/.test(r)))
    const noCoverage = validateEnrichment({ org: org(), target, pages, model: model({ coverage_relation: 'NONE' }) })
    assert.equal(noCoverage.ready, false)
    const wrongName = validateEnrichment({ org: org({ name: 'Comité Régional Provence' }), target, pages, model: model() })
    assert.equal(wrongName.ready, false)
  })

  test('un campo già pieno non si sovrascrive', () => {
    const result = validateEnrichment({ org: org({ email: 'contact@marseille.example' }), target, pages, model: model() })
    assert.ok(result.ready)
    if (!result.ready) return
    assert.equal(result.proposal.fill.email, undefined); assert.equal(result.proposal.fill.phone, '+33 4 91 13 89 00')
    assert.ok(result.rejected.some((r) => /già pieno/.test(r)))
  })

  test('pagine: piè di pagina compreso, link di contatto solo sullo stesso sito', () => {
    const page = pageTextFromHtml('<html><body><nav><a href="/fr/contact">Contact</a><a href="https://facebook.com/contact">FB</a></nav><p>Bonjour</p><footer>Tél. <b>04 91 13 89 00</b><script>x()</script></footer></body></html>')
    assert.match(page.text, /Tél\. 04 91 13 89 00/); assert.doesNotMatch(page.text, /x\(\)/)
    assert.deepEqual(contactLinks('https://www.marseille-tourisme.example/', page.links), ['https://www.marseille-tourisme.example/fr/contact'])
  })
})

describe('Arricchimento enti: handler', () => {
  const html: Record<string, string> = {
    [URL_HOME]: `<html><body><p>${pages[0].text.split('\n')[0]}</p><p>${pages[0].text.split('\n')[1]}</p><a href="/contact">Contact</a></body></html>`,
    [URL_CONTACT]: `<html><body>${pages[1].text.split('\n').map((l) => `<p>${l}</p>`).join('')}</body></html>`,
  }
  function fixture(extra: { orgs?: any[]; outputs?: any[]; budget?: number } = {}) {
    const db = new FakeSupabase({
      tourism_hubs: [{ id: 'h1', user_id: OWNER, name: 'Marsiglia', destination: null, country: 'FR', guide_status: 'in_progress', guide_priority: 1 },
        { id: 'h2', user_id: OWNER, name: 'Napoli', destination: null, country: 'IT', guide_status: 'in_progress', guide_priority: 1 },
        { id: 'h3', user_id: OWNER, name: 'Copenaghen', destination: null, country: 'DK', guide_status: 'planned', guide_priority: 1 }],
      tourism_destinations: [],
      tourism_entities: extra.orgs || [{ ...org(), user_id: OWNER, kind: 'organization', website: URL_HOME },
        { ...org({ id: 'org-na', name: 'Ente Turismo Napoli', country_code: 'IT', website: 'https://napoli.example' }), user_id: OWNER, kind: 'organization' }],
      tourism_crm_links: [], office_agent_outputs: extra.outputs || [],
    })
    const fetched: string[] = []; const calls: string[] = []; let budget = extra.budget ?? 1000
    const fetchPage = async (url: string) => { fetched.push(url); return html[url] ? { status: 200, text: html[url], bytes: 1, headers: {} } : { status: 404, text: '', bytes: 0, headers: {} } }
    const fakeModel: any = async (_ctx: AgentContext, options: { input: string }) => {
      if (budget < 5) throw new BudgetExceeded(); budget -= 5; calls.push(options.input); return { text: JSON.stringify(model()), costCents: 5, tokensIn: 1, tokensOut: 1 }
    }
    const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.entity_enricher, user_id: OWNER }, runId: 'run', log() {},
      async reserve() { assert.fail('le spese passano da callModel') }, async settle() { assert.fail() },
      async addOutput(output) { const row = { id: db.nextId('output'), agent_id: 'entity_enricher', user_id: OWNER, status: 'pending', created_at: '2026-10-24T06:00:00Z', output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id },
    }
    const run = () => entityEnricherHandler(db, { now: () => new Date('2026-10-24T06:00:00Z'), fetchPage, model: fakeModel })(ctx)
    return { db, run, fetched, calls }
  }

  test('propone l’ente con fonti, non scrive nel catalogo né nel CRM, Napoli mai letta', async () => {
    const f = fixture()
    const result = await f.run()
    const proposal = f.db.tables.office_agent_outputs.find((o) => o.kind === 'proposal')!
    assert.equal(proposal.body.action, 'enrich_entity'); assert.equal(proposal.target_id, 'org-1')
    assert.equal(proposal.body.fill.email, 'info@marseille-tourisme.example')
    assert.ok(!f.fetched.some((u) => u.includes('napoli'))); assert.ok(f.calls.every((c) => !/Napoli/.test(c)))
    assert.equal(f.db.tables.tourism_entities!.find((e) => e.id === 'org-1')!.email, null)
    assert.equal(f.db.tables.tourism_crm_links.length, 0)
    const report = f.db.tables.office_agent_outputs.find((o) => o.kind === 'report')!
    assert.deepEqual(report.body.ente_non_trovato, ['Copenaghen (DK)'])
    assert.match(result!.summary, /1 proposte pronte/)
  })

  test('una seconda corsa non riapre l’ente; un ente già nel CRM non si rilegge', async () => {
    const f = fixture()
    await f.run(); await f.run()
    assert.equal(f.db.tables.office_agent_outputs.filter((o) => o.kind === 'proposal').length, 1)
    assert.equal(f.calls.length, 1)
    const g = fixture(); g.db.tables.tourism_crm_links.push({ user_id: OWNER, entity_id: 'org-1', contact_id: 'c' })
    await g.run()
    assert.equal(g.calls.length, 0)
  })

  test('budget finito: si ferma senza proposte e lo dice', async () => {
    const f = fixture({ budget: 0 })
    await f.run()
    assert.equal(f.db.tables.office_agent_outputs.filter((o) => o.kind === 'proposal').length, 0)
    assert.equal(f.db.tables.office_agent_outputs.find((o) => o.kind === 'report')!.body.budget_finito, true)
  })

  test('installazione: spento, 2 € al giorno, ogni mattina alle 6', () => {
    const def = OFFICE_AGENT_DEFINITIONS.entity_enricher
    assert.equal(def.enabled, false); assert.equal(def.daily_budget_cents, 200); assert.equal(def.department, 'ricerca')
    assert.ok(OFFICE_AGENT_HANDLERS.entity_enricher)
    const job = AUTOMATION_JOBS.find((j) => j.name === 'office-entity-enricher')!
    assert.equal(job.cron, '0 6 * * *'); assert.equal(job.steps[0].path, '/api/automation/agents/entity_enricher/run')
  })
})
