import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
const first = migration('20261026120000_p0_quote_secrets')
const final = migration('20261026120100_p0_quotes_rls')
const scalar = async (query: string) => Object.values((await db.query(query)).rows[0] as object)[0]
const actAs = async (role: string, uid: string) => db.exec(`set role ${role}; set request.jwt.claim.sub = '${uid}';`)
const quote = async (legacy = 'legacy-token') => {
  const id = randomUUID()
  await db.query(`insert into quotes (id,user_id,public_token,quote_acceptance_token,quote_number,
    customer_email,status,items,subtotal_amount,discount_amount,tax_rate,tax_amount,total_amount,
    currency,billing_interval,payment_method,payment_terms_mode,deposit_percent,deposit_amount,balance_amount)
    values ($1::uuid,$2::uuid,$1::text,$3,'Q-1','client@example.com','sent',
    '[{"id":"line-a","description":"Piattaforma","quantity":1,"unit_price":990,"line_total":990}]',
    990,0,22,217.8,1207.8,'EUR','year','stripe','percent',100,1207.8,0)`, [id, OWNER, legacy])
  return id
}
async function rejectsSql(query: string, pattern: RegExp) {
  await db.exec('savepoint expected_failure')
  await assert.rejects(db.exec(query), pattern)
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure')
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema auth, public to anon,authenticated,service_role;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now();return new;end; $$;
    create table contacts(id uuid primary key,user_id uuid,responsible text,assigned_agent text);
    create table team_members(user_id uuid,auth_user_id uuid,email text,name text,allowed_areas text[]);
    create table business_goals(user_id uuid);
    create table quotes(id uuid primary key,user_id uuid,contact_id uuid,public_token text,
      quote_acceptance_token text,quote_number text,customer_name text,title text,
      contract_accepted_at timestamptz,contract_signer_email text,quote_acceptance_email text,
      customer_email text,status text,accepted_at timestamptz,updated_at timestamptz,
      contract_auto_accepted boolean,sales_team_member_id uuid,contract_terms text,items jsonb,
      subtotal_amount numeric,discount_amount numeric,tax_rate numeric,tax_amount numeric,total_amount numeric,
      currency text,billing_interval text,contract_signer_name text,payment_method text,payment_terms_mode text,
      deposit_percent numeric,deposit_manual_amount numeric,deposit_amount numeric,balance_amount numeric,
      valid_until date,subscription_status text);
    create table quote_signatures(quote_id uuid,user_id uuid,signer_name text,signer_email text,
      signature_png text,ip text,user_agent text,channel text,terms_snapshot jsonb,amounts_snapshot jsonb);
    create function mark_quote_checkout_created(text,text,text) returns void language sql as $$ select $$;
    alter table quotes enable row level security;
    alter table business_goals enable row level security;
    create policy quotes_workspace on quotes for all to authenticated using(true) with check(true);
    grant select,insert,update,delete on all tables in schema public to authenticated,service_role;`)
  // Un token già presente prima del backfill.
  await quote('before-backfill')
  await db.exec(first)
})
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback; reset role') })
after(async () => { await db.close() })

test('link legacy creati e rigenerati durante il deploy sopravvivono alla pulizia finale', async () => {
  const id = await quote('during-deploy')
  await db.query(`update quotes set quote_acceptance_token='reissued' where id=$1`, [id])
  await db.exec(final)
  assert.equal(await scalar(`select quote_acceptance_token from quotes where id='${id}'`), null)
  const result = await scalar(`select accept_public_quote_contract('${id}','reissued')`) as any
  assert.equal(result.ok, true)
  const earlier = await scalar(`select accept_public_quote_contract(public_token,'before-backfill') from quotes where quote_number='Q-1' and id<>'${id}'`) as any
  assert.equal(earlier.ok, true)
})

test('la rotazione revoca atomicamente il token legacy prima della migration finale', async () => {
  const id = await quote('old-link')
  await actAs('authenticated', OWNER)
  assert.equal(await scalar(`select rotate_quote_acceptance_token('${id}','new-link','new@example.com')`), true)
  assert.equal(await scalar(`select quote_acceptance_token from quotes where id='${id}'`), null)
  assert.equal((await scalar(`select accept_public_quote_contract('${id}','old-link')`) as any).ok, false)
  assert.equal((await scalar(`select accept_public_quote_contract('${id}','new-link')`) as any).ok, true)
})

test('il trigger rifiuta la scrittura economica preparata prima della firma e protegge gli zero', async () => {
  const id = await quote()
  await db.exec(`update quotes set tax_rate=0,tax_amount=0,total_amount=990,deposit_percent=0,
    deposit_amount=0,balance_amount=990 where id='${id}';
    update quotes set contract_accepted_at=now() where id='${id}'`)
  for (const change of ['total_amount=1209.01', 'tax_rate=22', 'deposit_percent=30',
    'contract_accepted_at=null', `currency='USD'`, `billing_interval='one_time'`,
    `items=jsonb_set(items,'{0,quantity}','1.001')`]) {
    await rejectsSql(`update quotes set ${change} where id='${id}'`, /signed_quote_immutable/)
  }
  await db.exec(`update quotes set items=jsonb_set(items,'{0,id}','"line-b"'),title='Titolo aggiornato' where id='${id}'`)
  assert.equal(await scalar(`select total_amount::text from quotes where id='${id}'`), '990')
})

test('RLS: collaboratore assegnato legge ma non modifica, non vede secret e finanza richiede area', async () => {
  const id = await quote()
  const contactId = randomUUID()
  await db.exec(`insert into contacts values('${contactId}','${OWNER}','Agente',null);
    insert into team_members values('${OWNER}','${MEMBER}','member@example.com','Agente','{}');
    insert into business_goals values('${OWNER}');
    update quotes set contact_id='${contactId}' where id='${id}'`)
  await db.exec(final)
  await actAs('authenticated', MEMBER)
  assert.equal(await scalar(`select count(*)::int from quotes where id='${id}'`), 1)
  assert.equal(await scalar('select count(*)::int from quote_secrets'), 0)
  assert.equal(await scalar('select count(*)::int from business_goals'), 0)
  assert.equal((await db.query(`update quotes set total_amount=1 where id='${id}' returning id`)).rows.length, 0)
  await db.exec(`reset role; update team_members set allowed_areas='{finanza}'`)
  await actAs('authenticated', MEMBER)
  assert.equal(await scalar('select count(*)::int from business_goals'), 1)
  assert.equal(await scalar(`select rotate_quote_acceptance_token('${id}','stolen','bad@example.com')`), false)
})

test('claim checkout persistente, sostituzione condizionale e privilegi solo service role', async () => {
  const id = await quote()
  await db.exec(`update quotes set contract_accepted_at=now() where id='${id}'`)
  await actAs('service_role', '')
  const claim = async (params: object, replaces: string | null = null) =>
    (await db.query(`select claim_quote_checkout_attempt($1,$2,$3) as value`, [id, JSON.stringify(params), replaces])).rows[0] as any
  const a = (await claim({price: 'original'})).value
  const b = (await claim({price: 'changed'})).value
  assert.equal(a.attempt_id, b.attempt_id)
  assert.deepEqual(b.params, {price: 'original'})
  const c = (await claim({price: 'replacement'}, a.attempt_id)).value
  const d = (await claim({price: 'other'}, a.attempt_id)).value
  assert.notEqual(a.attempt_id, c.attempt_id)
  assert.equal(c.attempt_id, d.attempt_id)
  assert.deepEqual(d.params, {price: 'replacement'})
  await db.exec('reset role')
  await db.exec(final)
  assert.equal(await scalar(`select has_function_privilege('anon','public.claim_quote_checkout_attempt(uuid,jsonb,uuid)','execute')`), false)
  assert.equal(await scalar(`select has_function_privilege('authenticated','public.claim_quote_checkout_attempt(uuid,jsonb,uuid)','execute')`), false)
  assert.equal(await scalar(`select has_function_privilege('anon','public.mark_quote_checkout_created(text,text,text)','execute')`), false)
  assert.equal(await scalar(`select has_table_privilege('authenticated','quote_checkout_attempts','select')`), false)
})
