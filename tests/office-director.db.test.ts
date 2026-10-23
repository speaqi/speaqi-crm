import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resetDatabase, sql as query, scalar as value, expectError as failure } from './psql'

const DB='office_director_test'
const OWNER='11111111-1111-4111-8111-111111111111'
const OTHER='22222222-2222-4222-8222-222222222222'
const sql=(s:string)=>query(s,DB)
const scalar=(s:string)=>value(s,DB)
const expectError=(s:string)=>failure(s,DB)
let outputId:string
const decide=(status='approved',owner=OWNER,id=outputId)=>scalar(`select public.decide_office_output('${id}','${owner}','${status}')`).then((s)=>JSON.parse(s!))

before(async()=>{
  await resetDatabase(DB)
  await sql(await readFile(new URL('../supabase/migrations/20261022183327_office_director.sql',import.meta.url),'utf8'))
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})
beforeEach(async()=>{
  await sql(`truncate office_agents cascade;
    insert into office_agents(id,user_id,name,department,settings) values('director','${OWNER}','Direttore','direzione','{}'),
      ('mymaps_builder','${OWNER}','Mappe','mappe','{"model":"gpt-5-mini"}'),('maps_quality','${OWNER}','Qualità','mappe','{}'),('languages_voice','${OWNER}','Lingue','mappe','{}');`)
  outputId=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body,target_table,target_id)
    values('director','${OWNER}','proposta','proposal','Costruire Marsiglia',
    '{"action":"build_map","action_key":"build_map:marsiglia","recipient_agent_id":"mymaps_builder","city":"Marsiglia"}',
    'tourism_destinations','33333333-3333-4333-8333-333333333333') returning id`))!
})

test('Direttore: otto clic concorrenti prendono una decisione e accodano una volta, agente sempre spento',async()=>{
  const decisions=await Promise.all(Array.from({length:8},()=>decide()))
  assert.equal(decisions.filter((d)=>d.output?.status==='approved').length,1)
  assert.equal(decisions.filter((d)=>d.reason==='already_decided').length,7)
  assert.equal(await scalar("select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'"),'1')
  assert.equal(await scalar("select settings->>'model' from office_agents where id='mymaps_builder'"),'gpt-5-mini')
  assert.equal(await scalar('select count(*) from office_agents where enabled'),'0')
  assert.equal(await scalar('select count(*) from office_agent_runs'),'0')
})

test('Direttore: due proposte della stessa azione non duplicano la coda',async()=>{
  await decide()
  const id=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body,target_table,target_id)
    select agent_id,user_id,'altra',kind,title,body,target_table,target_id from office_agent_outputs where id='${outputId}' returning id`))!
  assert.equal((await decide('approved',OWNER,id)).output.status,'approved')
  assert.equal(await scalar("select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'"),'1')
})

test('Direttore: pubblicazione e lingue vengono accodate ai soli destinatari previsti',async()=>{
  for (const item of [{action:'publication_review',recipient:'maps_quality',table:'studiomap_maps'},
    {action:'complete_languages',recipient:'languages_voice',table:'speaqi_maps'}]) {
    const body=JSON.stringify({action:item.action,action_key:`${item.action}:marsiglia`,recipient_agent_id:item.recipient,city:'Marsiglia',map_slug:'marsiglia'})
    const id=(await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body,target_table,target_id)
      values('director','${OWNER}','${item.action}','proposal','Marsiglia','${body}','${item.table}','marsiglia') returning id`))!
    assert.equal((await decide('approved',OWNER,id)).output.status,'approved')
    assert.equal(await scalar(`select settings->'queue'->0->>'action' from office_agents where id='${item.recipient}'`),item.action)
  }
  assert.equal(await scalar('select count(*) from office_agent_runs'),'0')
})

test('Direttore: rifiuto tracciato, altro workspace e destinatario mancante non producono effetti',async()=>{
  assert.equal((await decide('approved',OTHER)).reason,'not_found')
  await sql("delete from office_agents where id='mymaps_builder'")
  assert.equal((await decide()).reason,'agent_missing')
  assert.equal(await scalar(`select status from office_agent_outputs where id='${outputId}'`),'pending')
  assert.equal((await decide('rejected')).output.status,'rejected')
  assert.equal(await scalar(`select (decided_at is not null)::text from office_agent_outputs where id='${outputId}'`),'true')
})

test('Direttore: Napoli, target alterati e chiamate non privilegiate rifiutati',async()=>{
  await sql(`update office_agent_outputs set body=jsonb_set(body,'{city}','"Naples"') where id='${outputId}'`)
  assert.match((await expectError(`select public.decide_office_output('${outputId}','${OWNER}','approved')`))!,/Napoli/)
  await sql(`update office_agent_outputs set body=jsonb_set(body,'{city}','"Marsiglia"'),target_table='contacts' where id='${outputId}'`)
  assert.match((await expectError(`select public.decide_office_output('${outputId}','${OWNER}','approved')`))!,/non valida/)
  assert.match((await expectError(`set role authenticated;select public.decide_office_output('${outputId}','${OWNER}','approved')`))!,/permission denied/)
  assert.equal(await scalar(`select status from office_agent_outputs where id='${outputId}'`),'pending')
})

test('Direttore: le altre uscite registrano soltanto la decisione senza modificare il target',async()=>{
  await sql(`update office_agent_outputs set kind='data_fix',target_table='contacts',target_id='nessun-target-reale' where id='${outputId}'`)
  assert.equal((await decide()).output.status,'approved')
  assert.equal(await scalar("select count(*) from office_agents where settings ? 'queue'"),'0')
})
