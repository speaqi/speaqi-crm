import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseRecurringInput, parseReportConfig } from '../src/lib/office-recurring'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const valid = { title: 'Partner', instruction: 'Cerca partner per Roma', every_days: 2, local_time: '09:00', next_local_date: '2026-10-31', enabled: true }

test('agenda: convalida date, frequenze e istruzioni', () => {
  assert.equal(parseRecurringInput(valid).every_days, 2)
  for (const patch of [{ every_days: 3 }, { next_local_date: '2026-02-30' }, { local_time: '09:00extra' }, { instruction: '' }, { arbitrary: true }]) {
    assert.throws(() => parseRecurringInput({ ...valid, ...patch }))
  }
  assert.equal(parseReportConfig({ every_days: 7, local_time: '18:00', next_local_date: '2026-11-01', enabled: true, revision: null }).every_days, 7)
  assert.throws(() => parseReportConfig({ every_days: 8, local_time: '18:00', next_local_date: '2026-11-01', enabled: true, revision: null }))
})

test('agenda SQL: un turno arretrato, deduplicazione, revisioni e isolamento', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.office_agents(id text,user_id uuid,enabled boolean);
      create table public.office_director_orders(id uuid primary key default gen_random_uuid(),user_id uuid,source text,text text,status text);
      create table public.office_agent_outputs(id uuid primary key default gen_random_uuid(),user_id uuid,agent_id text,kind text,title text,body jsonb,status text,output_key text);
      create table public.office_work_items(id uuid primary key default gen_random_uuid(),user_id uuid,order_id uuid,agent_id text,action text,status text,result_summary text,reason text,result jsonb default '{}'::jsonb,updated_at timestamptz default now());
      create table public.office_budget_ledger(user_id uuid,created_at timestamptz,actual_cents integer,reserved_cents integer);
      create table public.test_work(id uuid primary key default gen_random_uuid(),user_id uuid,spec jsonb);
      create function public.office_work_enqueue(p_user_id uuid,p_spec jsonb) returns jsonb language plpgsql as $$
        begin insert into public.test_work(user_id,spec) values(p_user_id,p_spec); return '{}'::jsonb; end $$;
      insert into auth.users values ('${USER}'),('${OTHER}');
      insert into public.office_agents values('director','${USER}',true),('director','${OTHER}',true);`)
    await db.exec(await readFile('supabase/migrations/20261031100351_office_recurring_orders.sql', 'utf8'))
    const privileges = await db.query<{ allowed: boolean }>(`select has_function_privilege('authenticated',
      'public.office_recurring_materialize(uuid,integer)','execute') as allowed`)
    assert.equal(privileges.rows[0].allowed, false)
    const summer = await db.query<{ s: any }>(`select public.office_recurring_create('${OTHER}','Estate','Prova',7,'09:00','2026-03-30') as s`)
    const winter = await db.query<{ s: any }>(`select public.office_recurring_create('${OTHER}','Inverno','Prova',7,'09:00','2026-10-26') as s`)
    assert.equal(new Date(summer.rows[0].s.next_due_at).toISOString(), '2026-03-30T07:00:00.000Z')
    assert.equal(new Date(winter.rows[0].s.next_due_at).toISOString(), '2026-10-26T08:00:00.000Z')
    await db.exec(`insert into public.office_work_items(user_id,agent_id,action,status,result_summary) values
      ('${USER}','director','interpret_order','succeeded','Fatto'),('${OTHER}','director','interpret_order','failed','Riservato');
      insert into public.office_budget_ledger(user_id,created_at,actual_cents,reserved_cents) values
      ('${USER}',now(),3,5),('${OTHER}',now(),100,100);`)
    const config = await db.query<{ c: any }>(`select public.office_report_configure('${USER}',7,'00:00',
      ((now() at time zone 'Europe/Rome')::date - 1),true,null) as c`)
    assert.equal(config.rows[0].c.enabled, true)
    assert.equal((await db.query<{ r: any }>(`select public.office_report_materialize('${USER}') as r`)).rows[0].r.created, true)
    assert.equal((await db.query<{ r: any }>(`select public.office_report_materialize('${USER}') as r`)).rows[0].r.created, false)
    const report = (await db.query<{ body: any }>(`select body from public.office_agent_outputs where user_id='${USER}'`)).rows[0].body
    assert.equal(report.aggiornati_nel_periodo.riusciti, 1)
    assert.equal(report.costi.spesi_centesimi, 3)
    assert.doesNotMatch(JSON.stringify(report), /Riservato/)
    const created = await db.query<{ s: any }>(`select public.office_recurring_create('${USER}','Partner','Cerca partner',2,'09:00',
      ((now() at time zone 'Europe/Rome')::date - 8)) as s`)
    const schedule = created.rows[0].s
    await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; set role authenticated`)
    const visible = await db.query<{ n: number }>('select count(*)::int as n from public.office_recurring_orders')
    assert.equal(visible.rows[0].n, 1, 'le agende degli altri workspace sono invisibili')
    await assert.rejects(db.query(`select public.office_recurring_materialize('${USER}',5)`), /permission denied/i)
    await db.exec('reset role')
    await db.exec(`update public.office_agents set enabled=false where user_id='${USER}'`)
    const disabled = await db.query<{ r: any }>(`select public.office_recurring_materialize('${USER}',5) as r`)
    assert.equal(disabled.rows[0].r.reason, 'director_disabled')
    assert.equal((await db.query('select * from public.test_work')).rows.length, 0)
    await db.exec(`update public.office_agents set enabled=true where user_id='${USER}'`)
    const first = await db.query<{ r: any }>(`select public.office_recurring_materialize('${USER}',5) as r`)
    assert.equal(first.rows[0].r.created, 1)
    const second = await db.query<{ r: any }>(`select public.office_recurring_materialize('${USER}',5) as r`)
    assert.equal(second.rows[0].r.created, 0)
    assert.equal((await db.query('select * from public.office_recurring_runs')).rows.length, 1)
    assert.equal((await db.query('select * from public.test_work')).rows.length, 1)
    await db.exec(`insert into public.office_work_items(user_id,order_id,agent_id,action,status,result_summary)
      select user_id,(spec->>'order_id')::uuid,'director','interpret_order','succeeded','Incarico concluso' from public.test_work`)
    await db.query(`select public.office_report_configure('${USER}',7,'00:00',
      (now() at time zone 'Europe/Rome')::date,true,2)`)
    const nextReport = await db.query<{ r: any }>(`select public.office_report_materialize('${USER}') as r`)
    assert.equal(nextReport.rows[0].r.created, true)
    const resultReport = await db.query<{ body: any }>(`select body from public.office_agent_outputs where id='${nextReport.rows[0].r.output_id}'`)
    assert.match(JSON.stringify(resultReport.rows[0].body), /Incarico concluso/)
    assert.match(JSON.stringify(resultReport.rows[0].body), /Partner/)
    // Se il precedente è ancora aperto, il turno successivo non crea una copia.
    await db.exec(`update public.office_recurring_orders set next_local_date=(now() at time zone 'Europe/Rome')::date-1,
      next_due_at=now()-interval '1 day' where id='${schedule.id}'`)
    const overlap = await db.query<{ r: any }>(`select public.office_recurring_materialize('${USER}',5) as r`)
    assert.equal(overlap.rows[0].r.previous_open, 1)
    assert.equal((await db.query('select * from public.test_work')).rows.length, 1)
    const refreshed = (await db.query<{ revision: number; next_local_date: string }>(`select revision,next_local_date from public.office_recurring_orders where id='${schedule.id}'`)).rows[0]
    const stale = await db.query<{ r: any }>(`select public.office_recurring_update('${USER}','${schedule.id}',1,'x','x',1,'09:00',current_date,false) as r`)
    assert.equal(stale.rows[0].r, null)
    const alien = await db.query<{ r: any }>(`select public.office_recurring_update('${OTHER}','${schedule.id}',${refreshed.revision},'x','x',1,'09:00',current_date,false) as r`)
    assert.equal(alien.rows[0].r, null)
    const paused = await db.query<{ r: any }>(`select public.office_recurring_update('${USER}','${schedule.id}',${refreshed.revision},'x','x',1,'09:00',current_date,false) as r`)
    assert.equal(paused.rows[0].r.enabled, false)
    assert.equal((await db.query<{ r: any }>(`select public.office_recurring_materialize('${USER}',5) as r`)).rows[0].r.created, 0)
    await db.query(`select public.office_recurring_create('${USER}','Errore','Prova',1,'00:00',
      ((now() at time zone 'Europe/Rome')::date - 1))`)
    const before = (await db.query('select * from public.office_director_orders')).rows.length
    await db.exec(`create or replace function public.office_work_enqueue(p_user_id uuid,p_spec jsonb) returns jsonb language plpgsql as $$
      begin raise exception 'worker indisponibile'; end $$`)
    await assert.rejects(db.query(`select public.office_recurring_materialize('${USER}',5)`), /worker indisponibile/)
    assert.equal((await db.query('select * from public.office_director_orders')).rows.length, before, 'ordine e lavoro sono atomici')
  } finally { await db.close() }
})
