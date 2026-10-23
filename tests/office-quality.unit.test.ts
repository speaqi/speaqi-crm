import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { qualityAssignments, qualityModelFindings, qualityInventory, type QualitySample } from '../src/lib/office/map-quality'
import { mapsQualityHandler } from '../src/lib/server/office-agents/maps-quality'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import { BudgetExceeded } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

test('qualità: campione globale massimo 20, ruota fra mappe e non duplica con meno di 20 luoghi',()=>{
  const maps=[{slug:'a',city:'Marsiglia',total:25},{slug:'b',city:'Barcellona',total:25}]
  const a=qualityAssignments(maps,0);const b=qualityAssignments(maps,1)
  assert.equal([...a.values()].flat().length,20);assert.deepEqual(b.get('a'),[20,21,22,23,24]);assert.equal(b.get('b')?.length,15)
  assert.equal([...qualityAssignments([{...maps[0],total:3}],1).values()].flat().length,3)
  assert.throws(()=>qualityInventory({maps:[...maps,maps[0]]}),/non valida/)
  assert.equal(OFFICE_AGENT_DEFINITIONS.maps_quality.enabled,false)
})
test('qualità: frasi inventate, citazioni di altro luogo e fonti sconosciute scartate',()=>{
  const sample:QualitySample[]=[{key:'museo',name:'Museo',text:'Questo museo contiene una collezione archeologica.',sources:[{ref:'https://museo.test',data:'Fonte salvata'}]}]
  const value={issues:[{place_key:'museo',sentence:'Una frase inventata che non esiste.',source_refs:[]},
    {place_key:'altro',sentence:sample[0].text,source_refs:[]},{place_key:'museo',sentence:sample[0].text,source_refs:['https://inventata.test']},
    {place_key:'museo',sentence:sample[0].text,source_refs:['https://museo.test']},{place_key:'museo',sentence:sample[0].text,source_refs:[]}]}
  const result=qualityModelFindings(value,sample);assert.equal(result.length,1);assert.ok(result[0].message.includes(sample[0].text))
})

function fixture() {
  const db=new FakeSupabase({office_agent_outputs:[]});const order:string[]=[]
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.maps_quality,user_id:'owner'},runId:'run',async reserve(){order.push('reserve');return'ledger'},async settle(){order.push('settle')},log(){},
    async addOutput(o){order.push(`output:${o.kind}`);const id=db.nextId('out');db.tables.office_agent_outputs.push({id,user_id:'owner',agent_id:'maps_quality',output_key:o.key,status:'pending',...o});return id}}
  const bridge=async(_path:unknown,body:any)=> body.slug ? {slug:body.slug,city:'Marsiglia',total:1,read_only:true,naples:body.slug==='napolimap',fingerprint:'a'.repeat(64),translations_checked:0,warnings:['Traduzioni non disponibili'],groups:{},
    findings:[{code:'invalid_coordinates',place_key:'museo',severity:'serious',message:'Coordinate da verificare',proposal:{action:'verifica',value:null}}],
    sample:body.indices.length?[{key:'museo',name:'Museo',text:'Questo museo contiene una collezione archeologica.',sources:[{ref:'https://museo.test',data:'Fonte salvata'}]}]:[]}
    :{maps:[{slug:'marsiglia',city:'Marsiglia',total:1},{slug:'napolimap',city:'Napoli',total:1}]}
  return{db,ctx,order,bridge}
}
test('qualità: rapporti prima della spesa, JSON strict, budget prima del modello, niente fix Napoli e niente doppio costo',async()=>{
  const f=fixture();const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true)
    assert.equal(f.order.filter((x)=>x==='output:report').length,2);f.order.push('provider')
    return Response.json({status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({issues:[{place_key:'museo',sentence:'Frase inventata da eliminare.',source_refs:[]}]})}]}]})
  })
  try{
    const run=mapsQualityHandler(f.db,{now:()=>new Date('2026-10-23T08:00:00Z'),bridge:f.bridge});await run(f.ctx);const calls=fetch.mock.callCount();await run(f.ctx)
    assert.equal(calls,2);assert.equal(fetch.mock.callCount(),2)
    assert.equal(f.db.tables.office_agent_outputs.filter((o)=>o.kind==='data_fix').length,1)
    assert.ok(f.db.tables.office_agent_outputs.filter((o)=>o.kind==='report').every((o)=>o.body.model_status==='completato'&&o.body.model_findings.length===0))
    const providers=f.order.map((v,i)=>v==='provider'?i:-1).filter((i)=>i>=0);assert.ok(providers.every((i)=>f.order[i-1]==='reserve'&&f.order[i+1]==='settle'))
  }finally{fetch.mock.restore();if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous}
})
test('qualità: budget finito conserva tutti i controlli gratuiti e segnala campione non completato',async()=>{
  const f=fixture();const run=mapsQualityHandler(f.db,{now:()=>new Date('2026-10-23T08:00:00Z'),bridge:f.bridge,model:async()=>{throw new BudgetExceeded()}})
  await assert.rejects(run(f.ctx),BudgetExceeded)
  assert.equal(f.db.tables.office_agent_outputs.filter((o)=>o.kind==='report').length,2)
  assert.equal(f.db.tables.office_agent_outputs.find((o)=>o.target_id==='marsiglia'&&o.kind==='report')?.body.model_status,'budget_esaurito')
})
