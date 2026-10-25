/** Attivazione di un ente (scheda o Direttore) sul Postgres usa-e-getta con le migration vere del catalogo. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'tourism_activate_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const sql = (s: string) => query(s, DB), scalar = (s: string) => value(s, DB), error = (s: string) => failure(s, DB)
const json = async (s: string) => JSON.parse((await scalar(s))!)
const activate = (payload: Record<string, unknown>, owner = OWNER, entity = ORG) =>
  json(`select public.tourism_activate('${owner}','${entity}','${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb)`)

before(async () => {
  await resetOfficeDatabase(DB, ['20261017205455_tourism_intelligence.sql', '20261017214525_tourism_acquisition_matching.sql',
    '20261018185155_tourism_site_research.sql', '20261019051155_tourism_sitemap_targeting.sql', '20261024150000_tourism_activate.sql'])
  await sql(`alter table contacts add column if not exists company text, add column if not exists country text,
    add column if not exists marketing_eligibility text not null default 'review';
    insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})

beforeEach(async () => {
  await sql(`reset request.jwt.claim.sub; truncate tourism_entities, contacts cascade;
    insert into tourism_entities(id,user_id,kind,name,country_code,type_code,status) values
      ('${ORG}','${OWNER}','organization','VISIT BERGAMO','IT','dmo','NEEDS_REVIEW');`)
})

test('scheda: il titolare conferma, l’email si aggiunge, l’ente è verificato ed entra nei contatti', async () => {
  const r = await activate({ origin: 'owner', email: 'Info@VisitBergamo.example', website: 'https://www.visitbergamo.example' })
  assert.deepEqual(r.filled, ['website', 'email'])
  assert.equal(r.contact_created, true); assert.equal(r.crm_error, null)
  assert.equal(await scalar(`select status||'|'||email||'|'||website from tourism_entities where id='${ORG}'`), 'VERIFIED|info@visitbergamo.example|https://www.visitbergamo.example')
  assert.equal(await scalar(`select contact_scope||'|'||email from contacts where id='${r.contact_id}'`), 'crm|info@visitbergamo.example')
  assert.equal(await scalar(`select count(*) from tourism_evidence where entity_id='${ORG}' and status='VERIFIED' and verified_by='${OWNER}' and method='manual'`), '1')
  // Una seconda conferma ritrova lo stesso contatto.
  const again = await activate({ origin: 'owner' })
  assert.equal(again.contact_id, r.contact_id); assert.equal(again.contact_created, false)
})

test('Direttore: un campo già pieno non si sovrascrive; la città crea luogo e relazione per la presentazione', async () => {
  await sql(`update tourism_entities set email='turismo@bergamo.example' where id='${ORG}'`)
  const r = await activate({ origin: 'director', city: 'Bergamo', email: 'altro@bergamo.example', website: 'https://www.visitbergamo.example',
    identity: { source_url: 'https://www.visitbergamo.example', quote: 'VisitBergamo è l’agenzia per il turismo di Bergamo.' },
    coverage: { source_url: 'https://www.visitbergamo.example', quote: 'Promuoviamo Bergamo e il suo territorio.', relation: 'PROMOTES' } })
  assert.deepEqual(r.filled, ['website'])
  assert.equal(await scalar(`select email from tourism_entities where id='${ORG}'`), 'turismo@bergamo.example')
  assert.equal(await scalar(`select name||'|'||status from tourism_entities where id='${r.place_id}'`), 'Bergamo|VERIFIED')
  assert.equal(await scalar(`select relation from tourism_relations where from_id='${ORG}' and to_id='${r.place_id}'`), 'PROMOTES')
  assert.equal(await scalar(`select count(*) from tourism_evidence e join tourism_relations r on r.evidence_id=e.id where r.from_id='${ORG}' and e.status='VERIFIED'`), '1')
})

test('il CRM che rifiuta non annulla la verifica: torna come motivo', async () => {
  await sql(`insert into contacts(user_id,name,company,country,status) values('${OWNER}','A','VISIT BERGAMO','IT','New'),('${OWNER}','B','Visit Bergamo','IT','New')`)
  const r = await activate({ origin: 'owner' })
  assert.match(String(r.crm_error), /Ambiguous/)
  assert.equal(r.contact_id, null)
  assert.equal(await scalar(`select status from tourism_entities where id='${ORG}'`), 'VERIFIED')
})

test('Napoli fuori per il Direttore, ente di un altro workspace, versione cambiata, permessi', async () => {
  assert.match(String(await error(`select public.tourism_activate('${OWNER}','${ORG}','{"origin":"director","city":"Napoli"}'::jsonb)`)), /Napoli/)
  assert.match(String(await error(`select public.tourism_activate('${OTHER}','${ORG}','{"origin":"owner"}'::jsonb)`)), /non disponibile/)
  assert.match(String(await error(`select public.tourism_activate('${OWNER}','${ORG}','{"origin":"owner","version":999}'::jsonb)`)), /cambiata/)
  assert.match(String(await error(`set role authenticated; select public.tourism_activate('${OWNER}','${ORG}','{}'::jsonb)`)), /permission denied/)
  assert.equal(await scalar(`select status from tourism_entities where id='${ORG}'`), 'NEEDS_REVIEW')
})
