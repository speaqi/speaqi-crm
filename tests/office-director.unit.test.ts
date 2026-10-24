import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { directorPriorities, directorReportLines, directorSuppressed, officeIsNaples, type DirectorDestination } from '../src/lib/office/director'
import { directorHandler, loadDirectorCoverage } from '../src/lib/server/office-agents/director'
import type { MapsStatus } from '../src/lib/server/maps-status'
import type { MapStatusRow } from '../src/lib/command-center'
import type { AgentContext } from '../src/lib/server/office-agents'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { FakeSupabase } from './fake-supabase'
import { MODEL_URL, modelReply } from './model-reply'

const NOW = new Date('2026-10-22T06:00:00Z')
const map = (name: string, patch: Partial<MapStatusRow> = {}): MapStatusRow => ({key:name,name,stage:'pronta',places:20,ready_places:20,speaqi_slug:null,studiomap_slug:name.toLowerCase(),price_cents:null,...patch})
const destination = (name: string, patch: Partial<DirectorDestination> = {}): DirectorDestination => ({id:name,name,guide_status:'planned',guide_priority:1,volume:1000,year:2025,source:'https://ente.example.it/statistiche',table:'tourism_destinations',...patch})
const data = {destinations:[destination('Marsiglia'),destination('Barcellona',{volume:2000})],maps:[map('Bari'),map('Capri',{key:'capri',stage:'online',speaqi_slug:'capri'})],coverage:[{map_id:'capri',done:8,total:10,source:'https://api.example.it/coverage'}],catalogKnown:true,speaqiKnown:true}

test('Direttore: priorità misurate prima, poi mappe pronte, poi lingue sotto il 90%', () => {
  const result = directorPriorities(data)
  assert.deepEqual(result.map((p) => p.city),['Barcellona','Marsiglia','Bari','Capri'])
  assert.deepEqual(result.map((p) => p.recipient),['mymaps_builder','mymaps_builder','maps_quality','languages_voice'])
  assert.equal(result[0].facts.source,data.destinations[1].source)
  assert.equal(directorPriorities({...data,coverage:[{...data.coverage[0],done:9}]}).some((p) => p.action==='complete_languages'),false)
})

test('Direttore: niente priorità inventate da dati stimati, senza fonti o cataloghi indisponibili', () => {
  for (const patch of [{estimated:true},{source:null},{year:null},{volume:0},{guide_priority:2}]) {
    assert.equal(directorPriorities({...data,destinations:[destination('Marsiglia',patch)],maps:[],coverage:[]}).length,0)
  }
  assert.equal(directorPriorities({...data,catalogKnown:false}).filter((p) => p.action!=='complete_languages').length,0)
  assert.equal(directorPriorities({...data,speaqiKnown:false}).length,0)
  assert.equal(directorPriorities({...data,maps:[map('Marsiglia',{stage:'in_lavorazione'})],coverage:[],destinations:[destination('Marsiglia')]}).length,0)
})

test('Direttore: Napoli, Naples e napolimap esclusi da tutte le proposte', () => {
  assert.equal(officeIsNaples('Naples'),true); assert.equal(officeIsNaples('napolimap'),true); assert.equal(officeIsNaples('%6eapoli'),true)
  const result = directorPriorities({...data,destinations:[destination('Napoli'),destination('Naples')],maps:[map('Napoli'),map('Nascosta',{stage:'online',speaqi_slug:'napolimap'})]})
  assert.deepEqual(result,[])
})

test('Direttore: numeri inventati vengono riscritti senza numeri e il rifiuto dura quattro settimane', () => {
  const priority = directorPriorities(data)[0]
  assert.ok(directorReportLines(priority,['999999 luoghi','Una priorità','Da fare']).every((line) => !/\d/.test(line)))
  assert.deepEqual(directorReportLines(priority,['Dati verificati','Da sottoporre al titolare','Nessuna pubblicazione automatica']),['Dati verificati','Da sottoporre al titolare','Nessuna pubblicazione automatica'])
  const suppressed = directorSuppressed([{body:{action_key:priority.key},decided_at:'2026-10-01T08:00:00Z'},{body:{action_key:'scaduta'},decided_at:'2026-09-01T08:00:00Z'}],NOW)
  assert.deepEqual(suppressed,[priority.key]); assert.ok(!directorPriorities({...data,suppressed}).some((p) => p.key===priority.key))
})

test('Direttore: copertura da GET autenticato, nessuna lettura per Napoli, dati mancanti dichiarati', async () => {
  const old = process.env.SPEAQI_API_KEY; process.env.SPEAQI_API_KEY='chiave-finta'
  const maps: MapsStatus={rows:[map('Marsiglia',{key:'33333333-3333-4333-8333-333333333333',stage:'online'}),map('Napoli',{key:'44444444-4444-4444-8444-444444444444',stage:'online'})],sources:{speaqi:'ok',studiomap:'ok'},fetched_at:NOW.toISOString()}
  const fetch = mock.method(globalThis,'fetch',async (url: unknown,init?: RequestInit) => {
    assert.ok(String(url).endsWith('/studiomap/translations')); assert.equal(init?.method,undefined)
    assert.deepEqual(init?.headers,{'x-api-key':'chiave-finta'})
    return Response.json({summary:{text:{done:8,missing:2,failed:0,outdated:0,stuck:0,processing:0}}})
  })
  try {
    const result=await loadDirectorCoverage(maps); assert.equal(result.rows[0].total,10); assert.equal(fetch.mock.callCount(),1)
    delete process.env.SPEAQI_API_KEY
    const absent=await loadDirectorCoverage(maps); assert.equal(absent.rows.length,0);assert.ok(absent.warnings[0].includes('non verificata'))
  } finally {fetch.mock.restore();if(old===undefined)delete process.env.SPEAQI_API_KEY;else process.env.SPEAQI_API_KEY=old}
})

test('Direttore: pipeline legge fonti vere simulate, riserva prima del modello e non raddoppia la settimana', async () => {
  const db=new FakeSupabase({tourism_destinations:[{entity_id:'dest',user_id:'owner',guide_status:'planned',guide_priority:1,intl_arrivals:1000,arrivals_year:2025,arrivals_source:'https://ente.example.it/dati',arrivals_estimated:false}],
    tourism_entities:[{id:'dest',user_id:'owner',name:'Marsiglia',aliases:[]}],tourism_hubs:[],quotes:[],invoices:[],
    // Le mappe diventano proposte solo se servono a un'opportunità aperta: qui la proposta per Marsiglia.
    deals:[{id:'deal-1',user_id:'owner',contact_id:'c1',title:'Tourism · Marsiglia',pipeline:'tourism',stage:'proposta',map_ref:'Marsiglia',closed_at:null,created_at:NOW.toISOString(),updated_at:NOW.toISOString()}],
    contacts:[{id:'c1',user_id:'owner',name:'Visit Marseille',email:'info@example.fr'}],office_agent_runs:[],office_agent_outputs:[]})
  const order:string[]=[]
  const ctx:AgentContext={agent:{...OFFICE_AGENT_DEFINITIONS.director,user_id:'owner'},runId:'run',async reserve(){order.push('reserve');return'ledger'},async settle(){order.push('settle')},log(){},
    async addOutput(output){const row={id:db.nextId('output'),user_id:'owner',agent_id:'director',output_key:output.key,...output};db.tables.office_agent_outputs.push(row);return row.id}}
  const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='finta'
  const fetch=mock.method(globalThis,'fetch',async(url:unknown)=>{assert.equal(url,MODEL_URL);order.push('provider');return modelReply('{"points":[null,{"key":"build_map:marsiglia","lines":["999999 luoghi","Fatto","Subito"]}]}',{input_tokens:1000,output_tokens:100})})
  try {
    const run=directorHandler(db,{now:()=>NOW,maps:async()=>({rows:[],sources:{studiomap:'ok',speaqi:'ok'},fetched_at:NOW.toISOString()}),coverage:async()=>({rows:[],warnings:[]})})
    await run(ctx);await run(ctx)
    assert.deepEqual(order,['reserve','provider','settle'])
    // Piano del giorno + proposta + report della settimana, una volta sola anche con due corse.
    assert.equal(db.tables.office_agent_outputs.length,3)
    const planReport=db.tables.office_agent_outputs.find((o)=>o.output_key==='director:plan:2026-10-22')!
    assert.match(planReport.body.testo,/Visit Marseille/)
    const proposal=db.tables.office_agent_outputs.find((o)=>o.kind==='proposal')!
    assert.equal(proposal.target_id,'dest');assert.equal(proposal.body.recipient_agent_id,'mymaps_builder');assert.ok(!proposal.body.lines.join(' ').includes('999999'))
    assert.equal(db.tables.office_agents,undefined)
  } finally {fetch.mock.restore();if(old===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=old}
})
