import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Agente Distribuzione: la migration vera su PGlite. Si prova il tetto giornaliero degli
// invii (anche con gli esiti incerti), l'unicità per ente e per tappa e la RLS di sola lettura.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite
const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)

async function outreach(user: string, n: number) {
  await db.exec('reset role')
  const entity = (await db.query<{ id: string }>(`insert into tourism_entities(user_id,name) values($1,$2) returning id`, [user, `Ente ${n}`])).rows[0].id
  const row = (await db.query<{ id: string }>(`insert into distribution_outreach(user_id,entity_id,email,email_domain,segment)
    values($1,$2,$3,$4,'operator') returning id`, [user, entity, `info@ente${n}.it`, `ente${n}.it`])).rows[0].id
  const message = (await db.query<{ id: string }>(`insert into distribution_outreach_messages(user_id,outreach_id,step,subject,body_text,status,approved_at)
    values($1,$2,1,'Oggetto','Buongiorno, sono Massimo Morgante, fondatore di Speaqi.','approved',now()) returning id`, [user, row])).rows[0].id
  return { entity, outreach: row, message }
}
const claim = async (user: string, message: string, cap: number) =>
  (await db.query<{ ok: boolean }>(`select public.claim_distribution_message($1,$2,$3) as ok`, [user, message, cap])).rows[0].ok

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${OWNER}'), ('${OTHER}');
    create table public.tourism_entities(id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null);
    create table public.contacts(id uuid primary key default gen_random_uuid(), user_id uuid not null);
    create table public.deals(id uuid primary key default gen_random_uuid(), user_id uuid not null);
    grant usage on schema public to authenticated, anon, service_role;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261125124105_distribution_outreach.sql', import.meta.url), 'utf8'))
  await db.exec('grant select on all tables in schema public to authenticated')
  // Applicarla due volte non rompe niente.
  await db.exec(await readFile(new URL('../supabase/migrations/20261125124105_distribution_outreach.sql', import.meta.url), 'utf8'))
  for (let i = 0; i < 2; i++) await db.exec(await readFile(new URL('../supabase/migrations/20261126155013_partner_profiles.sql', import.meta.url), 'utf8'))
  for (let i = 0; i < 2; i++) await db.exec(await readFile(new URL('../supabase/migrations/20261127101500_distribution_abroad.sql', import.meta.url), 'utf8'))
  await db.exec('grant select on all tables in schema public to authenticated')
})

test('tetto giornaliero: si prende solo fino al tetto, e un esito incerto conta', async () => {
  const a = await outreach(OWNER, 1), b = await outreach(OWNER, 2), c = await outreach(OWNER, 3)
  assert.equal(await claim(OWNER, a.message, 2), true)
  assert.equal(await claim(OWNER, a.message, 2), false, 'già presa: non si riprende')
  await db.exec(`update distribution_outreach_messages set status='unknown' where id='${a.message}'`)
  assert.equal(await claim(OWNER, b.message, 2), true)
  assert.equal(await claim(OWNER, c.message, 2), false, 'tetto pieno, anche con un esito incerto')
  const status = (await db.query<{ status: string }>(`select status from distribution_outreach_messages where id=$1`, [c.message])).rows[0].status
  assert.equal(status, 'approved', 'il messaggio oltre il tetto resta in coda')
  // Il tetto è per proprietario: l'altro workspace non ne risente.
  const other = await outreach(OTHER, 4)
  assert.equal(await claim(OTHER, other.message, 2), true)
  // Un messaggio di un altro proprietario non si prende.
  const d = await outreach(OWNER, 5)
  assert.equal(await claim(OTHER, d.message, 10), false)
})

test('un ente una volta sola, una tappa una volta sola', async () => {
  const a = await outreach(OWNER, 10)
  await assert.rejects(db.query(`insert into distribution_outreach(user_id,entity_id,email,email_domain,segment) values($1,$2,'info@x.it','x.it','agency')`, [OWNER, a.entity]))
  await assert.rejects(db.query(`insert into distribution_outreach_messages(user_id,outreach_id,step,subject,body_text) values($1,$2,1,'Altro','Un altro testo abbastanza lungo.')`, [OWNER, a.outreach]))
  await assert.rejects(db.query(`insert into distribution_outreach_messages(user_id,outreach_id,step,subject,body_text) values($1,$2,4,'Altro','Un altro testo abbastanza lungo.')`, [OWNER, a.outreach]))
  await assert.rejects(db.query(`insert into distribution_outreach(user_id,entity_id,email,email_domain,segment) values($1,$2,'non-una-email','x.it','agency')`, [OWNER, (await outreach(OWNER, 11)).entity]))
})

test('RLS: il proprietario legge, nessuno scrive dal client, la RPC è del service role', async () => {
  await asUser(OWNER)
  const mine = (await db.query<{ n: number }>(`select count(*)::int n from distribution_outreach`)).rows[0].n
  assert.ok(mine > 0)
  await assert.rejects(db.query(`update distribution_outreach set status='stopped'`))
  await assert.rejects(db.query(`select public.claim_distribution_message('${OWNER}', gen_random_uuid(), 5)`))
  await asUser(OTHER)
  const others = (await db.query<{ n: number }>(`select count(*)::int n from distribution_outreach where user_id='${OWNER}'`)).rows[0].n
  assert.equal(others, 0)
  await db.exec('reset role')
})

test('profili dei partner: una riga per ente, valori controllati, sola lettura per il proprietario', async () => {
  await db.exec('reset role')
  const entity = (await db.query<{ id: string }>(`insert into tourism_entities(user_id,name) values($1,'Profilo') returning id`, [OWNER])).rows[0].id
  await db.query(`insert into partner_profiles(user_id,entity_id,activities,audience,places,guide_slugs,value,next)
    values($1,$2,'{incoming}','foreign','[{"key":"roma"}]','{roma}',80,'write')`, [OWNER, entity])
  await assert.rejects(db.query(`insert into partner_profiles(user_id,entity_id,value,next) values($1,$2,50,'write')`, [OWNER, entity]), 'una riga per ente')
  const other = (await db.query<{ id: string }>(`insert into tourism_entities(user_id,name) values($1,'Altro') returning id`, [OWNER])).rows[0].id
  await assert.rejects(db.query(`insert into partner_profiles(user_id,entity_id,value,next) values($1,$2,150,'write')`, [OWNER, other]))
  await assert.rejects(db.query(`insert into partner_profiles(user_id,entity_id,value,next) values($1,$2,50,'boh')`, [OWNER, other]))
  await assert.rejects(db.query(`insert into partner_profiles(user_id,entity_id,value,next,site_email) values($1,$2,50,'write','non-email')`, [OWNER, other]))
  // I promemoria ricordano le guide della prima email.
  const o = await outreach(OWNER, 40)
  await db.query(`update distribution_outreach set guides='{roma,firenze}', national=false where id=$1`, [o.outreach])
  await asUser(OWNER)
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from partner_profiles`)).rows[0].n, 1)
  await assert.rejects(db.query(`update partner_profiles set value=1`))
  await asUser(OTHER)
  assert.equal((await db.query<{ n: number }>(`select count(*)::int n from partner_profiles`)).rows[0].n, 0)
  await db.exec('reset role')
})

test('guide estere: passo «write_abroad» e proposta «abroad» ammessi, il resto no', async () => {
  const cols = (await db.query<{ table_name: string; column_name: string }>(`select table_name, column_name from information_schema.columns
    where (table_name = 'partner_profiles' and column_name = 'abroad') or (table_name = 'distribution_outreach' and column_name in ('offer','abroad'))`)).rows
  assert.equal(cols.length, 3)
  const checks = (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conname in ('partner_profiles_next_check','distribution_outreach_offer_check')`)).rows.map((r) => r.def).join(' ')
  assert.match(checks, /write_abroad/)
  assert.match(checks, /'abroad'/)
})
