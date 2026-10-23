import assert from 'node:assert/strict'
import {before,beforeEach,test} from 'node:test'
import {resetOfficeDatabase} from './office-schema'
import {sql as query,scalar as value,expectError as failure} from './psql'
import {buildSocialPosts,type SocialGuide} from '../src/lib/office/social'
const DB='office_social_test',OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222'
const sql=(s:string)=>query(s,DB),scalar=(s:string)=>value(s,DB),error=(s:string)=>failure(s,DB)
const guide:SocialGuide={id:'marsiglia',slug:'marsiglia',name:'Marsiglia',url:'https://guides.speaqi.com/maps/marsiglia',points:28,languages:null,routes:null,audio_minutes:null,
  photo_urls:['https://images.speaqi.com/marsiglia.jpg'],published_at:null,source_url:'https://api.speaqi.com/api/v1/public/maps/marsiglia',changes:[]}
let run:string,batch:string
const claim=(source=guide)=>scalar(`select public.claim_office_social_batch('${run}','${JSON.stringify([source])}')`).then((s)=>JSON.parse(s!))
const finish=(posts=buildSocialPosts(null,[guide]))=>scalar(`select public.finish_office_social_batch('${batch}','${run}','${JSON.stringify(posts)}')`).then((s)=>JSON.parse(s!))
before(async()=>{await resetOfficeDatabase(DB,['20261023060654_office_social_drafts.sql']);await sql(`insert into auth.users(id)values('${OWNER}'),('${OTHER}')`)})
beforeEach(async()=>{await sql(`truncate office_social_snapshots,office_social_batches,office_agents cascade;insert into office_agents(id,user_id,name,department,enabled)values('social','${OWNER}','Social','marketing',true);`)
  run=JSON.parse((await scalar(`select public.claim_office_agent_run('social','${OWNER}','run')`))!).run.id})
test('social DB: schema reale mantiene i CHECK email source/status e non crea email',async()=>{
  assert.match((await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_source_check'"))!,/office/)
  assert.match((await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_status_check'"))!,/pending/)
  assert.equal(await scalar('select count(*) from email_drafts'),'0')
})
test('social DB: otto corse concorrenti prendono una sola settimana',async()=>{
  const claims=await Promise.all(Array.from({length:8},()=>claim()));assert.equal(claims.filter((c)=>c.claimed).length,1)
  assert.equal(await scalar('select count(*) from office_social_batches'),'1')
})
test('social DB: tre bozze atomiche solo draft_post pending, snapshot e replay senza doppioni',async()=>{
  batch=(await claim()).id;const a=await finish();assert.equal(a.created,true);assert.equal((await finish()).created,false)
  assert.equal(await scalar("select count(*) from office_agent_outputs where kind='draft_post' and status='pending'"),'3')
  assert.equal(await scalar('select count(*) from office_social_snapshots'),'1');assert.equal(await scalar('select count(*) from email_drafts'),'0')
  assert.equal(await scalar("select count(*) from office_agent_outputs where status<>'pending' or kind<>'draft_post'"),'0')
})
test('social DB: UTM, foto e Napoli alterati respinti senza salvataggi parziali',async()=>{
  batch=(await claim()).id
  const posts=buildSocialPosts(null,[guide]);posts[2].photo_url='https://images.speaqi.com/inventata.jpg'
  await assert.rejects(finish(posts),/foto inventata/);assert.equal(await scalar('select count(*) from office_agent_outputs'),'0')
  const links=buildSocialPosts(null,[guide]);links[1].platforms.instagram.url='https://invented.example.org/'
  await assert.rejects(finish(links),/UTM/);assert.equal(await scalar('select count(*) from office_social_snapshots'),'0')
  assert.match((await error(`select public.claim_office_social_batch('${run}','${JSON.stringify([{...guide,slug:'napolimap',name:'Napoli',url:'https://guides.speaqi.com/maps/napolimap'}])}')`))!,/Napoli/)
})
test('social DB: dati di altro run, RLS e privilegi browser rifiutati',async()=>{
  batch=(await claim()).id;await finish()
  for(const table of ['office_social_batches','office_social_snapshots']){const rows=await sql(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from ${table}`);assert.equal(rows.at(-1)?.[0],'0')}
  assert.match((await error(`set role authenticated;select public.claim_office_social_batch('${run}','[]')`))!,/permission denied/)
  assert.match((await error('set role authenticated;update office_social_batches set status=\'done\''))!,/permission denied/)
  assert.match((await error(`select public.finish_office_social_batch('${OTHER}','${run}','[]')`))!,/altro workspace/)
})
