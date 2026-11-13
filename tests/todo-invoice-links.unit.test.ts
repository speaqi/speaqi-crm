import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('collegamenti espliciti tra attività della lavagna e fatture restano del titolare', async () => {
  const db = new PGlite()
  const owner = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const task = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const contactTask = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const invoice = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const otherInvoice = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const secondInvoice = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  try {
    await db.exec(`create schema auth; create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.tasks(id uuid primary key,user_id uuid not null,contact_id uuid);
      create table public.invoices(id uuid primary key,user_id uuid not null);
      alter table public.tasks enable row level security; alter table public.invoices enable row level security;
      create policy tasks_owner on public.tasks for select to authenticated using(user_id=auth.uid());
      create policy invoices_owner on public.invoices for select to authenticated using(user_id=auth.uid());
      grant usage on schema public,auth to authenticated; grant select on public.tasks,public.invoices to authenticated;
      insert into auth.users values ('${owner}'),('${other}');
      insert into tasks values ('${task}','${owner}',null),('${contactTask}','${owner}','${other}');
      insert into invoices values ('${invoice}','${owner}'),('${otherInvoice}','${other}'),('${secondInvoice}','${owner}');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261113071029_todo_invoice_links.sql', import.meta.url),'utf8'))
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`)
    await db.exec(`insert into todo_invoice_links(user_id,task_id,invoice_id) values ('${owner}','${task}','${invoice}')`)
    await db.exec(`insert into todo_invoice_links(user_id,task_id,invoice_id) values ('${owner}','${task}','${secondInvoice}')`)
    await assert.rejects(db.exec(`insert into todo_invoice_links(user_id,task_id,invoice_id) values ('${owner}','${task}','${invoice}')`), /duplicate key/)
    await assert.rejects(db.exec(`insert into todo_invoice_links(user_id,task_id,invoice_id) values ('${owner}','${contactTask}','${invoice}')`), /non accessibile/)
    await assert.rejects(db.exec(`insert into todo_invoice_links(user_id,task_id,invoice_id) values ('${owner}','${task}','${otherInvoice}')`), /non accessibile/)
    await db.exec(`set request.jwt.claim.sub='${other}'`)
    const hidden = await db.query('select * from todo_invoice_links')
    assert.equal(hidden.rows.length,0)
    await db.exec(`set request.jwt.claim.sub='${owner}'; delete from todo_invoice_links where task_id='${task}' and invoice_id='${invoice}'`)
    const untouched = await db.query('select id from invoices')
    assert.equal(untouched.rows.length,2)
  } finally { await db.close() }
})
