/** Quota, bozze e concorrenza sul Postgres usa-e-getta, mai su Supabase remoto. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resetDatabase, sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_sales_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const contactId = (i: number) => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`
const sql = (s: string) => query(s, DB)
const scalar = (s: string) => value(s, DB)
const expectError = (s: string) => failure(s, DB)
let runId: string
const create = async (i: number, key = `sales:${i}`) => JSON.parse((await scalar(`select public.create_office_email_draft('${runId}','${contactId(i)}','${key}','Promemoria','Da rivedere','<p>Da rivedere</p>','Preventivo in attesa')`))!) as { id: string | null; created: boolean; reason?: string }

before(async () => {
  await resetDatabase(DB)
  await sql(`create table public.email_drafts(id uuid primary key default gen_random_uuid(), user_id uuid not null,
    contact_id uuid not null, subject text, body_text text, body_html text, source text not null default 'auto' constraint email_drafts_source_check check (source in ('auto', 'manual')), status text, created_at timestamptz default now());
    create table public.gmail_messages(id uuid primary key default gen_random_uuid(), user_id uuid not null,
    contact_id uuid, direction text, from_email text, sent_at timestamptz);
    insert into auth.users(id) values('${OWNER}'),('${OTHER}');`)
  for (const file of ['20261022170450_office_finance.sql','20261022175856_office_sales_followup.sql']) {
    await sql(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
})

beforeEach(async () => {
  await sql(`truncate public.office_agents cascade;
    truncate public.gmail_messages, public.contacts cascade;
    insert into office_agents(id,user_id,name,department,enabled) values('sales_followup','${OWNER}','Commerciale','commerciale',true);
    insert into contacts(id,user_id,name,email) values ${Array.from({ length: 20 }, (_, i) => `('${contactId(i)}','${OWNER}','Ente ${i}','ufficio${i}@example.it')`).join(',')};`)
  const result = JSON.parse((await scalar(`select public.claim_office_agent_run('sales_followup','${OWNER}','test')`))!)
  runId = result.run.id
})

test('Commerciale: 20 richieste concorrenti creano solo 15 bozze; cancellare non restituisce quota', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => create(i)))
  assert.equal(results.filter((r) => r.created).length, 15)
  assert.equal(results.filter((r) => r.reason === 'daily_cap').length, 5)
  assert.equal(await scalar('select used_count from office_agent_daily_quotas'), '15')
  assert.equal(await scalar("select count(*) from email_drafts where source='office' and status='pending'"), '15')
  await sql(`delete from email_drafts where id=(select id from email_drafts limit 1)`)
  const uncreated = results.findIndex((r) => !r.created)
  assert.equal((await create(uncreated)).reason, 'daily_cap')
  assert.equal(await scalar('select used_count from office_agent_daily_quotas'), '15')
})

test('Commerciale: retry e schede con email uguale non creano doppie bozze', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => create(0)))
  assert.equal(results.filter((r) => r.created).length, 1)
  assert.equal(await scalar('select used_count from office_agent_daily_quotas'), '1')
  await sql(`update contacts set email=' UFFICIO0@EXAMPLE.IT ' where id='${contactId(1)}'`)
  assert.equal((await create(1)).reason, 'pending_draft')
  assert.equal(await scalar('select count(*) from email_drafts'), '1')
})

test('Commerciale: nuova risposta anche su scheda gemella blocca prima del salvataggio', async () => {
  await sql(`insert into gmail_messages(user_id,contact_id,direction,from_email,sent_at)
    values('${OWNER}','${contactId(1)}','inbound',' UFFICIO0@EXAMPLE.IT ',now());`)
  assert.equal((await create(0)).reason, 'reply_received')
  assert.equal(await scalar('select count(*) from email_drafts'), '0')
  assert.equal(await scalar('select count(*) from office_agent_daily_quotas'), '0')
})

test('Commerciale: holding e altro workspace rifiutati; quota leggibile solo dal proprietario', async () => {
  await sql(`update contacts set contact_scope='holding' where id='${contactId(0)}'`)
  assert.match((await expectError(`select public.create_office_email_draft('${runId}','${contactId(0)}','holding','A','B','B','C')`))!, /Contatto non disponibile/)
  await sql(`update contacts set user_id='${OTHER}' where id='${contactId(0)}'`)
  assert.match((await expectError(`select public.create_office_email_draft('${runId}','${contactId(0)}','altro','A','B','B','C')`))!, /Contatto non disponibile/)
  await create(1)
  // SET produce righe separate nel client psql: ispezionare il risultato SELECT.
  const owner = await sql(`set role authenticated; set request.jwt.claim.sub='${OWNER}'; select count(*) from office_agent_daily_quotas`)
  const other = await sql(`set role authenticated; set request.jwt.claim.sub='${OTHER}'; select count(*) from office_agent_daily_quotas`)
  assert.equal(owner.at(-1)?.[0], '1'); assert.equal(other.at(-1)?.[0], '0')
  assert.match((await expectError(`set role authenticated; update office_agent_daily_quotas set used_count=0`))!, /permission denied/)
  assert.match((await expectError(`set role authenticated; select public.create_office_email_draft('${runId}','${contactId(1)}','vietato','A','B','B','C')`))!, /permission denied/)
})
