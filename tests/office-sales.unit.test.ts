import assert from 'node:assert/strict'
import { describe, test, mock } from 'node:test'
import { selectSalesCandidates, salesDraftNumbersAllowed, type SalesSignature } from '../src/lib/office/sales-followup'
import { salesFollowupHandler } from '../src/lib/server/office-agents/sales-followup'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'
import type { CRMContact, Quote } from '../src/types'
import { FakeSupabase } from './fake-supabase'
import { MODEL_URL, modelReply } from './model-reply'

const OWNER='owner'
const NOW=new Date('2026-10-22T06:00:00Z')
const contact=(id='c',patch:Partial<CRMContact>={}):CRMContact => ({id,user_id:OWNER,name:'Rosa',email:`${id}@example.it`,company:'Officina',status:'Quote',priority:1,contact_scope:'crm',hidden:false,email_unsubscribed_at:null,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',...patch})
const quote=(id='q',contactId='c',patch:Partial<Quote>={}):Quote => ({id,user_id:OWNER,contact_id:contactId,quote_number:`PRV-2026-${id}`,status:'sent',payment_state:'pending',total_amount:100,sent_at:'2026-10-01T08:00:00Z',...patch} as Quote)
const input=(contacts=[contact()],quotes=[quote()]) => ({contacts,quotes,deals:[],tasks:[],messages:[],signatures:[] as SalesSignature[],pendingContactIds:[] as string[],existingKeys:[] as string[],createdToday:0})

describe('Commerciale: selezione deterministica',() => {
  test('preventivo non firmato, firmato non pagato, rinnovo, follow-up e trattativa ferma',() => {
    assert.equal(selectSalesCandidates(input(),NOW)[0].reason,'unsigned')
    const signed=input();signed.signatures=[{quote_id:'q',signed_at:'2026-10-01T08:00:00Z'}]
    assert.equal(selectSalesCandidates(signed,NOW)[0].reason,'unpaid')
    assert.equal(selectSalesCandidates(input([contact('c',{status:'Paid'})],[quote('q','c',{status:'paid',payment_state:'paid',billing_interval:'year',subscription_status:'active',current_period_end:'2026-11-01T09:00:00Z'})]),NOW)[0].reason,'renewal')
    assert.equal(selectSalesCandidates({...input([contact('c',{next_followup_at:'2026-10-22T18:00:00Z'})],[])},NOW)[0].reason,'followup')
    const stale={...input([contact()],[]),deals:[{id:'d',contact_id:'c',title:'Proposta',stage:'Quote',value:100,created_at:'2026-01-01',updated_at:'2026-10-01T08:00:00Z',closed_at:null}]}
    assert.equal(selectSalesCandidates(stale,NOW)[0].reason,'stale_deal')
  })
  test('esclusi holding, nascosti, disiscritti, email mancante, bozza pendente e risposta nuova',() => {
    for(const patch of [{contact_scope:'holding' as const},{hidden:true},{email_unsubscribed_at:'2026-10-01'},{email:null}]) assert.equal(selectSalesCandidates(input([contact('c',patch)]),NOW).length,0)
    assert.equal(selectSalesCandidates({...input(),pendingContactIds:['c']},NOW).length,0)
    assert.equal(selectSalesCandidates({...input([contact('a',{email:' A@EXAMPLE.IT '}),contact('b',{email:'a@example.it'})],[quote('a','a'),quote('b','b')]),pendingContactIds:['a']},NOW).length,0)
    assert.equal(selectSalesCandidates({...input(),messages:[{contact_id:'c',direction:'outbound',sent_at:'2026-10-01T08:00:00Z'},{contact_id:'c',direction:'inbound',sent_at:'2026-10-02T08:00:00Z'}]},NOW).length,0)
  })
  test('massimo 15 al giorno, valore piu alto prima, una sola bozza per indirizzo',() => {
    const contacts=Array.from({length:25},(_,i)=>contact(`c${i}`))
    const quotes=contacts.map((c,i)=>quote(`q${i}`,c.id,{total_amount:i*100}))
    const result=selectSalesCandidates(input(contacts,quotes),NOW)
    assert.equal(result.length,15);assert.equal(result[0].contact.id,'c24')
    assert.equal(selectSalesCandidates({...input(contacts,quotes),createdToday:14},NOW).length,1)
    assert.equal(selectSalesCandidates({...input(contacts,quotes),createdToday:15},NOW).length,0)
    assert.equal(selectSalesCandidates(input([contact('a',{email:' A@EXAMPLE.IT '}),contact('b',{email:'a@example.it'})],[quote('a','a'),quote('b','b')]),NOW).length,1)
  })
  test('chiavi gia create non si rigenerano e finestre temporali non sono anticipate',() => {
    const selected=selectSalesCandidates(input(),NOW)[0]
    assert.equal(selectSalesCandidates({...input(),existingKeys:[selected.key]},NOW).length,0)
    assert.equal(selectSalesCandidates(input([contact()],[quote('q','c',{sent_at:'2026-10-21T08:00:00Z'})]),NOW).length,0)
    assert.equal(selectSalesCandidates(input([contact('c',{status:'Paid'})],[quote('q','c',{billing_interval:'year',current_period_end:'2026-11-01',cancel_at_period_end:true})]),NOW).length,0)
  })
  test('numeri inventati scartati, prezzi con formati equivalenti riconosciuti',() => {
    assert.equal(salesDraftNumbersAllowed('777 guide','99 EUR e 15 minuti'),false)
    assert.equal(salesDraftNumbersAllowed('99,00 EUR e 15 minuti','99 EUR e 15 minuti'),true)
    assert.equal(salesDraftNumbersAllowed('1.000 euro','1000 euro'),true)
  })
})

function fixture(){
  const db=new FakeSupabase({contacts:[contact()],quotes:[quote()],deals:[],tasks:[],gmail_messages:[],email_drafts:[],quote_signatures:[],office_agent_daily_quotas:[],office_agent_outputs:[],user_settings:[],lead_memories:[],activities:[]})
  db.rpcs.create_office_email_draft=(args)=>{
    const old=db.tables.email_drafts.find((d)=>d.office_key===args.p_key)
    if(old)return{id:old.id,created:false}
    const row={id:db.nextId('draft'),user_id:OWNER,contact_id:args.p_contact_id,office_key:args.p_key,office_agent_id:'sales_followup',office_note:args.p_note,body_text:args.p_text,body_html:args.p_html,subject:args.p_subject,source:'office',status:'pending',created_at:NOW.toISOString()}
    db.tables.email_drafts.push(row);return{id:row.id,created:true}
  }
  const order:string[]=[]
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.sales_followup,user_id:OWNER},runId:'run',async reserve(){order.push('reserve');return'ledger'},async settle(){order.push('settle')},log(){},async addOutput(o){const row={id:db.nextId('output'),agent_id:'sales_followup',user_id:OWNER,output_key:o.key,...o};db.tables.office_agent_outputs.push(row);return row.id}}
  return{db,ctx,order}
}

test('pipeline esistente: budget prima del modello, bozza locale, nota e idempotenza',async()=>{
  const{db,ctx,order}=fixture();const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  const mocked=mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
    order.push('provider');const body=JSON.parse(String(init.body));assert.equal(body.tools,undefined)
    return modelReply(JSON.stringify({subject:'Un aggiornamento',body_text:'Buongiorno Rosa,\nsono Massimo Morgante, fondatore di Speaqi.\nRiprendo il preventivo: possiamo sentirci per un breve aggiornamento?',body_html:'<script>non usare html del modello</script>'}),{input_tokens:1000,output_tokens:200})
  })
  try{
    const run=salesFollowupHandler(db,{now:()=>NOW});await run(ctx);await run(ctx)
    assert.deepEqual(order,['reserve','provider','settle']);assert.equal(mocked.mock.callCount(),1)
    assert.equal(db.tables.email_drafts.length,1);const draft=db.tables.email_drafts[0]
    assert.equal(draft.source,'office');assert.equal(draft.status,'pending');assert.match(draft.office_note,/PRV-2026-q/)
    assert.ok(!draft.body_html.includes('<script>'));assert.match(draft.body_html,/Buongiorno/)
  }finally{mocked.mock.restore();if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old}
})

test('BudgetExceeded non viene ingoiato dalla pipeline; nessun modello e nessuna bozza',async()=>{
  const{db,ctx}=fixture();const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  ctx.reserve=async()=>{throw new BudgetExceeded()}
  const fetch=mock.method(globalThis,'fetch',async()=>{assert.fail('Budget non prenotato')})
  try{await assert.rejects(salesFollowupHandler(db,{now:()=>NOW})(ctx),BudgetExceeded);assert.equal(db.tables.email_drafts.length,0);assert.equal(fetch.mock.callCount(),0)}
  finally{fetch.mock.restore();if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old}
})

test('risposta su una scheda gemella e quota gia consumata bloccano prima di spendere',async()=>{
  const f=fixture();f.db.tables.gmail_messages.push({id:'m',user_id:OWNER,contact_id:'vecchia-scheda',direction:'inbound',from_email:'C@EXAMPLE.IT',sent_at:'2026-10-21T08:00:00Z'})
  await salesFollowupHandler(f.db,{now:()=>NOW})(f.ctx);assert.deepEqual(f.order,[]);assert.equal(f.db.tables.email_drafts.length,0)
  const g=fixture();g.db.tables.office_agent_daily_quotas.push({user_id:OWNER,agent_id:'sales_followup',day:'2026-10-22',used_count:15})
  await salesFollowupHandler(g.db,{now:()=>NOW})(g.ctx);assert.deepEqual(g.order,[])
})
