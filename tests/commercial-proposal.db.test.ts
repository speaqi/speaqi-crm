import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('il preventivo Tourism resta nel workspace, non può essere anche Agency e sopravvive alla cancellazione del deck', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema auth;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth,public to authenticated;
      grant execute on function auth.uid() to authenticated;
      create table public.tourism_decks(id uuid primary key, user_id uuid not null);
      create table public.quotes(id uuid primary key, user_id uuid not null, agency_project_id uuid, created_at timestamptz default now());
      insert into tourism_decks values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111');
      insert into tourism_decks values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222');
      alter table tourism_decks enable row level security;
      alter table quotes enable row level security;
      create policy owner on tourism_decks for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
      create policy owner on quotes for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
      grant select,insert,update,delete on tourism_decks,quotes to authenticated;
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20261021150547_commercial_proposal_templates.sql', import.meta.url), 'utf8'))
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const owner = '11111111-1111-4111-8111-111111111111'
    const deck = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await db.exec(`set request.jwt.claim.sub='${owner}';set role authenticated`)
    await assert.rejects(db.exec(`insert into quotes(id,user_id,tourism_deck_id) values('${id}','${owner}','cccccccc-cccc-4ccc-8ccc-cccccccccccc')`))
    await assert.rejects(db.exec(`insert into quotes(id,user_id,tourism_deck_id) values('${id}','22222222-2222-4222-8222-222222222222','${deck}')`))
    await db.exec(`insert into quotes(id,user_id,tourism_deck_id) values('${id}','${owner}','${deck}')`)
    await assert.rejects(db.exec(`update quotes set agency_project_id='${id}' where id='${id}'`))
    await assert.rejects(db.exec(`update quotes set user_id='22222222-2222-4222-8222-222222222222' where id='${id}'`))
    await db.exec(`delete from tourism_decks where id='${deck}'`)
    const { rows } = await db.query<{ tourism_deck_id: string | null }>('select tourism_deck_id from quotes')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].tourism_deck_id, null)
  } finally { await db.close() }
})
