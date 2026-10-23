import { test } from 'node:test'
import assert from 'node:assert/strict'
import { officeMapQueue, officeMapSlot } from '../src/lib/office/maps'
import { myMapsHandler } from '../src/lib/server/office-agents/mymaps'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import type { AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

test('My Maps: coda del titolare e del Direttore, Napoli esclusa e turno di due giorni oltre fine mese',()=>{
  assert.equal(officeMapQueue([{key:'build',city:'Marsiglia',map_slug:null}])[0].slug,'marsiglia')
  assert.throws(()=>officeMapQueue([{slug:'napolimap',city:'Altra'}]),/Napoli/)
  assert.throws(()=>officeMapQueue([{slug:'mappa',city:'Naples'}]),/Napoli/)
  const slots=Array.from({length:5},(_,i)=>officeMapSlot(new Date(Date.UTC(2026,9,30+i,8))))
  assert.ok(slots.every((s,i)=>i===0||s-slots[i-1]<=1))
  assert.equal(OFFICE_AGENT_DEFINITIONS.mymaps_builder.enabled,false)
})
test('My Maps: zero riservato prima del bridge, riepilogo dai conteggi e nessun duplicato nel turno',async()=>{
  const db=new FakeSupabase({office_agent_outputs:[]});const order:string[]=[]
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.mymaps_builder,user_id:'owner',settings:{queue:[{slug:'marsiglia',city:'Marsiglia',source:'1PublicMyMaps0000'}]}},runId:'run',
    async reserve(cents){assert.equal(cents,0);order.push('reserve');return'ledger'},async settle(_id,cents){assert.equal(cents,0);order.push('settle')},log(){},async addOutput(o){db.tables.office_agent_outputs.push({id:'out',user_id:'owner',agent_id:'mymaps_builder',output_key:o.key,...o});return'out'}}
  const run=myMapsHandler(db,{now:()=>new Date('2026-10-23T01:00:00Z'),bridge:async(path,body:any)=>{order.push('bridge');assert.equal(path,'/api/office/mymaps/run');assert.match(body.request_id,/^[a-f0-9-]{36}$/);return {slug:'marsiglia',requested_slug:'marsiglia',city:'Marsiglia',read:10,created:8,existing:1,duplicates:1,skipped:0,remaining:0,ready:false,cost_cents:0}}})
  assert.match((await run(ctx))!.summary,/8 nuovi/);await run(ctx)
  assert.deepEqual(order,['reserve','bridge','settle']);assert.equal(db.tables.office_agent_outputs.length,1)
})
