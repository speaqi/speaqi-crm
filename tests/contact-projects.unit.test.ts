import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('progetti separati, accesso per contatto e protezione dei collegamenti e dei duplicati', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create schema auth; create role authenticated; create role anon;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.contacts(id uuid primary key,user_id uuid not null,assignee uuid);
      create table public.tasks(id uuid primary key,user_id uuid not null,contact_id uuid);
      create table public.quotes(id uuid primary key,user_id uuid not null,contact_id uuid);
      create table public.invoices(id uuid primary key,user_id uuid not null,contact_id uuid,issue_date date not null);
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now(); return new; end$$;
      alter table contacts enable row level security;
      create policy contacts_test on contacts for select to authenticated using (user_id=auth.uid() or assignee=auth.uid());
      grant usage on schema public,auth to authenticated; grant select on contacts to authenticated;
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
      insert into contacts values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261113062804_contact_work.sql', import.meta.url), 'utf8'))
    await db.exec(`insert into crm_projects(id,user_id,contact_id,name,price,status) values
      ('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Sito',100,'demo'),
      ('aaaaaaaa-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Mappa',200,'active'),
      ('bbbbbbbb-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Altro',300,'demo');
      insert into invoices(id,user_id,contact_id,issue_date,externally_issued,external_number,payment_state,paid_at) values ('cccccccc-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-01-01',true,'12/2026','paid','2026-01-05');`)
    await assert.rejects(db.exec(`insert into invoices(id,user_id,issue_date,externally_issued,external_number) values ('cccccccc-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','2026-02-01',true,'12/2026')`), /duplicate key/)
    await assert.rejects(db.exec(`insert into tasks(id,user_id,contact_id,project_id) values ('dddddddd-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-0000-4000-8000-000000000001')`), /Progetto non valido/)
    await db.exec(`set role authenticated; set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222'`)
    const visible = await db.query<{ name: string }>('select name from crm_projects order by name')
    assert.deepEqual(visible.rows.map(r => r.name), ['Mappa', 'Sito'])
    await assert.rejects(db.exec(`insert into crm_projects(user_id,contact_id,name) values ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Non assegnato')`), /row-level security/)
  } finally { await db.close() }
})
