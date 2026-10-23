import assert from 'node:assert/strict'
import { test,mock } from 'node:test'
import { socialGuideFromPublic,socialNumbersAllowed,socialUtm,validSocialCopy,buildSocialPosts,type SocialGuide,SOCIAL_PLATFORMS } from '../src/lib/office/social'
import { loadSocialGuides,socialHandler,socialWeek } from '../src/lib/server/office-agents/social'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { FakeSupabase } from './fake-supabase'
import type { AgentContext } from '../src/lib/server/office-agents'
import type { MapsStatus } from '../src/lib/server/maps-status'
const GUIDE:SocialGuide={id:'marsiglia',slug:'marsiglia',name:'Marsiglia',url:'https://guides.speaqi.com/maps/marsiglia',points:28,languages:['it','en'],routes:3,audio_minutes:null,
  photo_urls:['https://images.speaqi.com/marsiglia.jpg'],published_at:null,source_url:'https://api.speaqi.com/api/v1/public/maps/marsiglia',changes:[]}
const maps:MapsStatus={rows:[{key:'marsiglia',name:'Marsiglia',stage:'online',places:28,ready_places:28,speaqi_slug:'marsiglia',studiomap_slug:null,price_cents:null},
  {key:'napoli',name:'Napoli',stage:'online',places:20,ready_places:20,speaqi_slug:'napolimap',studiomap_slug:null,price_cents:null}],sources:{speaqi:'ok',studiomap:'not_configured'},fetched_at:'2026-10-23T08:00:00Z'}
test('social: numeri legati al dato corretto, unità scambiate e cifre inventate scartate',()=>{
  assert.equal(socialNumbersAllowed('Marsiglia: 28 luoghi, 2 lingue, 3 itinerari.',GUIDE),true)
  for(const text of ['Marsiglia: 999 luoghi.','Marsiglia: 28 lingue.','Marsiglia: 3 minuti di audio.','Marsiglia: 5 motivi per partire.','Marsiglia: venti luoghi.'])assert.equal(socialNumbersAllowed(text,GUIDE),false,text)
  assert.equal(socialNumbersAllowed('Marsiglia: tre itinerari.',GUIDE),true)
})
test('social: UTM per piattaforma corretti e foto solo da payload pubblico, target lingue ignorati',()=>{
  for(const platform of SOCIAL_PLATFORMS){const url=new URL(socialUtm('marsiglia',platform));assert.equal(url.searchParams.get('utm_source'),platform);assert.equal(url.searchParams.get('utm_medium'),'social');assert.equal(url.searchParams.get('utm_campaign'),'office_social')}
  const guide=socialGuideFromPublic({id:'m',slug:'marsiglia',points:28,cover_image_url:GUIDE.photo_urls[0]},
    {id:'m',slug:'marsiglia',name:'Marsiglia',target_languages:['it','en','fr'],items:[],routes:[]},'/public/maps/marsiglia')!
  assert.equal(guide.languages,null);assert.deepEqual(guide.photo_urls,GUIDE.photo_urls)
  assert.equal(socialGuideFromPublic({id:'m',slug:'napolimap',cover_image_url:GUIDE.photo_urls[0]},{id:'m',slug:'napolimap',name:'Napoli'},'source'),null)
  assert.equal(socialGuideFromPublic({id:'m',slug:'marsiglia'},{id:'m',slug:'marsiglia',name:'Marsiglia',items:[]},'source'),null)
})
test('social: guide a pagamento non deducono itinerari dal paywall e contatori mancanti non sono zero',()=>{
  const guide=socialGuideFromPublic({id:'m',slug:'marsiglia',cover_image_url:GUIDE.photo_urls[0]},
    {id:'m',slug:'marsiglia',name:'Marsiglia',is_paid:true,access_status:'locked',items:[],routes:[]},'source')!
  assert.equal(guide.routes,null);assert.equal(guide.points,null);assert.equal(guide.audio_minutes,null)
})
test('social: tono, massimo cinque hashtag, nessun link nel testo o nuovo contenuto Napoli',()=>{
  for(const patch of [{text:'Marsiglia, la migliore guida gratuita.'},{text:'Marsiglia: visita anche Napoli.'},{text:'Nuova guida Marsiglia.'},{text:'Marsiglia https://invented.example.org'},{text:'Marsiglia: invented.org'},{text:'Marsiglia',hashtags:Array(6).fill('#Guida')}])
    assert.equal(validSocialCopy({hashtags:['#Speaqi'],...patch},GUIDE),null)
})
test('social: post invalidi scartati e sostituiti da bozze deterministiche con link e foto veri',()=>{
  const posts=buildSocialPosts({posts:[{slot:0,instagram:{text:'Marsiglia: 999 luoghi.',hashtags:[]}}]},[GUIDE])
  assert.equal(posts.length,3);assert.ok(posts.every((p)=>p.origin==='verified_fallback'&&p.photo_url===GUIDE.photo_urls[0]))
  assert.ok(posts.every((p)=>SOCIAL_PLATFORMS.every((platform)=>!p.platforms[platform].text.includes('999'))))
})
test('social: payload pubblico soltanto per guide online, nessuna lettura Napoli, copertura assente dichiarata',async()=>{
  const calls:string[]=[];const result=await loadSocialGuides(maps,async(path)=>{calls.push(path);if(path==='/public/guides/maps')return{maps:[{...GUIDE,cover_image_url:GUIDE.photo_urls[0]},{id:'napoli',slug:'napolimap',name:'Napoli'}]};return{...GUIDE,available_languages:['it','en'],items:[],routes:[]}})
  assert.equal(result.guides.length,1);assert.deepEqual(calls,['/public/guides/maps','/public/maps/marsiglia'])
  assert.equal((await loadSocialGuides({...maps,sources:{...maps.sources,speaqi:'error'}})).guides.length,0)
})
test('social: prenota prima del modello, solo draft_post pending via RPC, nessuna API social e niente seconda spesa',async()=>{
  const order:string[]=[];const db=new FakeSupabase({office_social_batches:[],office_social_snapshots:[]},{
    claim_office_social_batch(){order.push('claim');db.tables.office_social_batches.push({id:'batch',user_id:'owner',week:'2026-10-19'});return{claimed:true,id:'batch'}},
    finish_office_social_batch(args){order.push('save');assert.equal(args.p_posts.length,3);db.tables.posts=args.p_posts;return{created:true}},
  })
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.social,user_id:'owner'},runId:'run',async reserve(){order.push('reserve');return'l'},async settle(){order.push('settle')},async addOutput(){throw new Error('Solo salvataggio atomico')},log(){}}
  const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(url:unknown)=>{assert.equal(url,'https://api.openai.com/v1/responses');order.push('provider');return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:'{"posts":[]}'}]}]})})
  try{const run=socialHandler(db,{now:()=>new Date('2026-10-23T08:00:00Z'),maps:async()=>maps,guides:async()=>({guides:[structuredClone(GUIDE)],warnings:[]})});await run(ctx);await run(ctx)
    assert.deepEqual(order,['claim','reserve','provider','settle','save']);assert.equal(fetch.mock.callCount(),1);assert.equal(db.tables.posts.length,3)
  }finally{fetch.mock.restore();if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old}
  assert.equal(socialWeek(new Date('2026-10-25T22:00:00Z')),'2026-10-19');assert.equal(OFFICE_AGENT_DEFINITIONS.social.enabled,false)
})
