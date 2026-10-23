/** Arricchimento enti: l'approvazione sul Postgres usa-e-getta con le migration vere del catalogo, mai su Supabase remoto. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_entity_enricher_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const sql = (s: string) => query(s, DB), scalar = (s: string) => value(s, DB), error = (s: string) => failure(s, DB)
const json = async (s: string) => JSON.parse((await scalar(s))!)
const URL = 'https://www.marseille-tourisme.example/contact'

const body = (patch: Record<string, unknown> = {}) => JSON.stringify({
  action: 'enrich_entity', entity_id: ORG, entity_name: 'Office de Tourisme de Marseille', country: 'FR', city: 'Marsiglia', place_id: null,
  fill: { email: 'info@marseille-tourisme.example', phone: '+33 4 91 13 89 00' },
  evidence: {
    identity: { source_url: URL, quote: 'L’Office de Tourisme de Marseille accueille les visiteurs.' },
    coverage: { source_url: URL, quote: 'Nous assurons la promotion touristique de Marseille.', relation: 'PROMOTES' },
    email: { source_url: URL, quote: 'Écrivez-nous : info@marseille-tourisme.example' },
    phone: { source_url: URL, quote: 'Téléphone : +33 4 91 13 89 00' },
  },
  decision_maker: { type: 'direttore', source_url: URL, quote: 'Le directeur général conduit la stratégie.' }, ...patch,
}).replace(/'/g, "''")
const proposal = async (patch: Record<string, unknown> = {}) => scalar(`insert into office_agent_outputs(agent_id,user_id,kind,title,body,target_table,target_id,output_key)
  values('entity_enricher','${OWNER}','proposal','Ente pronto','${body(patch)}'::jsonb,'tourism_entities','${ORG}','enricher:proposal:${Math.random()}') returning id`)
const decide = (id: string, status = 'approved') => json(`select public.decide_office_output('${id}','${OWNER}','${status}')`)

before(async () => {
  await resetOfficeDatabase(DB, ['20261017205455_tourism_intelligence.sql', '20261017214525_tourism_acquisition_matching.sql',
    '20261018185155_tourism_site_research.sql', '20261019051155_tourism_sitemap_targeting.sql', '20261023120000_office_entity_enricher.sql',
    '20261023120100_office_events.sql'])
  // Colonne di produzione (hospitality_outreach) che la base minima dell'ufficio non carica: tourism_promote le scrive.
  await sql(`alter table contacts add column if not exists company text, add column if not exists country text,
    add column if not exists marketing_eligibility text not null default 'review';
    insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})

beforeEach(async () => {
  await sql(`reset request.jwt.claim.sub; truncate office_agent_outputs, office_agents, tourism_entities, contacts cascade;
    insert into office_agents(id,user_id,name,department,enabled,settings) values
      ('entity_enricher','${OWNER}','Arricchimento enti','ricerca',false,'{}'),
      ('presentations','${OWNER}','Presentazioni','commerciale',false,'{"queue":[]}');
    insert into tourism_entities(id,user_id,kind,name,country_code,type_code,website) values
      ('${ORG}','${OWNER}','organization','Office de Tourisme de Marseille','FR','dmo','https://www.marseille-tourisme.example');`)
})

test('approvare: prove verificate a nome del titolare, campi vuoti riempiti, luogo, relazione, CRM e coda Presentazioni', async () => {
  const id = (await proposal())!
  const result = await decide(id)
  assert.equal(result.output.status, 'approved')
  const r = result.output.body.result
  assert.deepEqual(r.filled, ['email', 'phone']); assert.equal(r.contact_created, true); assert.equal(r.queued_presentation, true)
  assert.equal(await scalar(`select status||'|'||email||'|'||phone||'|'||(details->>'decision_maker_type') from tourism_entities where id='${ORG}'`),
    'VERIFIED|info@marseille-tourisme.example|+33 4 91 13 89 00|direttore')
  assert.equal(await scalar(`select count(*) from tourism_evidence where entity_id='${ORG}' and status='VERIFIED' and verified_by='${OWNER}' and method='ai'`), '5')
  assert.equal(await scalar(`select name||'|'||status from tourism_entities where kind='place'`), 'Marsiglia|VERIFIED')
  assert.equal(await scalar(`select relation from tourism_relations where from_id='${ORG}' and to_id='${r.place_id}'`), 'PROMOTES')
  assert.equal(await scalar(`select contact_scope||'|'||email||'|'||phone||'|'||marketing_eligibility from contacts where id='${r.contact_id}'`),
    'crm|info@marseille-tourisme.example|+33 4 91 13 89 00|review')
  assert.equal(await scalar(`select contact_id from tourism_crm_links where entity_id='${ORG}'`), r.contact_id)
  const queue = await json(`select settings->'queue' from office_agents where id='presentations'`)
  assert.deepEqual(queue.map((q: any) => [q.entity_id, q.destination_id]), [[ORG, r.place_id]])
})

test('un campo riempito nel frattempo non si sovrascrive; un luogo esistente si riusa', async () => {
  await sql(`update tourism_entities set email='contatti@marseille.example' where id='${ORG}';
    insert into tourism_entities(user_id,kind,name,country_code) values('${OWNER}','place','Marsiglia','FR')`)
  const r = (await decide((await proposal())!)).output.body.result
  assert.deepEqual(r.filled, ['phone']); assert.deepEqual(r.kept, ['email'])
  assert.equal(await scalar(`select email from tourism_entities where id='${ORG}'`), 'contatti@marseille.example')
  assert.equal(await scalar(`select count(*) from tourism_entities where kind='place'`), '1')
  assert.equal(await scalar(`select count(*) from tourism_evidence where entity_id='${ORG}' and 'email'=any(fields)`), '0')
})

test('se il CRM rifiuta, non resta niente: proposta in attesa, ente e catalogo come prima', async () => {
  await sql(`insert into contacts(user_id,name,email,status) values('${OWNER}','Altro ente','info@marseille-tourisme.example','New')`)
  const id = (await proposal())!
  const result = await decide(id)
  assert.equal(result.output, null); assert.equal(result.reason, 'enrich_failed'); assert.match(result.error, /Email already used/)
  assert.equal(await scalar(`select status from office_agent_outputs where id='${id}'`), 'pending')
  assert.equal(await scalar(`select status||'|'||coalesce(email,'-') from tourism_entities where id='${ORG}'`), 'UNVERIFIED|-')
  assert.equal(await scalar(`select count(*) from tourism_evidence`), '0')
  assert.equal(await scalar(`select count(*) from tourism_entities where kind='place'`), '0')
  assert.equal(await scalar(`select jsonb_array_length(settings->'queue') from office_agents where id='presentations'`), '0')
})

test('Napoli, prove senza frase e rifiuti non scrivono nulla', async () => {
  assert.match((await decide((await proposal({ city: 'Napoli' }))!)).error, /Napoli/)
  const noQuote = (await proposal({ evidence: { identity: { source_url: URL, quote: '' }, coverage: { source_url: URL, quote: 'Nous assurons la promotion de Marseille.', relation: 'PROMOTES' } } }))!
  assert.match((await decide(noQuote)).error, /senza fonte o senza frase/)
  const rejected = await decide((await proposal())!, 'rejected')
  assert.equal(rejected.output.status, 'rejected')
  assert.equal(await scalar('select count(*) from tourism_evidence'), '0'); assert.equal(await scalar('select count(*) from contacts'), '0')
})

test('otto clic insieme: un contatto, un collegamento, una voce in coda', async () => {
  const id = (await proposal())!
  const results = await Promise.all(Array.from({ length: 8 }, () => decide(id)))
  assert.equal(results.filter((r) => r.output?.status === 'approved').length, 1)
  assert.equal(await scalar('select count(*) from contacts'), '1'); assert.equal(await scalar('select count(*) from tourism_crm_links'), '1')
  assert.equal(await scalar(`select jsonb_array_length(settings->'queue') from office_agents where id='presentations'`), '1')
})

test('permessi: solo il service role chiama l’arricchimento', async () => {
  for (const role of ['anon', 'authenticated']) {
    assert.match((await error(`set role ${role}; select public.office_enrich_entity('${OWNER}','${OWNER}')`))!, /permission denied/)
  }
  assert.equal(await scalar(`select has_function_privilege('service_role','public.office_enrich_entity(uuid,uuid)','execute')`), 't')
})
