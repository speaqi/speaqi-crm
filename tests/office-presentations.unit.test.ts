import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { DEFAULT_DECK_TEMPLATE, applyVars } from '../src/lib/tourism-deck'
import { presentationQueue, deckPlaceholders, presentationFixes } from '../src/lib/office/presentations'
import { presentationsHandler, presentationEntities } from '../src/lib/server/office-agents/presentations'
import { createDeck, setApproval } from '../src/lib/server/tourism-decks'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'
import { MODEL_URL, modelReply } from './model-reply'

const ENTITY='11111111-1111-4111-8111-111111111111',DEST='22222222-2222-4222-8222-222222222222'
const slides=applyVars(DEFAULT_DECK_TEMPLATE,{destinazione:'Marsiglia',ente:'Ente Marsiglia'})
test('presentazioni: coda validata e deduplicata, agente spento con 300 centesimi a settimana',()=>{
  assert.deepEqual(presentationQueue([ENTITY,{entity_id:ENTITY}]),[{entity_id:ENTITY}])
  assert.throws(()=>presentationQueue([{entity_id:'x'}]),/UUID/)
  assert.equal(OFFICE_AGENT_DEFINITIONS.presentations.enabled,false)
  assert.equal(OFFICE_AGENT_DEFINITIONS.presentations.weekly_budget_cents,300)
})
test('presentazioni: un segnaposto ha proposta solo con campo attestato, valore e fonte verificata',()=>{
  const entity={id:DEST,details:{place_count:28}}
  const source={id:'e',entity_id:DEST,status:'VERIFIED',fields:['details.place_count'],source_url:'https://tourisme.example.org/places',excerpt:'Il territorio presenta 28 luoghi visitabili.'}
  const before=JSON.stringify(slides)
  const fixes=presentationFixes(slides,[entity],[source]);assert.equal(fixes.length,1);assert.equal(fixes[0].replacement,'28')
  for(const patch of [{status:'UNVERIFIED'},{source_url:'http://127.0.0.1/x'},{excerpt:'Sono 128 luoghi.'},{fields:['route_count']},{entity_id:ENTITY}]){
    assert.equal(presentationFixes(slides,[entity],[{...source,...patch}]).length,0)
  }
  assert.equal(presentationFixes(slides,[entity],[]).length,0)
  assert.equal(presentationFixes(slides,[{...entity,details:{place_count:'28'}}],[{...source,excerpt:'Sono 128 luoghi.'}]).length,0)
  assert.equal(JSON.stringify(slides),before);assert.ok(deckPlaceholders(slides).length>=3)
})
test('presentazioni: fonti discordanti lasciano il segnaposto segnalato',()=>{
  const evidence=[{id:'a',entity_id:ENTITY,status:'VERIFIED',fields:['place_count'],source_url:'https://a.example.org',excerpt:'28 luoghi'},
    {id:'b',entity_id:DEST,status:'VERIFIED',fields:['place_count'],source_url:'https://b.example.org',excerpt:'30 luoghi'}]
  assert.equal(presentationFixes(slides,[{id:ENTITY,details:{place_count:28}},{id:DEST,details:{place_count:30}}],evidence).length,0)
})
function fixture(){
  const order:string[]=[]
  const db=new FakeSupabase({tourism_entities:[{id:ENTITY,user_id:'owner',kind:'organization',name:'Ente Marsiglia',country_code:'FR',status:'VERIFIED',details:{}},
    {id:DEST,user_id:'owner',kind:'place',name:'Marsiglia',country_code:'FR',status:'VERIFIED',details:{}}],tourism_evidence:[],
    tourism_deck_templates:[{user_id:'owner',is_default:true,version:1,content:DEFAULT_DECK_TEMPLATE}],office_presentation_tasks:[],tourism_decks:[],office_agent_outputs:[]}, {
    claim_office_presentation(args){order.push('claim');const old=db.tables.office_presentation_tasks[0];if(old)return{claimed:false,task:old}
      const task={id:'task',user_id:'owner',state:'claimed',email_prepared_at:null};db.tables.office_presentation_tasks.push(task);return{claimed:true,task}},
    finish_office_presentation(){order.push('finish');db.tables.office_presentation_tasks[0].state='ready';return'output'},
    prepare_office_presentation_email(){order.push('email-check');return{created:false,reason:'not_approved'}},
  })
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.presentations,user_id:'owner',settings:{queue:[{entity_id:ENTITY,destination_id:DEST}]}},runId:'run',
    async reserve(){order.push('reserve');return'ledger'},async settle(){order.push('settle')},async addOutput(output){db.tables.office_agent_outputs.push(output);return'o'},log(){}}
  const create:typeof createDeck=async(...args)=>{const row=await createDeck(...args);Object.assign(row,{assets:[],status:'draft',version:1});return row}
  return{db,ctx,order,create}
}
test('presentazioni: riusa createDeck e generateIntoDeck, riserva prima di OpenAI, ready mai approved, retry senza costo',async()=>{
  const f=fixture();const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
    assert.equal(url,MODEL_URL);f.order.push('provider')
    const body=JSON.parse(String(init?.body));assert.equal(body.response_format.json_schema.name,'tourism_deck')
    return modelReply(JSON.stringify({slides,missing:[]}),{input_tokens:1000,output_tokens:100})
  })
  try{const handler=presentationsHandler(f.db,{create:f.create});await handler(f.ctx);await handler(f.ctx)
    assert.equal(fetch.mock.callCount(),1);assert.deepEqual(f.order.slice(0,4),['claim','reserve','provider','settle'])
    assert.equal(f.db.tables.tourism_decks.length,1);assert.equal(f.db.tables.tourism_decks[0].status,'ready');assert.equal(f.db.tables.tourism_decks[0].approved_at,null)
    assert.equal(f.db.tables.email_drafts?.length||0,0)
  }finally{fetch.mock.restore();if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old}
})
test('presentazioni: timeout non ripaga e non approva; la pipeline conserva failed e la riserva',async()=>{
  const f=fixture();let calls=0;const handler=presentationsHandler(f.db,{create:f.create,model:async()=>{calls++;throw new Error('Timeout')}})
  await assert.rejects(handler(f.ctx),/Timeout/);await handler(f.ctx);assert.equal(calls,1);assert.equal(f.db.tables.tourism_decks[0].status,'failed')
})
test('presentazioni: Napoli, altri workspace e destinazione ambigua non avviano generazioni',async()=>{
  const f=fixture();await assert.rejects(presentationEntities(f.db,'other',{entity_id:ENTITY,destination_id:DEST}),/non verificato/)
  await assert.rejects(presentationEntities(f.db,'owner',{entity_id:ENTITY}),/destination_id/)
  f.db.tables.tourism_entities[1].name='Napoli';await presentationsHandler(f.db,{create:f.create})(f.ctx)
  assert.equal(f.db.calls.some((c)=>c.rpc==='claim_office_presentation'),false)
  assert.equal(f.db.tables.tourism_decks.length,0)
})
test('presentazioni: la pipeline esistente vieta approvazione con segnaposto',async()=>{
  await assert.rejects(setApproval(new FakeSupabase(),{slides,status:'ready'} as any,true),/DA VERIFICARE/)
})
