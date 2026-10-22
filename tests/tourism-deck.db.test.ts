import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite

const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;create role authenticated nologin;create role anon nologin;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users(id) values('${OWNER}'),('${OTHER}');
    alter default privileges in schema public grant all on tables to anon,authenticated;
    create table public.tourism_entities(id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid(),name text);
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261019190000_tourism_decks.sql', import.meta.url), 'utf8'))
  await db.exec(`insert into public.tourism_entities(id,user_id,name) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${OWNER}','Ente di prova')`)
})

test('un deck nasce in bozza con un token pubblico lungo e unico', async () => {
  await asUser(OWNER)
  await db.exec(`insert into public.tourism_decks(title,destination) values('A','Capri'),('B','Ischia')`)
  const { rows } = await db.query<{ public_token: string; status: string }>('select public_token,status from public.tourism_decks order by title')
  assert.equal(rows.length, 2)
  assert.match(rows[0].public_token, /^[0-9a-f]{64}$/)
  assert.notEqual(rows[0].public_token, rows[1].public_token)
  assert.equal(rows[0].status, 'draft')
})

test('un altro utente non vede né scrive i deck del proprietario', async () => {
  await asUser(OTHER)
  assert.equal((await db.query('select 1 from public.tourism_decks')).rows.length, 0)
  await assert.rejects(db.exec(`insert into public.tourism_decks(user_id,title,destination) values('${OWNER}','X','Y')`))
  await assert.rejects(db.exec(`insert into public.tourism_deck_templates(user_id,content) values('${OWNER}','{}')`))
})

test('approvato e data di approvazione vanno insieme', async () => {
  await asUser(OWNER)
  await assert.rejects(db.exec(`update public.tourism_decks set status='approved' where title='A'`))
  await db.exec(`update public.tourism_decks set status='approved',approved_at=now() where title='A'`)
  await assert.rejects(db.exec(`update public.tourism_decks set approved_at=null where title='A'`))
})

test('un solo modello di partenza per proprietario', async () => {
  await asUser(OWNER)
  await db.exec(`insert into public.tourism_deck_templates(content) values('{"version":1}')`)
  await assert.rejects(db.exec(`insert into public.tourism_deck_templates(content) values('{"version":1}')`))
})

test('cancellando l’ente il deck resta', async () => {
  await db.exec('reset role')
  await db.exec(`insert into public.tourism_decks(user_id,entity_id,title,destination) values('${OWNER}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','C','Procida')`)
  await db.exec(`delete from public.tourism_entities where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`)
  const { rows } = await db.query<{ entity_id: string | null }>(`select entity_id from public.tourism_decks where title='C'`)
  assert.equal(rows[0].entity_id, null)
})
