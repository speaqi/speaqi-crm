import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { EVENTS_SCHEMA_MIGRATIONS } from './office-events-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'
import { readEventPage, validateEvent } from '../src/lib/office/events'
import { officeRomeDay } from '../src/lib/office/finance'
const DB='office_events_test',OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222'
const KEEP='33333333-3333-4333-8333-333333333333',DROP='44444444-4444-4444-8444-444444444444'
const sql=(s:string)=>query(s,DB),scalar=(s:string)=>value(s,DB),error=(s:string)=>failure(s,DB)
const json=async(s:string)=>JSON.parse((await scalar(s))!)
const quote=(v:unknown)=>`'${JSON.stringify(v).replace(/'/g,"''")}'`
const TODAY=officeRomeDay(new Date()),after=(days:number)=>new Date(Date.parse(`${TODAY}T12:00:00Z`)+days*86400_000).toISOString().slice(0,10)
const SOURCE='https://calendar.example.org/events'
const raw={name:'Fiera turismo e musei',startDate:after(20),endDate:after(22),url:'https://events.example.org/tourism',registrationDeadline:after(10)}
const page=readEventPage(`<script type="application/ld+json">${JSON.stringify({'@type':'Event',...raw})}</script>`,SOURCE)
const event=validateEvent(page.candidates[0],page,new Date())!
let run:string,batch:string
const claim=()=>json(`select public.claim_office_event_batch('${run}',${quote([page])})`)
const finish=(events:unknown[]=[event])=>json(`select public.finish_office_event_batch('${run}','${batch}',${quote(events)},'{"queries_executed":false}')`)
const decide=(id:string,status='approved',owner=OWNER)=>json(`select public.decide_office_output('${id}','${owner}','${status}')`)
const decision=()=>scalar("select id from office_agent_outputs where agent_id='events_scout' and kind='task' limit 1")
before(async()=>{await resetOfficeDatabase(DB,EVENTS_SCHEMA_MIGRATIONS);await sql(`insert into auth.users(id)values('${OWNER}'),('${OTHER}')`)})
beforeEach(async()=>{
  await sql(`truncate public.contacts,public.office_agents cascade;
    insert into office_agents(id,user_id,name,department,enabled)values('events_scout','${OWNER}','Eventi','ricerca',true),
      ('db_cleaner','${OWNER}','Pulizia','operazioni',false),('director','${OWNER}','Direttore','direzione',false),('mymaps_builder','${OWNER}','Mappe','mappe',false);
    insert into trade_fair_exhibitors(user_id,fair,slug,name)values('${OWNER}','test-fair','test-exhibitor','Espositore di prova');`)
  run=(await json(`select public.claim_office_agent_run('events_scout','${OWNER}','run')`)).run.id
})
test('eventi DB: otto claim prenotano un solo giorno, nessuna attività prima del clic',async()=>{
  const claims=await Promise.all(Array.from({length:8},claim));assert.equal(claims.filter((c)=>c.claimed).length,1);batch=claims.find((c)=>c.claimed).id
  assert.equal(await scalar('select count(*) from office_event_batches'),'1');assert.equal(await scalar('select count(*) from tasks'),'0')
  await finish();assert.equal(await scalar('select count(*) from tasks'),'0')
  assert.equal(await scalar("select name from trade_fair_exhibitors where slug='test-exhibitor'"),'Espositore di prova')
})
test('eventi DB: unicità per nome normalizzato/data, report e task atomici, replay senza doppioni',async()=>{
  batch=(await claim()).id;const first=await finish([event,event]);assert.equal(first.created,1);assert.equal(first.tasks,1)
  assert.equal((await finish()).report_id,first.report_id);assert.equal(await scalar('select count(*) from office_events'),'1')
  assert.equal(await scalar('select count(*) from office_agent_outputs'),'2')
  assert.equal(await scalar("select count(*) from office_agent_outputs where title='Eventi e bandi' and status='pending'"),'1')
})
test('eventi DB: CHECK su tipi, date e scadenze reali, link o data non letti causano rollback',async()=>{
  batch=(await claim()).id
  assert.match((await error(`select public.finish_office_event_batch('${run}','${batch}',${quote([{...event,url:'https://invented.example.org'}])},'{}')`))!,/riscontro/)
  assert.match((await error(`select public.finish_office_event_batch('${run}','${batch}',${quote([{...event,start_date:after(21)}])},'{}')`))!,/riscontro/)
  assert.match((await error(`select public.finish_office_event_batch('${run}','${batch}',${quote([{...event,kind:'invented'}])},'{}')`))!,/check constraint/)
  assert.match((await error(`select public.finish_office_event_batch('${run}','${batch}',${quote([{...event,deadlines:[{kind:'grant',date:'2026-02-30'}]}])},'{}')`))!,/Scadenze/)
  assert.equal(await scalar('select count(*) from office_events'),'0');assert.equal(await scalar('select count(*) from office_agent_outputs'),'0')
  await finish()
  assert.match((await error("update office_events set start_date=(now() at time zone 'Europe/Rome')::date-1"))!,/check constraint/)
  assert.match((await error("update office_events set end_date=start_date-1"))!,/check constraint/)
  assert.match((await error("update office_events set start_date=((now() at time zone 'Europe/Rome')::date+interval '7 months')::date,end_date=null"))!,/check constraint/)
})
test('eventi DB: approvare con otto clic crea UNA attività standalone e registra il collegamento',async()=>{
  batch=(await claim()).id;await finish();const id=(await decision())!
  const results=await Promise.all(Array.from({length:8},()=>decide(id)))
  assert.equal(results.filter((r)=>r.output?.status==='approved').length,1)
  assert.equal(results.filter((r)=>r.reason==='already_decided').length,7)
  const item=await json('select row_to_json(t) from tasks t limit 1')
  const eventId=await scalar('select id from office_events')
  assert.equal(item.contact_id,null);assert.equal(item.type,'todo');assert.equal(item.area,'speaqi');assert.equal(item.status,'pending')
  assert.equal(item.idempotency_key,`office-event:${eventId}`)
  assert.equal(await scalar("select (due_date at time zone 'Europe/Rome')::date from tasks"),after(10))
  assert.equal(await scalar('select count(*) from tasks'),'1')
  // Anche due output diversi per lo stesso evento non duplicano l'attività.
  const other=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body,target_table,target_id)
    select agent_id,user_id,'duplicate-proposal',kind,title,body,target_table,target_id from office_agent_outputs where id='${id}' returning id`))!
  await decide(other);assert.equal(await scalar('select count(*) from tasks'),'1')
})
test('eventi DB: rifiuto senza effetti e workspace diverso non decide',async()=>{
  batch=(await claim()).id;await finish();const id=(await decision())!
  assert.equal((await decide(id,'approved',OTHER)).reason,'not_found')
  assert.equal((await decide(id,'rejected')).output.status,'rejected');assert.equal(await scalar('select count(*) from tasks'),'0')
})
test('eventi DB: anche gli eventi già noti nella finestra dei trenta giorni ricevono la proposta',async()=>{
  await sql(`insert into office_events(user_id,slug,name,start_date,url,kind,deadlines,score,source_url,first_seen_run_id)
    values('${OWNER}','gia-noto','Fiera turismo già nota','${after(20)}','https://events.example.org/known','fair',${quote(event.deadlines)},40,'${SOURCE}','${run}')`)
  batch=(await claim()).id;const result=await finish([])
  assert.equal(result.created,0);assert.equal(result.tasks,1);assert.equal(await scalar('select count(*) from tasks'),'0')
})
test('eventi DB: RLS proprietario, nessuna scrittura diretta e RPC private',async()=>{
  batch=(await claim()).id;await finish()
  for(const table of ['office_events','office_event_batches']){
    const rows=await sql(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from ${table}`);assert.equal(rows.at(-1)?.[0],'0')
    assert.match((await error(`set role authenticated;delete from ${table}`))!,/permission denied/)
    assert.match((await error(`set role service_role;delete from ${table}`))!,/permission denied/)
  }
  assert.match((await error(`set role authenticated;select public.claim_office_event_batch('${run}','[]')`))!,/permission denied/)
  assert.equal(await scalar("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('claim_office_event_batch','finish_office_event_batch','decide_office_output') and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))"),'0')
})
test('eventi DB: il ramo merge_contacts del 05 continua a unire con i vincoli originali',async()=>{
  await sql(`insert into contacts(id,user_id,name,email,status,company)values('${KEEP}','${OWNER}','Ente uno','info@example.org','New',null),('${DROP}','${OWNER}','Ente due','info@example.org','New','Azienda verificata');
    insert into tasks(user_id,contact_id,type,title)values('${OWNER}','${DROP}','todo','Attività da spostare');`)
  const output=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body)
    values('db_cleaner','${OWNER}','regression','data_fix','Unire',${quote({action:'merge_contacts',groups:[{keep:KEEP,drop:[DROP]}]})}) returning id`))!
  const result=await decide(output);assert.equal(result.output.status,'approved')
  assert.equal(await scalar(`select hidden from contacts where id='${DROP}'`),'t')
  assert.equal(await scalar(`select company from contacts where id='${KEEP}'`),'Azienda verificata')
  assert.equal(await scalar('select contact_id from tasks'),KEEP);assert.equal(await scalar('select count(*) from contacts'),'2')
  assert.equal(await scalar("select count(*) from activities where metadata->>'source'='office_db_cleaner'"),'1')
})
test('eventi DB: anche il ramo del Direttore resta operativo senza avviare agenti',async()=>{
  const output=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body,target_table,target_id)
    values('director','${OWNER}','director-regression','proposal','Costruire Marsiglia',${quote({action:'build_map',action_key:'build_map:marsiglia',recipient_agent_id:'mymaps_builder',city:'Marsiglia'})},'tourism_destinations','marsiglia') returning id`))!
  assert.equal((await decide(output)).output.status,'approved')
  assert.equal(await scalar("select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'"),'1')
  assert.equal(await scalar("select enabled from office_agents where id='mymaps_builder'"),'f')
})
