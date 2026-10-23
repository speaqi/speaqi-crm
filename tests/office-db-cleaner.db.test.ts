/** Pulizia database: unioni e decisioni sul Postgres usa-e-getta, mai su Supabase remoto. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resetDatabase, sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_db_cleaner_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const c = (i: number) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`
const sql = (s: string) => query(s, DB)
const scalar = (s: string) => value(s, DB)
const expectError = (s: string) => failure(s, DB)
const json = async (s: string) => JSON.parse((await scalar(s))!)

// Tabelle figlie con gli stessi vincoli di produzione che l'unione deve rispettare.
const CHILDREN = `
alter table public.contacts add column if not exists phone text, add column if not exists billing_city text,
  add column if not exists billing_tax_id text, add column if not exists billing_pec text, add column if not exists billing_sdi text,
  add column if not exists billing_address text, add column if not exists billing_zip text, add column if not exists note text,
  add column if not exists last_contact_at timestamptz, add column if not exists next_followup_at timestamptz,
  add column if not exists next_action_at timestamptz;
create table if not exists public.activities(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id) on delete cascade, type text, content text, metadata jsonb, created_at timestamptz default now());
create table if not exists public.tasks(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id) on delete cascade, status text default 'pending');
create table public.deals(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid not null references public.contacts(id) on delete cascade, title text, closed_at timestamptz);
create unique index deals_one_open_per_contact on public.deals(contact_id) where closed_at is null;
create table public.quotes(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id) on delete set null, title text, status text default 'draft', created_at timestamptz default now());
create table public.invoices(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id), number integer, year integer, status text);
create table if not exists public.email_drafts(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id) on delete cascade, source text not null default 'auto', scheduled_for date, status text);
create unique index if not exists email_drafts_auto_schedule_unique on public.email_drafts(contact_id, scheduled_for) where source = 'auto' and scheduled_for is not null;
create table if not exists public.gmail_messages(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id) on delete set null);
create table public.stage_transitions(id uuid primary key default gen_random_uuid(), user_id uuid, contact_id uuid references public.contacts(id) on delete cascade);
create table public.ai_decision_logs(id uuid primary key default gen_random_uuid(), lead_id uuid references public.contacts(id) on delete cascade);
create table public.agency_projects(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id));
create table public.trade_fair_exhibitors(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id), status text);
create table public.shipping_companies(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references public.contacts(id));
create table public.whatsapp_notification_events(id uuid primary key default gen_random_uuid(), user_id uuid, contact_id uuid references public.contacts(id) on delete cascade);
create table public.tourism_entities(id uuid primary key default gen_random_uuid(), user_id uuid not null, kind text, status text, name text, name_key text, country_code text, disabled boolean default false, created_at timestamptz default now());
create table public.tourism_crm_links(entity_id uuid primary key references public.tourism_entities(id), user_id uuid not null, contact_id uuid not null references public.contacts(id));
create table public.contact_map_links(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid not null references public.contacts(id) on delete cascade, map_ref text not null, unique(user_id, contact_id, map_ref));
create table public.wine_project_followup_events(id uuid primary key default gen_random_uuid(), user_id uuid, contact_id uuid references public.contacts(id), status text);
`

before(async () => {
  await resetDatabase(DB)
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
  await sql(CHILDREN)
  for (const file of ['20261022183327_office_director.sql', '20261023090000_office_db_cleaner.sql']) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
})

beforeEach(async () => {
  await sql(`truncate office_agents cascade; truncate public.contacts cascade; truncate public.tourism_entities cascade;
    insert into office_agents(id,user_id,name,department) values('db_cleaner','${OWNER}','Pulizia','operazioni');
    insert into contacts(id,user_id,name,email,phone,company,billing_city,contact_scope,created_at) values
      ('${c(1)}','${OWNER}','Hotel Sole','info@sole.it',null,'Hotel Sole','Capri','holding','2026-01-01'),
      ('${c(2)}','${OWNER}','Hotel Sole bis',' INFO@sole.it ','+39 081 123 4567',null,'Capri','holding','2026-02-01'),
      ('${c(3)}','${OWNER}','Sole Capri','x@other.it','0039 081 1234567','Hotel Sole',null,'holding','2026-03-01'),
      ('${c(4)}','${OWNER}','Altro','altro@x.it',null,null,null,'crm','2026-01-01'),
      ('${c(9)}','${OTHER}','Estraneo','info@sole.it',null,null,null,'holding','2026-01-01');`)
})

const propose = (groups: unknown) => scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body)
  values('db_cleaner','${OWNER}','k'||gen_random_uuid(),'data_fix','Unire','${JSON.stringify({ action: 'merge_contacts', groups }).replace(/'/g, "''")}') returning id`)
const decide = (id: string, status = 'approved') => json(`select public.decide_office_output('${id}','${OWNER}','${status}')`)

test('Pulizia: le chiavi trovano email e telefono scritti in modi diversi, solo nel workspace', async () => {
  const rows = JSON.parse((await scalar(`select coalesce(jsonb_agg(to_jsonb(k) order by kind), '[]') from public.office_cleaner_duplicate_keys('${OWNER}') k`))!)
  const email = rows.find((r: any) => r.kind === 'email'); const phone = rows.find((r: any) => r.kind === 'phone')
  assert.deepEqual(email.ids, [c(1), c(2)])
  assert.equal(phone.key, '390811234567'); assert.deepEqual(phone.ids, [c(2), c(3)])
  assert.ok(!JSON.stringify(rows).includes(c(9)))
  assert.equal(await scalar(`select public.office_phone_key('1111111111')`), null)
})

test('Pulizia: approvare unisce, sposta tutto, riempie solo i vuoti e non cancella', async () => {
  await sql(`insert into activities(user_id,contact_id,type) values('${OWNER}','${c(2)}','call'),('${OWNER}','${c(3)}','email');
    insert into tasks(user_id,contact_id) values('${OWNER}','${c(2)}');
    insert into deals(user_id,contact_id,title) values('${OWNER}','${c(3)}','Mappa');
    insert into quotes(user_id,contact_id) values('${OWNER}','${c(2)}');
    insert into invoices(user_id,contact_id,number,year) values('${OWNER}','${c(3)}',7,2026);
    insert into email_drafts(user_id,contact_id,scheduled_for) values('${OWNER}','${c(1)}','2026-11-01'),('${OWNER}','${c(2)}','2026-11-01'),('${OWNER}','${c(3)}','2026-11-02');
    insert into contact_map_links(user_id,contact_id,map_ref) values('${OWNER}','${c(1)}','capri'),('${OWNER}','${c(2)}','capri'),('${OWNER}','${c(3)}','anacapri');`)
  const id = (await propose([{ keep: c(1), drop: [c(2), c(3)], key: 'g1' }]))!
  const result = await decide(id)
  assert.equal(result.output.status, 'approved')
  assert.equal(await scalar(`select count(*) from contacts where id in ('${c(2)}','${c(3)}') and hidden`), '2')
  assert.equal(await scalar(`select count(*) from contacts`), '5')
  assert.equal(await scalar(`select count(*) from activities where contact_id='${c(1)}' and type <> 'note'`), '2')
  assert.equal(await scalar(`select count(*) from activities where contact_id='${c(1)}' and type = 'note'`), '1')
  for (const table of ['tasks', 'deals', 'quotes', 'invoices']) assert.equal(await scalar(`select count(*) from ${table} where contact_id='${c(1)}'`), '1', table)
  // La bozza automatica dello stesso giorno resta sul doppione: due non possono coesistere.
  assert.equal(await scalar(`select count(*) from email_drafts where contact_id='${c(1)}'`), '2')
  assert.equal(await scalar(`select count(*) from contact_map_links where contact_id='${c(1)}'`), '2')
  assert.equal(await scalar(`select phone from contacts where id='${c(1)}'`), '+39 081 123 4567')
  assert.equal(await scalar(`select company from contacts where id='${c(1)}'`), 'Hotel Sole')
  assert.equal(await scalar(`select alternative_emails::text from contacts where id='${c(1)}'`), '{x@other.it}')
  assert.match((await scalar(`select note from contacts where id='${c(2)}'`))!, new RegExp(`Unito in ${c(1)}`))
  assert.equal(await scalar(`select jsonb_array_length(body->'result'->'merged') from office_agent_outputs where id='${id}'`), '1')
})

test('Pulizia: due trattative aperte bloccano; nessun gruppo unito lascia la proposta in attesa', async () => {
  await sql(`insert into deals(user_id,contact_id) values('${OWNER}','${c(1)}'),('${OWNER}','${c(2)}');
    insert into activities(user_id,contact_id,type) values('${OWNER}','${c(2)}','call');`)
  const id = (await propose([{ keep: c(1), drop: [c(2)] }]))!
  const result = await decide(id)
  assert.equal(result.output, null); assert.equal(result.reason, 'merge_failed')
  assert.match(result.skipped[0].error, /2 trattative aperte/)
  assert.equal(await scalar(`select status from office_agent_outputs where id='${id}'`), 'pending')
  assert.equal(await scalar(`select count(*) from activities where contact_id='${c(2)}'`), '1')
  assert.equal(await scalar(`select count(*) from contacts where hidden`), '0')
})

test('Pulizia: un gruppo che non vale si salta, gli altri si uniscono', async () => {
  const id = (await propose([{ keep: c(1), drop: [c(2)] }, { keep: c(4), drop: [c(9)] }]))!
  const result = await decide(id)
  assert.equal(result.output.status, 'approved')
  assert.equal(await scalar(`select jsonb_array_length(body->'result'->'skipped') from office_agent_outputs where id='${id}'`), '1')
  assert.equal(await scalar(`select coalesce(hidden,false)::text from contacts where id='${c(9)}'`), 'false')
})

test('Pulizia: rifiutare non tocca niente; otto clic concorrenti uniscono una volta', async () => {
  const rejected = (await propose([{ keep: c(1), drop: [c(2)] }]))!
  assert.equal((await decide(rejected, 'rejected')).output.status, 'rejected')
  assert.equal(await scalar(`select count(*) from contacts where hidden`), '0')
  const id = (await propose([{ keep: c(1), drop: [c(2)] }]))!
  const decisions = await Promise.all(Array.from({ length: 8 }, () => decide(id)))
  assert.equal(decisions.filter((d) => d.output?.status === 'approved').length, 1)
  assert.equal(await scalar(`select count(*) from activities where type='note'`), '1')
})

test('Pulizia: proposte malformate rifiutate, funzioni chiuse ai ruoli del browser', async () => {
  await expectError(`select public.office_merge_contacts('${OWNER}','${c(1)}',array['${c(1)}']::uuid[])`)
  await expectError(`select public.office_merge_contacts('${OWNER}','${c(1)}',array[]::uuid[])`)
  const bad = (await propose([]))!
  await expectError(`select public.decide_office_output('${bad}','${OWNER}','approved')`)
  for (const fn of ['office_merge_contacts(uuid,uuid,uuid[],text)', 'office_cleaner_scan(uuid)', 'office_cleaner_duplicate_keys(uuid,integer)', 'decide_office_output(uuid,uuid,text)']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated','public.${fn}','execute')`), 'f', fn)
    assert.equal(await scalar(`select has_function_privilege('anon','public.${fn}','execute')`), 'f', fn)
  }
})

test('Pulizia: lo scan conta senza modificare', async () => {
  await sql(`insert into contacts(id,user_id,name,email,contact_scope,status,created_at,updated_at) values
    ('${c(5)}','${OWNER}','Rotta','non-una-email','holding','New',now(),now()),
    ('${c(6)}','${OWNER}','Fermo','noreply@x.it','crm','Interested','2025-01-01','2025-01-01'),
    ('${c(7)}','${OWNER}','Pec','studio@pec.it','holding','New',now(),now());
    insert into tourism_entities(user_id,kind,status,name,name_key,country_code) values
    ('${OWNER}','organization','VERIFIED','Comune di Amalfi','comune di amalfi','IT'),('${OWNER}','organization','NEW','Amalfi','amalfi','IT');`)
  const before = await scalar(`select md5(string_agg(to_jsonb(c)::text, '' order by id)) from contacts c`)
  const scan = await json(`select public.office_cleaner_scan('${OWNER}')`)
  assert.equal(scan.invalid_emails.count, 1); assert.equal(scan.role_emails.count, 1); assert.equal(scan.pec_emails.count, 1)
  assert.equal(scan.stale_pipeline.count, 1); assert.equal(scan.tourism_near_duplicates.count, 1)
  assert.equal(await scalar(`select md5(string_agg(to_jsonb(c)::text, '' order by id)) from contacts c`), before)
})
