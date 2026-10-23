import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB='office_presentations_test',OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222'
const ENTITY='33333333-3333-4333-8333-333333333333',DEST='44444444-4444-4444-8444-444444444444',CONTACT='55555555-5555-4555-8555-555555555555'
const sql=(s:string)=>query(s,DB),scalar=(s:string)=>value(s,DB),error=(s:string)=>failure(s,DB)
const json=async(s:string)=>JSON.parse((await scalar(s))!)
let run:string,task:string
const claim=()=>json(`select public.claim_office_presentation('${run}','${ENTITY}','${DEST}','https://crm.example.org')`)
const approve=()=>sql(`update tourism_decks set status='approved',approved_at=now() where id='${task}'`)
const deck=async(text='Da rivedere')=>sql(`insert into tourism_decks(id,user_id,entity_id,title,destination,status,slides)
  values('${task}','${OWNER}','${ENTITY}','Proposta Marsiglia','Marsiglia','ready','[{"id":"s","kind":"statement","title":"Territorio","body":"${text}","items":[],"note":"","hint":"","image_asset_id":null}]')`)
before(async()=>{
  await resetOfficeDatabase(DB,[
    '20261017205455_tourism_intelligence.sql','20261018185155_tourism_site_research.sql',
    '20261019051155_tourism_sitemap_targeting.sql','20261019190000_tourism_decks.sql','20261023090100_office_presentations.sql'
  ])
  await sql(`insert into auth.users(id)values('${OWNER}'),('${OTHER}')`)
})
beforeEach(async()=>{
  await sql(`set request.jwt.claim.sub='${OWNER}';truncate office_presentation_tasks,office_agents,tourism_decks,contacts,tourism_entities cascade;
    insert into office_agents(id,user_id,name,department,enabled)values('presentations','${OWNER}','Presentazioni','commerciale',true);
    insert into tourism_entities(id,user_id,kind,name,country_code,type_code,email)values
      ('${ENTITY}','${OWNER}','organization','Ente Marsiglia','FR','dmo','info@marsiglia.example.org'),
      ('${DEST}','${OWNER}','place','Marsiglia','FR',null,null);
    insert into tourism_evidence(user_id,entity_id,source_url,title,fields,status)values
      ('${OWNER}','${ENTITY}','https://tourisme.example.org','Identità ente',array['name','country_code','type_code','email'],'VERIFIED'),
      ('${OWNER}','${DEST}','https://tourisme.example.org','Identità luogo',array['name'],'VERIFIED');
    update tourism_entities set status='VERIFIED' where user_id='${OWNER}';
    insert into contacts(id,user_id,name,email,status)values('${CONTACT}','${OWNER}','Ente Marsiglia','info@marsiglia.example.org','New');
    insert into tourism_crm_links(user_id,entity_id,contact_id)values('${OWNER}','${ENTITY}','${CONTACT}');`)
  run=(await json(`select public.claim_office_agent_run('presentations','${OWNER}','test')`)).run.id
})
test('presentazioni DB: schema originale conserva CHECK source/status, claim concorrenti prima del modello',async()=>{
  assert.match((await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_source_check'"))!,/office/)
  const claims=await Promise.all(Array.from({length:8},claim));assert.equal(claims.filter((c)=>c.claimed).length,1)
  assert.equal(await scalar('select count(*) from office_presentation_tasks'),'1')
  assert.equal(await scalar('select count(*) from tourism_decks'),'0');assert.equal(await scalar('select count(*) from email_drafts'),'0')
})
test('presentazioni DB: ready va in attesa, nessuna approvazione o email dal finalize, replay senza doppioni',async()=>{
  task=(await claim()).task.id;await deck('[DA VERIFICARE: quanti] luoghi')
  const finish=()=>scalar(`select public.finish_office_presentation('${run}','${task}','{}')`)
  assert.equal(await finish(),await finish())
  assert.equal(await scalar('select status from tourism_decks'),'ready');assert.equal(await scalar('select count(*) from email_drafts'),'0')
  assert.equal((await json(`select public.prepare_office_presentation_email('${task}','${OWNER}')`)).reason,'not_approved')
  assert.match((await error(`update tourism_decks set status='approved',approved_at=now() where id='${task}'`))!,/segnaposto/)
  assert.equal(await scalar('select status from tourism_decks'),'ready')
  assert.equal(await scalar("select count(*) from office_agent_outputs where status='pending' and kind='report'"),'1')
  const first=await finish()
  await sql(`update office_agent_runs set status='done' where id='${run}'`)
  run=(await json(`select public.claim_office_agent_run('presentations','${OWNER}','next-run')`)).run.id
  assert.equal(await finish(),first);assert.equal(await scalar('select count(*) from office_agent_outputs'),'1')
})
test('presentazioni DB: solo il clic di approvazione prepara una email office pending con link pubblico; otto retry non duplicano',async()=>{
  task=(await claim()).task.id;await deck();await approve()
  assert.equal(await scalar("select count(*) from email_drafts where source='office' and status='pending' and office_agent_id='presentations'"),'1')
  const token=await scalar('select public_token from tourism_decks');assert.equal(await scalar(`select strpos(body_text,'https://crm.example.org/presentazione/${token}')>0 from email_drafts`),'t')
  await Promise.all(Array.from({length:8},()=>json(`select public.prepare_office_presentation_email('${task}','${OWNER}')`)))
  assert.equal(await scalar('select count(*) from email_drafts'),'1')
  assert.match((await error("update email_drafts set source='auto'"))!,/email_drafts_office_manual/)
})
test('presentazioni DB: nessuna bozza per email non verificata, altro workspace, contatto disiscritto o bozza già pendente',async()=>{
  task=(await claim()).task.id;await deck()
  await sql(`update contacts set email_unsubscribed_at=now() where id='${CONTACT}'`);await approve()
  assert.equal(await scalar('select count(*) from email_drafts'),'0')
  await sql(`update contacts set email_unsubscribed_at=null where id='${CONTACT}';delete from tourism_evidence where entity_id='${ENTITY}'`)
  assert.equal((await json(`select public.prepare_office_presentation_email('${task}','${OWNER}')`)).reason,'verified_email_missing')
  assert.equal((await json(`select public.prepare_office_presentation_email('${task}','${OTHER}')`)).reason,'not_office')
  assert.equal(await scalar('select count(*) from email_drafts'),'0')
})
test('presentazioni DB: una bozza manuale pendente blocca la nuova, approvazione conservata e recuperabile',async()=>{
  task=(await claim()).task.id;await deck()
  await sql(`insert into email_drafts(user_id,contact_id,subject,body_text,source,status)values('${OWNER}','${CONTACT}','Manuale','Testo','manual','pending')`)
  await approve();assert.equal(await scalar('select email_state from office_presentation_tasks'),'pending_draft')
  assert.equal(await scalar('select count(*) from email_drafts'),'1');assert.equal(await scalar('select status from tourism_decks'),'approved')
  await sql("update email_drafts set status='dismissed'")
  assert.equal((await json(`select public.prepare_office_presentation_email('${task}','${OWNER}')`)).created,true)
})
test('presentazioni DB: approvazione e registrazione concorrenti non bloccano e non duplicano la bozza',async()=>{
  task=(await claim()).task.id;await deck()
  await Promise.all([approve(),scalar(`select public.finish_office_presentation('${run}','${task}','{}')`)])
  assert.equal(await scalar('select status from tourism_decks'),'approved')
  assert.equal(await scalar('select count(*) from email_drafts'),'1')
  assert.equal(await scalar('select count(*) from office_agent_outputs'),'1')
})
test('presentazioni DB: RLS e RPC private, corsa scaduta e Napoli bloccate',async()=>{
  task=(await claim()).task.id
  assert.equal((await sql(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from office_presentation_tasks`)).at(-1)?.[0],'0')
  assert.match((await error(`set role authenticated;select public.prepare_office_presentation_email('${task}','${OWNER}')`))!,/permission denied/)
  assert.match((await error(`set role authenticated;delete from office_presentation_tasks`))!,/permission denied/)
  await sql(`set request.jwt.claim.sub='${OWNER}';update tourism_entities set name='Napoli' where id='${DEST}'`)
  assert.match((await error(`select public.claim_office_presentation('${run}','${ENTITY}','${DEST}','https://crm.example.org')`))!,/non verificati|Napoli/)
  await sql(`update office_agent_runs set started_at=now()-interval '31 minutes' where id='${run}'`)
  assert.match((await error(`select public.claim_office_presentation('${run}','${ENTITY}','${DEST}','https://crm.example.org')`))!,/non attiva/)
})
