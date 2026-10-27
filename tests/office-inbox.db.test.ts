import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`

test('archiviazione SQL: solo rapporti del titolare, idempotente, nessun effetto sui documenti o sulle decisioni dei lavori', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table office_agent_outputs(id uuid primary key, user_id uuid, kind text, body jsonb, status text default 'pending', decided_at timestamptz);
      create table office_work_items(id uuid primary key, user_id uuid, approval_output_id uuid);
      create table office_work_dependencies(user_id uuid, output_id uuid);
      create table tourism_decks(id uuid primary key, status text);
      grant usage on schema public to service_role;
      grant select,update on office_agent_outputs to service_role;
      grant select on office_work_items,office_work_dependencies to service_role;`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261026144722_office_inbox_acknowledge.sql', import.meta.url), 'utf8'))
    await db.exec(`insert into office_agent_outputs(id,user_id,kind,body) values
      ('${id(1)}','${OWNER}','report','{}'),
      ('${id(2)}','${OTHER}','report','{}'),
      ('${id(3)}','${OWNER}','proposal','{"action":"create_contact"}'),
      ('${id(4)}','${OWNER}','report','{"action":"enrich_entity"}'),
      ('${id(5)}','${OWNER}','report','{}'),
      ('${id(6)}','${OWNER}','report','{}');
      insert into office_work_items values('${id(7)}','${OWNER}','${id(5)}');
      insert into office_work_dependencies values('${OWNER}','${id(6)}');
      insert into tourism_decks values('${id(8)}','ready');`)
    const allowed = await db.query<{ anon: boolean; authenticated: boolean; invoker: boolean }>(`select
      has_function_privilege('anon','public.acknowledge_office_outputs(uuid,uuid[])','execute') as anon,
      has_function_privilege('authenticated','public.acknowledge_office_outputs(uuid,uuid[])','execute') as authenticated,
      not prosecdef as invoker from pg_proc where proname='acknowledge_office_outputs'`)
    assert.deepEqual(allowed.rows, [{ anon: false, authenticated: false, invoker: true }])
    await db.exec('set role service_role')
    const run = async (ids: number[]) => (await db.query<{ result: Array<{ id: string; ok: boolean }> }>(
      `select acknowledge_office_outputs('${OWNER}',array[${ids.map((n) => `'${id(n)}'::uuid`).join(',')}]) as result`)).rows[0].result
    const first = await run([1, 2, 3, 4, 5, 6])
    assert.equal(first.filter((row) => row.ok).length, 1)
    assert.ok(first.find((row) => row.id === id(1))?.ok)
    assert.equal((await db.query<{ status: string }>(`select status from office_agent_outputs where id='${id(1)}'`)).rows[0].status, 'done')
    const stamp = (await db.query<{ decided_at: string }>(`select decided_at from office_agent_outputs where id='${id(1)}'`)).rows[0].decided_at
    assert.ok((await run([1]))[0].ok)
    assert.deepEqual((await db.query<{ decided_at: string }>(`select decided_at from office_agent_outputs where id='${id(1)}'`)).rows[0].decided_at, stamp)
    assert.equal((await db.query<{ count: number }>(`select count(*)::int as count from office_agent_outputs where status='pending'`)).rows[0].count, 5)
    await assert.rejects(db.query(`select acknowledge_office_outputs('${OWNER}',array[]::uuid[])`), /1 a 50/)
    await db.exec('reset role')
    assert.equal((await db.query<{ status: string }>('select status from tourism_decks')).rows[0].status, 'ready')
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from office_work_items')).rows[0].count, 1)
  } finally { await db.close() }
})
