/** Lock, RLS, prenotazioni e idempotenza sul Postgres vero di tests/db.sh. */
import assert from 'node:assert/strict'
import { before, beforeEach, describe, test } from 'node:test'
import { resetDatabase, sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_test'
const USER = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const sql = (q: string) => query(q, DB)
const scalar = (q: string) => value(q, DB)
const expectError = (q: string) => failure(q, DB)
const claim = async (key = 'corsa-di-test') => JSON.parse((await scalar(`select public.claim_office_agent_run('prova', '${USER}', '${key}');`))!)
const reserve = (run: string, cents: number) => scalar(`select public.reserve_agent_budget('prova', ${cents}, '${run}');`)

before(async () => {
  await resetDatabase(DB)
  await sql(`insert into auth.users(id,email) values ('${USER}','titolare@example.it'), ('${OTHER}','altro@example.it');
    grant usage on schema auth to authenticated;`)
})
beforeEach(async () => {
  await sql(`delete from public.office_agents;
    insert into public.office_agents(id,user_id,name,department,enabled,daily_budget_cents,weekly_budget_cents,monthly_budget_cents)
      values ('prova','${USER}','Prova','operazioni',true,100,100,100),
        ('altro','${OTHER}','Altro','ricerca',false,0,0,0);`)
})

describe('budget atomico', () => {
  test('riserva rifiutata oltre il tetto; zero non vuol dire illimitato', async () => {
    const { run } = await claim()
    assert.ok(await reserve(run.id, 100))
    assert.equal(await reserve(run.id, 1), null)
    assert.equal(await scalar('select sum(reserved_cents) from public.office_budget_ledger'), '100')
    await sql('delete from public.office_budget_ledger; update public.office_agents set daily_budget_cents=0 where id=\'prova\'')
    assert.equal(await reserve(run.id, 1), null)
  })
  test('ogni tetto limita la spesa, indipendentemente dagli altri', async () => {
    for (const column of ['daily_budget_cents', 'weekly_budget_cents', 'monthly_budget_cents']) {
      await sql(`delete from public.office_budget_ledger; update public.office_agents set daily_budget_cents=100, weekly_budget_cents=100, monthly_budget_cents=100 where id='prova';
        update public.office_agents set ${column}=10 where id='prova';`)
      const { run } = await claim()
      assert.ok(await reserve(run.id, 10)); assert.equal(await reserve(run.id, 1), null)
    }
  })
  test('otto connessioni concorrenti non superano il budget', async () => {
    const { run } = await claim()
    const reservations = await Promise.all(Array.from({ length: 8 }, () => reserve(run.id, 20)))
    assert.equal(reservations.filter(Boolean).length, 5)
    assert.equal(await scalar('select sum(reserved_cents) from public.office_budget_ledger'), '100')
    assert.equal(await scalar(`select cost_cents_reserved from public.office_agent_runs where id='${run.id}'`), '100')
  })
  test('il saldo sostituisce la riserva e libera la differenza una volta soltanto', async () => {
    const { run } = await claim()
    const id = await reserve(run.id, 100)
    await sql(`select public.settle_agent_budget('${id}', 20, 1000, 100, 'gpt-5-mini');
      select public.settle_agent_budget('${id}', 20, 1000, 100, 'gpt-5-mini');`)
    assert.equal(await scalar(`select cost_cents_actual from public.office_agent_runs where id='${run.id}'`), '20')
    assert.match((await expectError(`select public.settle_agent_budget('${id}', 0);`))!, /gia saldata/)
    assert.ok(await reserve(run.id, 80)); assert.equal(await reserve(run.id, 1), null)
    const totals = JSON.parse((await scalar(`select public.office_budget_summary('${USER}');`))!)[0]
    assert.equal(totals.day_actual, 20); assert.equal(totals.day_reserved, 80)
    assert.equal(totals.week_actual, 20); assert.equal(totals.month_reserved, 80)
  })
  test('un costo reale maggiore della stima resta registrato e impedisce altra spesa', async () => {
    const { run } = await claim()
    const id = await reserve(run.id, 50)
    await sql(`select public.settle_agent_budget('${id}', 110);`)
    assert.equal(await reserve(run.id, 1), null)
    assert.equal(await scalar(`select actual_cents from public.office_budget_ledger where id='${id}'`), '110')
  })
  test('il giorno contabile e italiano; settimana e mese non perdono il passato', async () => {
    const { run } = await claim()
    const id = await reserve(run.id, 10)
    assert.equal(await scalar(`select day = (now() at time zone 'Europe/Rome')::date from public.office_budget_ledger where id='${id}'`), 't')
    await sql(`update public.office_budget_ledger set day = date_trunc('month', (now() at time zone 'Europe/Rome'))::date, actual_cents=95 where id='${id}';`)
    assert.equal(await reserve(run.id, 10), null)
    assert.ok(await reserve(run.id, 5))
  })
  test('i totali sono calcolati nel database anche oltre mille movimenti', async () => {
    await sql(`insert into public.office_budget_ledger(agent_id,user_id,reserved_cents,actual_cents)
      select 'prova','${USER}',1,1 from generate_series(1,1501);`)
    const totals = JSON.parse((await scalar(`select public.office_budget_summary('${USER}')`))!)[0]
    assert.equal(totals.month_actual, 1501); assert.equal(totals.day_actual, 1501)
    assert.deepEqual(JSON.parse((await scalar(`select public.office_budget_summary('${OTHER}')`))!).map((s: { agent_id: string }) => s.agent_id), ['altro'])
  })
})

describe('corse e uscite', () => {
  test('presa in carico contemporanea: vince una connessione sola', async () => {
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(`turno-${i}`)))
    assert.equal(attempts.filter((result) => result.claimed).length, 1)
    assert.equal(await scalar("select count(*) from public.office_agent_runs where status='running'"), '1')
  })
  test('ripetere una corsa conclusa con la stessa chiave non la riesegue', async () => {
    const first = await claim()
    await sql(`select public.finish_office_agent_run('${first.run.id}', 'done', 'Conclusa', null, '{}');`)
    const second = await claim()
    assert.equal(second.claimed, false); assert.equal(second.reason, 'duplicate'); assert.equal(first.run.id, second.run.id)
    assert.equal(await scalar('select count(*) from public.office_agent_runs'), '1')
  })
  test('agente spento: registra il salto e non prenota budget', async () => {
    await sql("update public.office_agents set enabled=false where id='prova'")
    const result = await claim()
    assert.equal(result.claimed, false); assert.equal(result.run.status, 'skipped_disabled')
    assert.match((await expectError(`select public.reserve_agent_budget('prova', 1, '${result.run.id}')`))!, /Agente spento/)
    assert.equal(await scalar('select count(*) from public.office_budget_ledger'), '0')
  })
  test('processo scaduto: si riparte senza liberare soldi dall’esito incerto', async () => {
    const first = await claim()
    await reserve(first.run.id, 70)
    await sql(`update public.office_agent_runs set started_at=now()-interval '31 minutes' where id='${first.run.id}'`)
    const second = await claim('nuovo-turno')
    assert.equal(second.claimed, true)
    assert.equal(await scalar(`select status from public.office_agent_runs where id='${first.run.id}'`), 'failed')
    assert.equal(await reserve(second.run.id, 31), null)
    assert.match((await expectError(`select public.add_office_agent_output('${first.run.id}', 'x', 'report', 'Vecchio processo', '{}')`))!, /Corsa non attiva/)
    assert.match((await expectError(`select public.reserve_agent_budget('prova', 1, '${first.run.id}')`))!, /Corsa non attiva/)
    const finished = JSON.parse((await scalar(`select to_jsonb(public.finish_office_agent_run('${first.run.id}', 'done', 'Non valido', null, '{}'))`))!)
    assert.equal(finished.status, 'failed')
  })
  test('uscita idempotente, sempre pending: il solo effetto e una bozza', async () => {
    const { run } = await claim()
    const call = `select public.add_office_agent_output('${run.id}', 'unica', 'draft_email', 'Email da controllare', '{"testo":"Ciao"}', 'contacts', 'contatto')`
    const ids = await Promise.all([scalar(call), scalar(call)])
    assert.equal(ids[0], ids[1])
    assert.equal(await scalar('select count(*) from public.office_agent_outputs'), '1')
    assert.equal(await scalar('select status from public.office_agent_outputs'), 'pending')
    assert.equal(await scalar(`select items_created from public.office_agent_runs where id='${run.id}'`), '1')
  })
  test('tenuta 90 giorni: conserva uscite in attesa e ledger', async () => {
    const { run } = await claim()
    await reserve(run.id, 10)
    await scalar(`select public.add_office_agent_output('${run.id}', 'x', 'report', 'Da leggere', '{}')`)
    await sql(`update public.office_agent_runs set status='done', started_at=now()-interval '91 days', finished_at=now()-interval '91 days' where id='${run.id}'`)
    assert.equal(await scalar('select public.prune_office_agent_runs()'), '1')
    assert.equal(await scalar("select count(*) from public.office_agent_outputs where status='pending' and run_id is null"), '1')
    assert.equal(await scalar('select sum(reserved_cents) from public.office_budget_ledger where run_id is null'), '10')
  })
})

describe('permessi e vincoli', () => {
  test('il titolare legge solo le proprie righe; nessuna scrittura diretta dal browser', async () => {
    const { run } = await claim()
    await reserve(run.id, 10)
    await scalar(`select public.add_office_agent_output('${run.id}', 'x', 'report', 'Da leggere', '{}')`)
    for (const table of ['office_agents', 'office_agent_runs', 'office_agent_outputs', 'office_budget_ledger']) {
      const rows = await sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${OTHER}',true); select count(*) from public.${table} where user_id='${USER}';`)
      assert.equal(rows.at(-1)?.[0], '0', `${table}: dati di un altro workspace`)
    }
    assert.match((await expectError(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${USER}',true); update public.office_agents set enabled=false; rollback;`))!, /permission denied/)
    const own = await sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${USER}',true); select name from public.office_agents;`)
    assert.equal(own.at(-1)?.[0], 'Prova')
  })
  test('tutte le RPC privilegiate sono revocate ad anon e authenticated', async () => {
    const names = ['claim_office_agent_run','reserve_agent_budget','settle_agent_budget','add_office_agent_output','finish_office_agent_run','office_budget_summary','prune_office_agent_runs']
    const denied = await scalar(`select count(*) from pg_proc where proname in (${names.map((s) => `'${s}'`).join(',')})
      and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute') or not has_function_privilege('service_role',oid,'execute'));`)
    assert.equal(denied, '0')
    assert.match((await expectError(`set role authenticated; select public.claim_office_agent_run('prova','${USER}','intruso')`))!, /permission denied/)
  })
  test('non si possono incrociare agenti, corse e workspace', async () => {
    const { run } = await claim()
    assert.match((await expectError(`insert into public.office_agent_outputs(agent_id,user_id,run_id,output_key,kind,title) values ('altro','${OTHER}','${run.id}','x','report','Intruso')`))!, /altro agente o workspace/)
    assert.match((await expectError(`select public.claim_office_agent_run('prova','${OTHER}','intruso')`))!, /Agente non trovato/)
    assert.match((await expectError(`insert into public.office_budget_ledger(agent_id,user_id,run_id,reserved_cents) values ('altro','${OTHER}','${run.id}',10)`))!, /altro agente o workspace/)
  })
  test('vincoli e valori predefiniti impediscono budget negativi o agenti accesi per errore', async () => {
    assert.match((await expectError("update public.office_agents set daily_budget_cents=-1 where id='prova'"))!, /check constraint/)
    await sql(`insert into public.office_agents(id,user_id,name,department) values ('nuovo','${USER}','Nuovo','operazioni')`)
    assert.equal(await scalar("select enabled from public.office_agents where id='nuovo'"), 'f')
    const { run } = await claim()
    assert.match((await expectError(`select public.reserve_agent_budget('prova',-1,'${run.id}')`))!, /non valido/)
  })
})
