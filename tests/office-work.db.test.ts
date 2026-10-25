/** Contratti dei lavori persistenti sul solo PostgreSQL locale usa-e-getta. */
import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetWorkDatabase } from './office-work-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_work_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ENTITY = '33333333-3333-4333-8333-333333333333'
const CONTACT = '44444444-4444-4444-8444-444444444444'
const sql = (s: string) => query(s, DB)
const scalar = (s: string) => value(s, DB)
const error = (s: string) => failure(s, DB)
const quote = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
const json = async (s: string) => JSON.parse((await scalar(s))!)
const enqueue = (patch: Record<string, unknown> = {}, owner = OWNER) => json(`select public.office_work_enqueue('${owner}',${quote({ agent_id: 'director', action: 'interpret_order', origin: 'order', source_key: 'one', payload: {}, ...patch })})`)
const claim = (owner = OWNER, limit = 4) => json(`select public.office_work_claim('${owner}',${limit})`)
const transition = (w: any, patch: Record<string, unknown>) => json(`select public.office_work_transition('${w.id}','${w.lease_token}',${quote(patch)})`)
const recover = () => json(`select public.office_work_recover('${OWNER}')`)
const order = () => scalar(`insert into office_director_orders(user_id,text) values('${OWNER}','Prepara la presentazione per Marsiglia') returning id`)
const expire = (id: string) => sql(`update office_work_items set lease_until=now()-interval '1 second' where id='${id}'`)
const runFor = async (w: any) => {
  const result = await json(`select public.claim_office_agent_run('${w.agent_id}','${OWNER}','work:${w.id}:${w.attempt_count}')`)
  await sql(`select public.office_work_link_run('${w.id}','${w.lease_token}','${result.run.id}')`)
  return result.run.id as string
}

before(async () => {
  await resetWorkDatabase(DB)
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})
beforeEach(async () => {
  await sql(`set request.jwt.claim.sub='${OWNER}';
    truncate public.contacts,public.office_agents,public.office_director_orders,public.tourism_entities cascade;
    insert into office_agents(id,user_id,name,department,enabled,daily_budget_cents,weekly_budget_cents,monthly_budget_cents) values
      ('director','${OWNER}','Direttore','direzione',true,1000,1000,1000),
      ('entity_enricher','${OWNER}','Arricchimento','ricerca',true,1000,1000,1000),
      ('presentations','${OWNER}','Presentazioni','commerciale',true,1000,1000,1000),
      ('mymaps_builder','${OWNER}','My Maps','mappe',true,1000,1000,1000),
      ('maps_quality','${OWNER}','Qualità','mappe',true,1000,1000,1000),
      ('languages_voice','${OWNER}','Lingue','mappe',true,1000,1000,1000);
    insert into tourism_entities(id,user_id,kind,name,country_code,type_code)
      values('${ENTITY}','${OWNER}','organization','Office de Tourisme de Marseille','FR','dmo');`)
})

test('due ordini e otto claim: un lavoro per agente, nessuna perdita o doppio tentativo', async () => {
  const [first, second] = await Promise.all([order(), order()])
  await Promise.all([
    enqueue({ source_key: 'first', order_id: first }), enqueue({ source_key: 'second', order_id: second }),
  ])
  const all = (await Promise.all(Array.from({ length: 8 }, () => claim()))).flat()
  assert.equal(all.length, 1)
  assert.equal(await scalar('select count(*) from office_work_items'), '2')
  assert.equal(await scalar("select count(*) from office_work_items where status='running'"), '1')
  assert.equal(await scalar('select sum(attempt_count) from office_work_items'), '1')
  assert.equal(await scalar("select count(*) from office_director_orders where status='done'"), '0')
})

test('enqueue concorrente idempotente e chiavi/azioni estranee rifiutate', async () => {
  const jobs = await Promise.all(Array.from({ length: 8 }, () => enqueue()))
  assert.equal(new Set(jobs.map((j) => j.id)).size, 1)
  assert.match((await error(`select office_work_enqueue('${OWNER}',${quote({ agent_id: 'director', action: 'execute_anything', source_key: 'x' })})`))!, /non ammessi/)
  assert.match((await error(`select office_work_enqueue('${OTHER}',${quote({ agent_id: 'director', action: 'interpret_order', source_key: 'x' })})`))!, /foreign key/)
})

test('agente spento e poi riacceso: lavoro conservato e ripreso al controllo seguente', async () => {
  await sql("update office_agents set enabled=false where id='director'")
  const saved = await enqueue()
  assert.deepEqual(await claim(), [])
  assert.equal(await scalar(`select reason_code from office_work_items where id='${saved.id}'`), 'agent_disabled')
  await sql(`update office_agents set enabled=true where id='director';update office_work_items set next_check_at=now()-interval '1 second' where id='${saved.id}'`)
  const jobs = await claim()
  assert.equal(jobs[0].id, saved.id)
  assert.equal(jobs[0].attempt_count, 1)
})

test('agente occupato: nessuna corsa persa e nessun nuovo tentativo consumato', async () => {
  const running = await json(`select claim_office_agent_run('director','${OWNER}','other-run')`)
  await enqueue()
  assert.deepEqual(await claim(), [])
  assert.equal(await scalar('select attempt_count from office_work_items'), '0')
  assert.equal(await scalar('select reason_code from office_work_items'), 'agent_busy')
  await sql(`select finish_office_agent_run('${running.run.id}','done','Concluso',null,'{}');update office_work_items set next_check_at=now()-interval '1 second'`)
  assert.equal((await claim()).length, 1)
})

test('riavvio sicuro: checkpoint conservato, nuovo token e vecchio processo escluso', async () => {
  await enqueue()
  const [first] = await claim()
  await transition(first, { phase: 'planned', checkpoint: { plan: { action: 'read' } } })
  await expire(first.id)
  assert.equal((await recover()).recovered, 1)
  const [second] = await claim()
  assert.notEqual(second.lease_token, first.lease_token)
  assert.equal(second.checkpoint.plan.action, 'read')
  assert.equal(await scalar(`select office_work_assert_active('${first.id}','${first.lease_token}')`), 'f')
  assert.equal(await scalar(`select office_work_heartbeat('${first.id}','${first.lease_token}')`), 'f')
  assert.match((await error(`select office_work_transition('${first.id}','${first.lease_token}','{"status":"succeeded","result":{"ok":true}}')`))!, /scaduta/)
})

test('effetto incerto dopo riavvio: blocco senza rilancio e riserva conservata', async () => {
  await enqueue()
  const [w] = await claim()
  const run = await runFor(w)
  await transition(w, { phase: 'effect_started' })
  await sql(`select reserve_agent_budget('director',12,'${run}')`)
  await expire(w.id)
  assert.equal((await recover()).blocked, 1)
  assert.deepEqual(await claim(), [])
  assert.equal(await scalar('select reason_code from office_work_items'), 'reconciliation_required')
  assert.equal(await scalar('select sum(reserved_cents) from office_budget_ledger'), '12')
  const resumed = await json(`select office_work_owner_action('${OWNER}','${w.id}','resume','{}')`)
  assert.equal(resumed.reason, 'reconciliation_required')
})

test('spesa saldata ma risposta non salvata: non si paga una seconda volta', async () => {
  await enqueue()
  const [w] = await claim()
  const run = await runFor(w)
  const ledger = await scalar(`select reserve_agent_budget('director',10,'${run}')`)
  await sql(`select settle_agent_budget('${ledger}',7)`)
  await expire(w.id)
  assert.equal((await recover()).blocked, 1)
  assert.equal(await scalar('select actual_cents from office_budget_ledger'), '7')
})

test('fencing SQL: il processo scaduto non può spendere né aggiungere output', async () => {
  await enqueue()
  const [w] = await claim()
  const run = await runFor(w)
  await expire(w.id)
  assert.match((await error(`select reserve_agent_budget('director',1,'${run}')`))!, /scaduta/)
  assert.match((await error(`select add_office_agent_output('${run}','stale','report','Non valido','{}')`))!, /scaduta/)
  assert.equal(await scalar('select count(*) from office_budget_ledger'), '0')
})

test('budget finito: attesa della finestra prevista, senza cambiare i tetti', async () => {
  await enqueue()
  const [w] = await claim()
  await transition(w, { status: 'blocked', reason_code: 'budget_exhausted', reason: 'Budget finito', required_action: 'Attendere il rinnovo', responsible: 'Finanza', next_check_at: new Date(Date.now() + 3600000).toISOString() })
  assert.deepEqual(await claim(), [])
  await sql(`update office_work_items set next_check_at=now()-interval '1 second' where id='${w.id}'`)
  assert.equal((await claim())[0].id, w.id)
  assert.equal(await scalar("select daily_budget_cents from office_agents where id='director'"), '1000')
})

test('fonte corretta: versione e storico, null non cancella, CAS protegge dagli aggiornamenti persi', async () => {
  const w = await enqueue({ agent_id: 'mymaps_builder', action: 'import_mymaps', payload: { slug: 'marsiglia', city: 'Marsiglia' } })
  const corrected = await enqueue({ agent_id: 'mymaps_builder', action: 'import_mymaps', payload: { source: 'https://www.google.com/maps/d/viewer?mid=publicSource1234' } })
  assert.equal(corrected.id, w.id)
  assert.equal(corrected.payload_version, 2)
  assert.equal(await scalar('select count(*) from office_work_revisions'), '1')
  const same = await enqueue({ agent_id: 'mymaps_builder', action: 'import_mymaps', payload: { source: null } })
  assert.equal(same.payload.source, corrected.payload.source)
  const stale = await json(`select office_work_owner_action('${OWNER}','${w.id}','update_payload',${quote({ expected_revision: 1, payload: { city: 'Altra' } })})`)
  assert.equal(stale.reason, 'revision_conflict')
  assert.match((await error(`select office_work_owner_action('${OWNER}','${w.id}','update_payload',${quote({ expected_revision: same.revision, payload: { agent_id: 'finance' } })})`))!, /non modificabile/)
})

test('piano atomico: figli e dipendenze, ordine Fatto soltanto dopo l’ultimo risultato', async () => {
  const orderId = await order()
  await enqueue({ order_id: orderId })
  const [root] = await claim()
  const verifyId = '55555555-5555-4555-8555-555555555555'
  await transition(root, { status: 'succeeded', result: { planned: true }, close_plan: true, children: [
    { id: verifyId, agent_id: 'entity_enricher', action: 'verify_tourism_entity', source_key: 'verify', payload: { entity_id: ENTITY } },
    { agent_id: 'presentations', action: 'prepare_presentation', source_key: 'deck', payload: { entity_id: ENTITY }, depends_on: [verifyId] },
  ] })
  assert.notEqual(await scalar(`select status from office_director_orders where id='${orderId}'`), 'done')
  const [verify] = await claim()
  assert.equal(verify.id, verifyId)
  await transition(verify, { status: 'succeeded', result: { entity_id: ENTITY, place_id: ENTITY } })
  assert.notEqual(await scalar(`select status from office_director_orders where id='${orderId}'`), 'done')
  const [deck] = await claim()
  assert.equal(deck.action, 'prepare_presentation')
  await transition(deck, { status: 'succeeded', result: { deck_id: 'saved-deck' }, result_summary: 'Presentazione pronta da rivedere.' })
  assert.equal(await scalar(`select status from office_director_orders where id='${orderId}'`), 'done')
})

test('rifiuto del titolare: annulla il lavoro e tutti i passi che richiedevano il consenso', async () => {
  const w = await enqueue({ agent_id: 'entity_enricher', action: 'verify_tourism_entity' })
  await enqueue({ agent_id: 'presentations', action: 'prepare_presentation', source_key: 'deck', depends_on: [w.id] })
  const [active] = await claim()
  const output = await scalar(`insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body) values('${OWNER}','entity_enricher','proposal','proposal','Da approvare','{}') returning id`)
  await transition(active, { status: 'waiting_owner', approval_output_id: output, output_ids: [output], reason_code: 'approval_required' })
  const waiting = await json(`select to_jsonb(w) from office_work_items w where id='${w.id}'`)
  const bypass = await json(`select office_work_owner_action('${OWNER}','${w.id}','update_payload',${quote({ expected_revision: waiting.revision, payload: { city: 'Altra città' } })})`)
  assert.equal(bypass.reason, 'approval_required')
  assert.equal((await json(`select office_work_owner_action('${OWNER}','${w.id}','resume','{}')`)).reason, 'approval_required')
  const decided = await json(`select office_work_decide_output('${OWNER}','${output}','rejected')`)
  assert.equal(decided.output.status, 'rejected')
  assert.equal(await scalar("select count(*) from office_work_items where status='cancelled'"), '2')
  assert.deepEqual(await claim(), [])
})

test('proposta del piano: la radice già conclusa non nasconde il figlio che aspetta il consenso', async () => {
  await enqueue({ action: 'agent_run' })
  const [root] = await claim()
  const output = await scalar(`insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body,target_table,target_id)
    values('${OWNER}','director','plan-map','proposal','Costruire Marsiglia',
      '{"action":"build_map","action_key":"build_map:marsiglia","recipient_agent_id":"mymaps_builder","city":"Marsiglia"}',
      'tourism_destinations','marsiglia') returning id`)
  await transition(root, { status: 'succeeded', result: { planned: true }, output_ids: [output], children: [{
    agent_id: 'mymaps_builder', action: 'import_mymaps', source_key: `plan:${output}`, origin: 'director_plan',
    source_output_id: output, approval_output_id: output, status: 'waiting_owner', payload: { city: 'Marsiglia' },
  }] })
  assert.equal(await scalar(`select count(*) from office_work_outputs where output_id='${output}'`), '2')
  const child = await json(`select to_jsonb(w) from office_work_items w where source_key='plan:${output}'`)
  const decisions = await Promise.all(Array.from({ length: 8 }, () => json(`select office_work_decide_output('${OWNER}','${output}','approved')`)))
  assert.equal(decisions.filter(d => d.output?.status === 'approved').length, 1)
  assert.equal(await scalar(`select status from office_work_items where id='${root.id}'`), 'succeeded')
  assert.equal(await scalar(`select status from office_work_items where id='${child.id}'`), 'ready')
  assert.equal(await scalar(`select revision from office_work_items where id='${child.id}'`), String(child.revision + 1))
  assert.equal(await scalar("select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'"), '1')
  assert.equal(await scalar('select count(*) from office_work_items'), '2')
  // Nessun collegamento valido: una versione superata rimane rifiutata.
  await sql(`update office_agent_outputs set status='pending',decided_at=null where id='${output}';
    update office_work_items set status='waiting_owner',payload_version=payload_version+1 where id='${child.id}'`)
  assert.equal((await json(`select office_work_decide_output('${OWNER}','${output}','approved')`)).reason, 'stale_work_proposal')
  assert.equal(await scalar(`select status from office_agent_outputs where id='${output}'`), 'pending')
})

test('verifica Tourism approvata: sito e prove nello stesso commit, dipendenza pronta senza secondo incarico', async () => {
  const orderId = await order()
  const verify = await enqueue({ agent_id: 'entity_enricher', action: 'verify_tourism_entity', order_id: orderId, payload: { entity_id: ENTITY } })
  const deck = await enqueue({ agent_id: 'presentations', action: 'prepare_presentation', order_id: orderId, source_key: 'deck', payload: { entity_id: ENTITY }, depends_on: [verify.id] })
  const [active] = await claim()
  const website = 'https://tourisme.example.org'
  const body = { action: 'enrich_entity', entity_id: ENTITY, city: 'Marsiglia', country: 'FR', place_id: null,
    website, fill: { email: 'info@tourisme.example.org' }, evidence: {
      identity: { source_url: website, quote: 'Office de Tourisme de Marseille accueille les visiteurs.' },
      coverage: { source_url: website, quote: 'Office de Tourisme de Marseille assure la promotion touristique de Marseille.', relation: 'PROMOTES' },
      email: { source_url: website, quote: 'Contact : info@tourisme.example.org' },
    } }
  const output = await scalar(`insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body,target_table,target_id)
    values('${OWNER}','entity_enricher','verify','proposal','Vérification',${quote(body)},'tourism_entities','${ENTITY}') returning id`)
  await transition(active, { status: 'waiting_owner', output_ids: [output], approval_output_id: output })
  assert.equal(await scalar(`select website from tourism_entities where id='${ENTITY}'`), null)
  const decision = await json(`select office_work_decide_output('${OWNER}','${output}','approved')`)
  assert.equal(decision.output?.status, 'approved', JSON.stringify(decision))
  assert.equal(await scalar(`select website||'|'||status from tourism_entities where id='${ENTITY}'`), website + '|VERIFIED')
  assert.equal(await scalar(`select status from office_work_items where id='${verify.id}'`), 'succeeded')
  const result = await json(`select result from office_work_items where id='${verify.id}'`)
  assert.equal(result.entity_id, ENTITY)
  assert.ok(result.place_id)
  assert.equal(await scalar(`select status from office_work_items where id='${deck.id}'`), 'ready')
  await json(`select office_work_import_queue('${OWNER}')`)
  assert.equal(await scalar("select count(*) from office_work_items where action='prepare_presentation'"), '1')
  assert.equal(await scalar('select count(*) from email_drafts'), '0')
})

test('dipendenza fallita e corretta: il figlio si sblocca da solo senza secondo intervento', async () => {
  const parent = await enqueue()
  const child = await enqueue({ agent_id: 'presentations', action: 'prepare_presentation', source_key: 'child', depends_on: [parent.id] })
  const [first] = await claim()
  await transition(first, { status: 'failed', last_error: 'Errore correggibile' })
  assert.equal(await scalar(`select status||':'||reason_code from office_work_items where id='${child.id}'`), 'blocked:dependency_failed')
  const row = await json(`select office_work_owner_action('${OWNER}','${parent.id}','update_payload',${quote({ expected_revision: 3, payload: { text: 'Ordine corretto' } })})`)
  assert.ok(row.work, JSON.stringify(row))
  const [second] = await claim()
  assert.equal(second.attempt_count, 2)
  await transition(second, { status: 'succeeded', result: { fixed: true } })
  assert.equal(await scalar(`select status from office_work_items where id='${child.id}'`), 'ready')
})

test('creazione contatto: il completamento della pipeline aggiorna il lavoro senza Promise in memoria', async () => {
  const w = await enqueue()
  const [active] = await claim()
  const output = await scalar(`insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body) values('${OWNER}','director','contact','proposal','Contatto','{"action":"create_contact"}') returning id`)
  await transition(active, { status: 'waiting_owner', approval_output_id: output, output_ids: [output], close_plan: true })
  await sql(`insert into contacts(id,user_id,name,status) values('${CONTACT}','${OWNER}','Contatto approvato','New');
    select office_director_contact_done('${output}','${OWNER}','${CONTACT}','{}')`)
  assert.equal(await scalar(`select status from office_work_items where id='${w.id}'`), 'succeeded')
  assert.equal(await scalar(`select result->>'contact_id' from office_work_items where id='${w.id}'`), CONTACT)
})

test('dipendenze e riferimenti: workspace estranei, cicli e risultati mancanti rifiutati', async () => {
  const foreignOrder = await scalar(`insert into office_director_orders(user_id,text) values('${OTHER}','Altro') returning id`)
  assert.match((await error(`select office_work_enqueue('${OWNER}',${quote({ agent_id: 'director', action: 'interpret_order', source_key: 'bad', order_id: foreignOrder })})`))!, /altro workspace/)
  const w = await enqueue()
  assert.match((await error(`select office_work_add_dependencies('${w.id}','${OWNER}',${quote([w.id])})`))!, /ciclica/)
  const child = await enqueue({ agent_id: 'presentations', action: 'prepare_presentation', source_key: 'child', depends_on: [w.id] })
  assert.match((await error(`select office_work_add_dependencies('${w.id}','${OWNER}',${quote([child.id])})`))!, /ciclica/)
  const [active] = await claim()
  assert.match((await error(`select office_work_transition('${active.id}','${active.lease_token}','{"status":"succeeded"}')`))!, /verificabile/)
  assert.match((await error(`select office_work_enqueue('${OWNER}',${quote({ agent_id: 'mymaps_builder', action: 'import_mymaps', source_key: 'napoli', payload: { slug: 'napolimap' } })})`))!, /Napoli/)
})

test('notifiche persistenti: claim unico, consegna registrata, timeout mai ripetuto alla cieca', async () => {
  const orderId = await order()
  await enqueue({ order_id: orderId })
  const calls = (await Promise.all(Array.from({ length: 8 }, () => json(`select office_work_claim_events('${OWNER}',10)`)))).flat()
  assert.equal(calls.length, 1)
  const e = calls[0]
  await sql(`update office_work_events set lease_until=now()-interval '1 second' where id='${e.id}'`)
  assert.deepEqual(await json(`select office_work_claim_events('${OWNER}',10)`), [])
  assert.equal(await scalar(`select status from office_work_events where id='${e.id}'`), 'uncertain')
  assert.match((await error(`select office_work_finish_event('${e.id}','${e.lease_token}','sent',null)`))!, /scaduta/)
})

test('ordini ricevuti e upload interrotto: recupero idempotente senza interpretare allegati incompleti', async () => {
  await order()
  await sql(`insert into office_director_orders(user_id,status,text,interpretation,updated_at) values('${OWNER}','working','Foto',
    '{"intake":"attachments"}',now()-interval '11 minutes')`)
  await json(`select office_work_seed_orders('${OWNER}')`)
  await json(`select office_work_seed_orders('${OWNER}')`)
  assert.equal(await scalar('select count(*) from office_work_items'), '2')
  assert.equal(await scalar("select count(*) from office_work_items where reason_code='upload_interrupted' and status='blocked'"), '1')
})

test('vecchie code: importazione ripetibile, adozione ricevuta e voce non autorizzata da verificare', async () => {
  await sql(`update office_agents set settings='{"queue":[{"key":"build:marsiglia","slug":"marsiglia","city":"Marsiglia","origin":"director_order","source":"https://maps.example.org/source-a"}]}' where id='mymaps_builder';
    insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body,target_table,target_id)
      values('${OWNER}','mymaps_builder','old','report','Import concluso','{"created":3,"cost_cents":0,"source":"https://maps.example.org/source-a"}','studiomap_maps','marsiglia');
    update office_agents set settings='{"queue":[{"entity_id":"${ENTITY}"}]}' where id='presentations'`)
  const first = await json(`select office_work_import_queue('${OWNER}')`)
  const second = await json(`select office_work_import_queue('${OWNER}')`)
  assert.equal(first.imported, 2)
  assert.equal(first.adopted, 1)
  assert.equal(first.blocked, 1)
  assert.equal(second.imported, 0)
  assert.equal(await scalar('select count(*) from office_work_imports'), '2')
  assert.equal(await scalar('select count(*) from office_budget_ledger'), '0')
})

test('ricevuta My Maps di un’altra fonte: nessun falso risultato adottato', async () => {
  await sql(`update office_agents set settings='{"queue":[{"key":"build:marsiglia","slug":"marsiglia","city":"Marsiglia","origin":"director_order","source":"https://maps.example.org/source-b"}]}' where id='mymaps_builder';
    insert into office_agent_outputs(user_id,agent_id,output_key,kind,title,body,target_table,target_id)
      values('${OWNER}','mymaps_builder','old','report','Import concluso','{"created":3,"cost_cents":0,"source":"https://maps.example.org/source-a"}','studiomap_maps','marsiglia')`)
  const imported = await json(`select office_work_import_queue('${OWNER}')`)
  assert.equal(imported.adopted, 0)
  assert.equal(await scalar('select status||\':\'||reason_code from office_work_items'), 'blocked:reconciliation_required')
})

test('RLS di sola lettura e RPC solo service role; nessuna contaminazione tra workspace', async () => {
  await enqueue()
  const last = async (s: string) => (await sql(s)).at(-1)?.[0]
  assert.equal(await last(`set role authenticated;set request.jwt.claim.sub='${OWNER}';select count(*) from office_work_items`), '1')
  assert.equal(await last(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from office_work_items`), '0')
  assert.match((await error("set role authenticated;update office_work_items set status='ready'"))!, /permission denied/)
  assert.match((await error(`set role authenticated;select office_work_claim('${OWNER}',1)`))!, /permission denied/)
  assert.equal(await scalar(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'office_work_%'
    and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))`), '0')
  assert.equal((await json(`select office_work_owner_action('${OTHER}',(select id from office_work_items limit 1),'resume','{}')`)).reason, 'not_found')
})
