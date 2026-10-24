import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { readEventPage, validateEvent, selectEvents, eventDate, eventHorizon, eventSlug, scoreEvent } from '../src/lib/office/events'
import { eventsScoutHandler } from '../src/lib/server/office-agents/events-scout'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { AUTOMATION_JOBS, dueJobs } from '../src/lib/automation-schedule'
import { FakeSupabase } from './fake-supabase'
import type { AgentContext } from '../src/lib/server/office-agents'
import { MODEL_URL, modelReply } from './model-reply'
const NOW=new Date('2026-10-23T08:00:00Z'),SOURCE_URL='https://calendar.example.org/events'
const structured=readFileSync(new URL('./fixtures/office-events-structured.html',import.meta.url),'utf8')
const plain=readFileSync(new URL('./fixtures/office-events-unstructured.html',import.meta.url),'utf8')
const proposed={name:'Workshop B2B destinazioni e hospitality',start_date:'2026-11-18',end_date:'2026-11-19',city:'Barcellona',country_code:'ES',organizer:'Rete Tourism Demo',url:'https://workshops.example.org/barcellona',kind:'b2b_workshop',deadlines:[{kind:'exhibitor_registration',date:'2026-11-05'}]}
test('eventi: due pagine salvate, JSON-LD prima del modello e prove della pagina senza struttura',()=>{
  const page=readEventPage(structured,SOURCE_URL);assert.equal(page.structured,true);assert.equal(page.candidates.length,1)
  const event=validateEvent(page.candidates[0],page,NOW)!;assert.equal(event.name,'Fiera turismo e musei Marsiglia');assert.equal(event.kind,'fair')
  assert.equal(event.deadlines[0].date,'2026-11-10');assert.equal(event.source_url,SOURCE_URL)
  const other=readEventPage(plain,SOURCE_URL);assert.equal(other.structured,false);assert.deepEqual(other.dates,['2026-11-05','2026-11-18','2026-11-19'])
  assert.equal(validateEvent(proposed,other,NOW)?.country_code,'ES')
})
test('eventi: date passate, oltre sei mesi, date inesistenti, link e dati assenti scartati',()=>{
  const page=readEventPage(plain,SOURCE_URL)
  for(const patch of [{start_date:'2026-10-22'},{start_date:'2027-04-24'},{start_date:'2026-02-30'},{end_date:'2026-11-04'},
    {start_date:'2026-11-17'},{url:'https://invented.example.org/event'},{organizer:'Organizzatore inventato'},
    {deadlines:[{kind:'grant',date:'2026-11-06'}]}]){
    const candidate={...proposed,...patch};const proof={...page,dates:[...page.dates,'2026-10-22','2027-04-24','2026-11-04']}
    assert.equal(validateEvent(candidate,proof,NOW),null,JSON.stringify(patch))
  }
  assert.equal(eventDate('20260230'),null);assert.equal(eventHorizon('2026-08-31'),'2027-02-28')
  const event=validateEvent(proposed,page,NOW)!;assert.ok(event);assert.equal(event.end_date,'2026-11-19')
})
test('eventi: slug normalizzato e stessa data deduplicano; ordine per scadenza e punteggio nel codice',()=>{
  const event=validateEvent(proposed,readEventPage(plain,SOURCE_URL),NOW)!
  assert.equal(eventSlug('Fiera   Turìsmo!'),'fiera-turismo');assert.equal(selectEvents([event,{...event}]).length,1)
  assert.notEqual(eventSlug('Turismo '+ 'a'.repeat(180)+' Marsiglia'),eventSlug('Turismo '+ 'a'.repeat(180)+' Barcellona'))
  assert.equal(selectEvents([event],[{slug:event.slug,start_date:event.start_date}]).length,0)
  assert.equal(selectEvents([event,{...event,start_date:'2026-12-18'}]).length,2)
  assert.equal(scoreEvent({name:'Turismo',organizer:null,kind:'fair'}),40)
  assert.equal(scoreEvent({name:'Sport',organizer:null,kind:'fair'}),0)
  assert.equal(scoreEvent({name:'Expo Europa',organizer:null,kind:'fair'},'Calendario turismo'),40)
  assert.equal(validateEvent({...proposed,score:1000000},readEventPage(plain,SOURCE_URL),NOW)?.score,event.score)
  assert.equal(selectEvents([{...event,slug:'later',deadlines:[]},event])[0].slug,event.slug)
})
test('eventi: iCal e RSS espliciti, mai pubDate come data evento, DTEND non inventa il giorno precedente',()=>{
  const calendar='BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Fiera turismo\r\nDTSTART;VALUE=DATE:20261204\r\nDTEND;VALUE=DATE:20261206\r\nURL:https://events.example.org/fair\r\nEND:VEVENT\r\nEND:VCALENDAR'
  const page=readEventPage(calendar,SOURCE_URL);assert.equal(validateEvent(page.candidates[0],page,NOW)?.end_date,'2026-12-06')
  const rss=readEventPage('<rss><channel><item><title>Fiera turismo</title><link>https://events.example.org/fair</link><startDate>2026-12-04</startDate><pubDate>2026-11-10</pubDate></item></channel></rss>',SOURCE_URL)
  assert.equal(validateEvent(rss.candidates[0],rss,NOW)?.start_date,'2026-12-04')
  const news=readEventPage('<rss><channel><item><title>Fiera turismo</title><link>https://events.example.org/fair</link><pubDate>2026-11-10</pubDate></item></channel></rss>',SOURCE_URL)
  assert.equal(validateEvent(news.candidates[0],news,NOW),null)
})
function fixture(){
  const order:string[]=[]
  const db=new FakeSupabase({office_event_batches:[]},{claim_office_event_batch(args){order.push('claim');assert.ok(args.p_pages[0].links.includes(proposed.url))
    if(db.tables.office_event_batches.length)return{claimed:false};db.tables.office_event_batches.push({id:'b',user_id:'owner',day:'2026-10-23'});return{claimed:true,id:'b'}},
    finish_office_event_batch(args){order.push('finish');db.tables.events=args.p_events;db.tables.report=[args.p_report];return{created:args.p_events.length,tasks:1}}})
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.events_scout,user_id:'owner',settings:{sources:[SOURCE_URL],queries:['fiera turismo']}},runId:'run',async reserve(){order.push('reserve');return'l'},async settle(){order.push('settle')},async addOutput(){throw new Error('Solo RPC atomica')},log(){}}
  return{db,ctx,order}
}
test('eventi: prenotazione prima della spesa, schema strict, query non eseguite e nessun secondo costo giornaliero',async()=>{
  const f=fixture();const previous=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
    assert.equal(url,MODEL_URL);f.order.push('provider');const body=JSON.parse(String(init?.body));assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.response_format.json_schema.name,'office_events');assert.equal(body.tools,undefined)
    return modelReply(JSON.stringify({events:[proposed]}),{input_tokens:1000,output_tokens:100})
  })
  try{const handler=eventsScoutHandler(f.db,{now:()=>NOW,fetchPage:async()=>({status:200,text:plain,bytes:plain.length,headers:{}})})
    await handler(f.ctx);await handler(f.ctx);assert.deepEqual(f.order,['claim','reserve','provider','settle','finish']);assert.equal(fetch.mock.callCount(),1)
    assert.equal(f.db.tables.report[0].queries_executed,false);assert.ok(f.db.tables.report[0].warnings[0].includes('settings.sources'));assert.equal(f.db.tables.events.length,1)
  }finally{fetch.mock.restore();if(previous===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous}
})
test('eventi: timeout resta prenotato; nessuna seconda chiamata al modello, nessuna attività automatica',async()=>{
  const f=fixture();let calls=0;const handler=eventsScoutHandler(f.db,{now:()=>NOW,fetchPage:async()=>({status:200,text:plain,bytes:plain.length,headers:{}}),model:async()=>{calls++;throw new Error('Timeout')}})
  await handler(f.ctx);await handler(f.ctx);assert.equal(calls,1);assert.equal(f.db.tables.tasks?.length||0,0);assert.equal(f.db.tables.events.length,0)
  assert.ok(f.db.tables.report[0].warnings.some((w:string)=>w.includes('Timeout')))
})
test('eventi: fonti strutturate non chiamano il modello e configurazione privata o eccessiva è rifiutata',async()=>{
  const f=fixture();f.db.rpcs.claim_office_event_batch=()=>({claimed:true,id:'b'})
  await eventsScoutHandler(f.db,{now:()=>NOW,fetchPage:async()=>({status:200,text:structured,bytes:structured.length,headers:{}}),model:async()=>{throw new Error('Non deve chiamare il modello')}})(f.ctx)
  assert.equal(f.db.tables.events.length,1)
  for(const sources of [['http://127.0.0.1'],Array(31).fill(SOURCE_URL)]){f.ctx.agent={...f.ctx.agent,settings:{sources}};await assert.rejects(eventsScoutHandler(f.db)(f.ctx),/pubblica|pubblici/)}
})
test('eventi: job spento, budget e giorni alterni a 06:30 Roma attraverso mese e ora legale',()=>{
  const definition=OFFICE_AGENT_DEFINITIONS.events_scout;assert.equal(definition.enabled,false)
  assert.deepEqual([definition.daily_budget_cents,definition.weekly_budget_cents,definition.monthly_budget_cents],[100,350,1500])
  const job=AUTOMATION_JOBS.find((job)=>job.name==='office-events-scout')!;assert.equal(job.everyDays,2)
  const states=Array.from({length:15},(_,i)=>{const day=new Date(Date.UTC(2026,9,22+i));const localDay=day.toISOString().slice(0,10)
    const hour=localDay<'2026-10-25'?'04':'05' // 06:30 Roma, prima e dopo il cambio dell'ora.
    return dueJobs(new Date(`${localDay}T${hour}:30:00Z`),'UTC',[job]).length})
  for(let i=1;i<states.length;i++)assert.notEqual(states[i],states[i-1])
  assert.equal(dueJobs(new Date('2026-10-24T05:30:00Z'),'UTC',[job]).length,0)
})
test('eventi: il Direttore e il merge del 05 restano identici nella funzione di decisione',()=>{
  const read=(file:string)=>readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')
  const extract=(source:string)=>source.slice(source.indexOf('create or replace function public.decide_office_output(')).split('\n$$;')[0]
  const current=extract(read('20261023090000_office_db_cleaner.sql'))
  const added=extract(read('20261023120100_office_events.sql')).replace(/  -- BEGIN EVENTS_SCOUT[\s\S]*?  -- END EVENTS_SCOUT\n/,'')
    .replace('\n  event_row public.office_events; event_deadline date; todo_id uuid;','')
  assert.equal(added,extract(read('20261023120000_office_entity_enricher.sql')))
  const original=added.replace(/  if o.agent_id='entity_enricher'[\s\S]*?\n  end if;\n(?=  update public.office_agent_outputs set status=p_status)/,'')
  assert.equal(original,current)
})
