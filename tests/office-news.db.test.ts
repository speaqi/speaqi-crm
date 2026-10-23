import assert from 'node:assert/strict'
import { before,beforeEach,test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query,scalar as value,expectError as failure } from './psql'
const DB='office_news_test'
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222'
const sql=(s:string)=>query(s,DB),scalar=(s:string)=>value(s,DB),error=(s:string)=>failure(s,DB)
let run:string,batch:string
const sources=()=>JSON.stringify([{url:'https://news.example.org/a',title:'Turismo e musei',published_at:new Date(Date.now()-3600_000).toISOString(),excerpt:'Fonti reali del test',feed_url:'https://news.example.org/rss'}])
const body=(url='https://news.example.org/a')=>JSON.stringify({articles:[{url,title:'Turismo e musei',summary:'Novità del turismo.',why:'Utile per i musei.'}],telegram_available:true})
const claim=()=>scalar(`select public.claim_office_news_batch('${run}','${sources()}')`).then((r)=>JSON.parse(r!))
const finish=(payload=body())=>scalar(`select public.finish_office_news_batch('${batch}','${run}','${payload}')`)
before(async()=>{await resetOfficeDatabase(DB,['20261023055356_office_news_watch.sql']);await sql(`insert into auth.users(id)values('${OWNER}'),('${OTHER}')`)})
beforeEach(async()=>{
  await sql(`truncate office_news_seen,office_news_deliveries,office_news_batches,office_agents cascade;
    insert into office_agents(id,user_id,name,department,enabled,settings)values('news_watch','${OWNER}','Notizie','ricerca',true,'{"telegram":true}');`)
  run=JSON.parse((await scalar(`select public.claim_office_agent_run('news_watch','${OWNER}','run')`))!).run.id
})
test('notizie DB: DDL reali conservano CHECK source/status di email_drafts e priorità contacts',async()=>{
  assert.match((await scalar(`select pg_get_constraintdef(oid) from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_source_check'`))!,/office/)
  assert.match((await error(`insert into contacts(id,user_id,name,status,priority)values('${OTHER}','${OWNER}','Ente','New',4)`))!,/check/)
  await sql(`insert into contacts(id,user_id,name,status)values('${OTHER}','${OWNER}','Ente','New')`)
  assert.match((await error(`insert into email_drafts(user_id,contact_id,source)values('${OWNER}','${OTHER}','inventata')`))!,/source_check/)
  assert.match((await error(`insert into email_drafts(user_id,contact_id,status)values('${OWNER}','${OTHER}','approved')`))!,/status_check/)
  await sql('delete from contacts')
})
test('notizie DB: otto richieste concorrenti prenotano un solo tentativo; riserva conservata anche dopo timeout',async()=>{
  const claims=await Promise.all(Array.from({length:8},claim));assert.equal(claims.filter((r)=>r.claimed).length,1)
  assert.equal(await scalar('select count(*) from office_news_batches'),'1')
  await sql(`update office_agent_runs set status='failed' where id='${run}'`)
  assert.match((await error(`select public.claim_office_news_batch('${run}','[]')`))!,/non attiva/)
})
test('notizie DB: report e visti sono atomici, replay senza doppioni, link inventato respinto',async()=>{
  batch=(await claim()).id
  assert.match((await error(`select public.finish_office_news_batch('${batch}','${run}','${body('https://invented.example.org/a')}')`))!,/senza riscontro/)
  assert.equal(await scalar('select count(*) from office_news_seen'),'0');assert.equal(await scalar('select count(*) from office_agent_outputs'),'0')
  const first=await finish();assert.equal(await finish(),first)
  assert.equal(await scalar('select count(*) from office_news_seen'),'1');assert.equal(await scalar("select count(*) from office_agent_outputs where kind='report' and status='pending'"),'1')
  assert.equal(await scalar('select count(*) from office_news_deliveries'),'0')
})
test('notizie DB: Telegram si prenota solo dopo clic, una volta anche con otto clic e nessun invio SQL',async()=>{
  batch=(await claim()).id;const output=await finish()
  assert.match((await error(`select public.claim_office_news_delivery('${output}','${OTHER}')`))!,/non abilitato/)
  const results=await Promise.all(Array.from({length:8},()=>scalar(`select public.claim_office_news_delivery('${output}','${OWNER}')`).then((r)=>JSON.parse(r!))))
  assert.equal(results.filter((r)=>r.claimed).length,1);assert.equal(await scalar('select count(*) from office_news_deliveries'),'1')
  assert.equal(await scalar(`select status from office_agent_outputs where id='${output}'`),'approved')
  const id=results.find((r)=>r.claimed).id
  await sql(`select public.record_office_news_delivery('${id}','${OWNER}',null,'Timeout')`)
  assert.equal(await scalar('select status from office_news_deliveries'),'uncertain')
  assert.equal(JSON.parse((await scalar(`select public.claim_office_news_delivery('${output}','${OWNER}')`))!).claimed,false)
})
test('notizie DB: RLS proprietario e RPC riservate, altri workspace e browser senza scrittura',async()=>{
  batch=(await claim()).id;await finish()
  for(const table of ['office_news_batches','office_news_seen']) {
    const rows=await sql(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from ${table}`)
    assert.equal(rows.at(-1)?.[0],'0')
  }
  assert.match((await error(`set role authenticated;select public.claim_office_news_batch('${run}','[]')`))!,/permission denied/)
  assert.match((await error(`set role authenticated;delete from office_news_seen`))!,/permission denied/)
  assert.equal(await scalar(`select count(*) from pg_proc where proname in ('claim_office_news_batch','finish_office_news_batch','claim_office_news_delivery','record_office_news_delivery') and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))`),'0')
})
