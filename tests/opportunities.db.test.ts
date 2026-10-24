/** Opportunità su Postgres vero: la migration sopra deals di produzione, mai su Supabase remoto. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'opportunities_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const C1 = '33333333-3333-4333-8333-000000000001'
const ENT = '44444444-4444-4444-8444-000000000001'
const ENT_OTHER = '44444444-4444-4444-8444-000000000002'
const sql = (s: string) => query(s, DB)
const scalar = (s: string) => value(s, DB)
const expectError = (s: string) => failure(s, DB)
const deal = (fields: string, values: string) => sql(`insert into deals(user_id,contact_id,stage,${fields}) values('${OWNER}','${C1}',${values})`)

// Solo le tabelle a cui deals punta e che lo schema dell'ufficio non crea.
const PREREQ = `
alter table public.contacts add column if not exists assigned_agent text, add column if not exists responsible text,
  add column if not exists lost_reason text, add column if not exists value numeric, add column if not exists won_at timestamptz, add column if not exists first_closed_at timestamptz;
create table if not exists public.quotes(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid, status text, created_at timestamptz default now(), total_amount numeric, paid_at timestamptz, accepted_at timestamptz, sent_at timestamptz);
create table if not exists public.team_members(id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, email text, auth_user_id uuid);
create table if not exists public.tourism_entities(id uuid primary key default gen_random_uuid(), user_id uuid not null, name text);
create table if not exists public.agency_projects(id uuid primary key default gen_random_uuid(), user_id uuid not null);`

before(async () => {
  await resetOfficeDatabase(DB)
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
  await sql(PREREQ)
  for (const file of ['20260710130000_deals.sql', '20261024120000_opportunities.sql']) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  // Una seconda applicazione non deve fallire: le migration si rilanciano.
  await sql(await readFile(new URL('../supabase/migrations/20261024120000_opportunities.sql', import.meta.url), 'utf8'))
})

beforeEach(async () => {
  await sql(`truncate public.deals, public.tourism_entities, public.contacts cascade;
    insert into contacts(id,user_id,name,status) values('${C1}','${OWNER}','Visit Marseille','New');
    insert into tourism_entities(id,user_id,name) values('${ENT}','${OWNER}','Office de Tourisme'),('${ENT_OTHER}','${OTHER}','Altro ente');`)
})

test('una trattativa aperta per contatto e per pipeline', async () => {
  await deal('title', `'Interested','Vendita'`)
  assert.equal(await scalar(`select pipeline from deals`), 'vendite')
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage) values('${OWNER}','${C1}','New')`)), /deals_one_open_per_contact_pipeline/)
  await deal('pipeline', `'qualificata','tourism'`)
  await deal('pipeline', `'qualificata','distribuzione'`)
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,pipeline) values('${OWNER}','${C1}','proposta','tourism')`)), /deals_one_open_per_contact_pipeline/)
  await sql(`update deals set closed_at=now() where pipeline='tourism'`)
  await deal('pipeline', `'scoperta','tourism'`)
  assert.equal(await scalar(`select count(*) from deals`), '4')
  assert.equal(await scalar(`select count(*) from pg_indexes where indexname='deals_one_open_per_contact'`), '0')
})

test('vincoli: fasi delle pipeline nuove, responsabile, attivazione dopo la firma', async () => {
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,pipeline) values('${OWNER}','${C1}','Interested','tourism')`)), /deals_new_pipeline_stage_check/)
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,pipeline) values('${OWNER}','${C1}','qualificata','altro')`)), /deals_pipeline_check/)
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,owner) values('${OWNER}','${C1}','New','   ')`)), /deals_owner_check/)
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,pipeline,activated_at) values('${OWNER}','${C1}','attiva','distribuzione',now())`)), /deals_activation_after_signature/)
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,evidence) values('${OWNER}','${C1}','New','{}'::jsonb)`)), /deals_evidence_check/)
  await deal('pipeline,owner,signed_at,activated_at', `'attiva','distribuzione','agent:distribution',now(),now()`)
})

test('ente di un altro workspace rifiutato; la data del cambio fase la scrive il database', async () => {
  assert.match(String(await expectError(`insert into deals(user_id,contact_id,stage,pipeline,entity_id) values('${OWNER}','${C1}','qualificata','tourism','${ENT_OTHER}')`)), /altro workspace/)
  await deal('pipeline,entity_id', `'qualificata','tourism','${ENT}'`)
  await sql(`update deals set stage_changed_at='2026-01-01' where pipeline='tourism'`)
  assert.equal(await scalar(`select stage_changed_at::date::text from deals`), '2026-01-01')
  await sql(`update deals set next_step='Chiamare' where pipeline='tourism'`)
  assert.equal(await scalar(`select stage_changed_at::date::text from deals`), '2026-01-01')
  await sql(`update deals set stage='proposta' where pipeline='tourism'`)
  assert.equal(await scalar(`select stage_changed_at > now() - interval '1 minute' from deals`), 't')
  await sql(`delete from tourism_entities where id='${ENT}'`)
  assert.equal(await scalar(`select entity_id is null from deals`), 't')
})

test('le bozze email puntano all’opportunità e la perdono senza cadere', async () => {
  await deal('pipeline', `'qualificata','tourism'`)
  const id = await scalar(`select id from deals`)
  await sql(`insert into email_drafts(user_id,contact_id,deal_id,subject,body_text,status) values('${OWNER}','${C1}','${id}','Ciao','Testo','pending')`)
  await sql(`delete from deals`)
  assert.equal(await scalar(`select deal_id is null from email_drafts`), 't')
})
