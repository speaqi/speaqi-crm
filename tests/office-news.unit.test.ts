import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { parseNewsPage,selectNews,validateNewsSummary,newsTelegramText,type NewsArticle } from '../src/lib/office/news'
import { newsWatchHandler } from '../src/lib/server/office-agents/news-watch'
import { deliverOfficeNews } from '../src/lib/server/office-news-delivery'
import { sendNotificationText } from '../src/lib/server/whatsapp'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { FakeSupabase } from './fake-supabase'
import type { AgentContext } from '../src/lib/server/office-agents'
import { MODEL_URL, modelReply } from './model-reply'

const NOW=new Date('2026-10-23T08:00:00Z')
const article=(patch:Partial<NewsArticle>={}):NewsArticle=>({url:'https://news.example.org/turismo',title:'Turismo: nuovi finanziamenti per musei e guide digitali',published_at:'2026-10-22T08:00:00Z',excerpt:'Disponibili 20 progetti per i musei.',feed_url:'https://news.example.org/rss',...patch})
const RSS=`<rss><channel><item><title>Turismo: nuovi finanziamenti per musei e guide digitali</title><link>https://news.example.org/turismo?utm_source=rss</link><pubDate>Thu, 22 Oct 2026 08:00:00 GMT</pubDate><description>Disponibili 20 progetti per i musei.</description></item></channel></rss>`
test('notizie: RSS, Atom e pagina datata, mai data dedotta da updated',()=>{
  const rows=parseNewsPage(RSS,'https://news.example.org/rss');assert.equal(rows.length,1);assert.equal(rows[0].url,article().url)
  assert.equal(parseNewsPage('<feed><entry><title>Gemini turismo</title><link href="https://news.example.org/ai"/><published>2026-10-22T08:00:00Z</published><summary>Novità AI</summary></entry></feed>','https://news.example.org/atom').length,1)
  assert.equal(parseNewsPage('<feed><entry><title>Turismo</title><link href="https://news.example.org/no"/><updated>2026-10-23</updated></entry></feed>','https://news.example.org/atom').length,0)
  assert.equal(parseNewsPage('<html><head><title>Gemini e turismo</title><meta property="article:published_time" content="2026-10-22T08:00:00Z"/></head></html>','https://news.example.org/ai').length,1)
})
test('notizie: finestra 48 ore inclusiva, futuro e data invalida rifiutati',()=>{
  assert.equal(selectNews([article({published_at:'2026-10-21T08:00:00Z'})],[],NOW).length,1)
  for(const published_at of ['2026-10-21T07:59:59Z','2026-10-23T08:00:01Z','non-data']) assert.equal(selectNews([article({published_at})],[],NOW).length,0)
})
test('notizie: link, titolo quasi identico, già visti e temi estranei esclusi',()=>{
  assert.equal(selectNews([article(),article({url:'https://other.example.org/story'})],[],NOW).length,1)
  assert.equal(selectNews([article()],[{url:article().url,title:'Altro titolo'}],NOW).length,0)
  assert.equal(selectNews([article()],[{url:'https://other.example.org/story',title:article().title}],NOW).length,0)
  assert.equal(selectNews([article({title:'Sport: risultato partita',excerpt:'La squadra ha vinto'})],[],NOW).length,0)
  assert.equal(selectNews([article({title:'STQRY presenta il nuovo editor',excerpt:''})],[],NOW).length,1)
  assert.equal(selectNews([article({title:'New release',excerpt:'',url:'https://openai.com/index/release',feed_url:'https://openai.com/news/rss.xml'})],[],NOW).length,1)
  assert.equal(selectNews([article({title:'Sport',excerpt:'',url:'https://openai.com.example.org/story',feed_url:'https://news.example.org/rss'})],[],NOW).length,0)
})
test('notizie: link inventati, numeri estranei e nuove righe scartati; massimo otto',()=>{
  const valid={url:article().url,summary:'Finanziamenti per 20 progetti.',why:'Opportunità per i musei.'}
  assert.equal(validateNewsSummary({news:[valid] },[article()]).length,1)
  for(const bad of [{...valid,url:'https://invented.example.org'}, {...valid,summary:'Sono 999 progetti'}, {...valid,why:'Testo\naltro'}, {...valid,why:'Leggi invented.org'}]) assert.equal(validateNewsSummary({news:[bad]},[article()]).length,0)
  const rows=Array.from({length:10},(_,i)=>article({url:`https://news.example.org/${i}`}))
  assert.equal(validateNewsSummary({news:rows.map((a)=>({...valid,url:a.url}))},rows).length,8)
})
function fixture(){
  const order:string[]=[];const db=new FakeSupabase({office_news_batches:[],office_news_seen:[],office_agent_outputs:[]},{
    claim_office_news_batch(args){order.push('claim');if(db.tables.office_news_batches.length)return{claimed:false};db.tables.office_news_batches.push({id:'batch',user_id:'owner',day:'2026-10-23'});return{claimed:true,id:'batch'}},
    finish_office_news_batch(args){order.push('save');db.tables.office_agent_outputs.push({id:'report',body:args.p_body});return'report'},
  })
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.news_watch,user_id:'owner',settings:{feeds:['https://news.example.org/rss'],telegram:true}},runId:'run',
    async reserve(){order.push('reserve');return'ledger'},async settle(){order.push('settle')},async addOutput(){throw new Error('Solo RPC atomica')},log(){}}
  return{db,ctx,order}
}
test('notizie: tentativo persistente prima della spesa, saldo e report; telegram=true non invia dal job',async()=>{
  const f=fixture();const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(url:unknown)=>{assert.equal(url,MODEL_URL);f.order.push('provider');return modelReply(JSON.stringify({news:[{url:article().url,summary:'Disponibili 20 progetti.',why:'Opportunità per i musei.'}]}),{input_tokens:1000,output_tokens:100})})
  try{
    const run=newsWatchHandler(f.db,{now:()=>NOW,fetchPage:async()=>({status:200,text:RSS,bytes:RSS.length,headers:{}})})
    await run(f.ctx);await run(f.ctx);assert.deepEqual(f.order,['claim','reserve','provider','settle','save']);assert.equal(fetch.mock.callCount(),1)
    assert.equal(f.db.tables.office_agent_outputs[0].body.telegram_available,true)
  }finally{fetch.mock.restore();if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old}
})
test('notizie: timeout non ripaga il modello e non marca articoli come visti',async()=>{
  const f=fixture();let calls=0;const run=newsWatchHandler(f.db,{now:()=>NOW,fetchPage:async()=>({status:200,text:RSS,bytes:RSS.length,headers:{}}),model:async()=>{calls++;throw new Error('Timeout')}})
  await assert.rejects(run(f.ctx),/Timeout/);await run(f.ctx);assert.equal(calls,1);assert.equal(f.db.tables.office_news_seen.length,0);assert.equal(f.db.tables.office_agent_outputs.length,0)
})
test('notizie: invio umano idempotente, esito incerto non ritentato e nessun ripiego su WhatsApp',async()=>{
  let claimed=false;let sends=0
  const db=new FakeSupabase({}, {claim_office_news_delivery:()=>claimed?{claimed:false}:(claimed=true,{claimed:true,id:'delivery',body:{articles:[]}}),record_office_news_delivery:()=>null})
  const send=async()=>{sends++;return{ok:false,error:'Timeout'}}
  await assert.rejects(deliverOfficeNews(db,'owner','report',{channel:()=> 'telegram',send}),/incerto/)
  assert.equal((await deliverOfficeNews(db,'owner','report',{channel:()=> 'telegram',send})).duplicate,true);assert.equal(sends,1)
  await assert.rejects(deliverOfficeNews(db,'owner','report',{channel:()=> 'whatsapp',send}),/Telegram/)
  const env={...process.env};delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_NOTIFY_CHAT_ID
  process.env.OPENWA_BASE_URL='https://gateway.example.org';process.env.OPENWA_API_KEY='finta';process.env.OPENWA_SESSION_ID='finta'
  const fetch=mock.method(globalThis,'fetch',async()=>{throw new Error('Non deve inviare')})
  try{assert.equal((await sendNotificationText('Rassegna',{requiredChannel:'telegram'})).ok,false);assert.equal(fetch.mock.callCount(),0)}finally{fetch.mock.restore();process.env=env}
})
test('notizie: messaggio Telegram limitato senza tagliare un URL e agente spento',()=>{
  const body={articles:Array.from({length:8},()=>({...article({url:'https://news.example.org/'+ 'x'.repeat(1000)}),summary:'Novità turistiche.',why:'Da valutare.'}))}
  assert.ok(newsTelegramText(body).length<=4096);assert.equal(OFFICE_AGENT_DEFINITIONS.news_watch.enabled,false)
})
