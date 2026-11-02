import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogModels, newCatalogModels, catalogChanges, modelReportText } from '../src/lib/office/model-watch'

const now = new Date('2026-11-02T08:00:00Z')
const created = now.getTime() / 1000 - 3600
const models = catalogModels({data:[
  {id:'maker/new',name:'Nuovo',description:'Descrizione ufficiale',created,context_length:64000,pricing:{prompt:'0.0000005',completion:'0.000002'},architecture:{input_modalities:['text']}},
  {id:'bad id',created},
  {id:'maker/old',created:created-9*86400},
  {id:'~maker/old-latest',created:created-9*86400},
  {id:'maker/future',created:created+86400},
]})
test('catalogo: valida id e normalizza il prezzo per milione', () => {
  assert.equal(models.length, 4)
  assert.equal(models[0].description, 'Descrizione ufficiale')
  assert.equal(models[0].input, 0.5)
  assert.equal(models[0].output, 2)
  assert.throws(() => catalogModels({data:{}}))
})
test('novità recenti: esclude visti, vecchi e date future', () => {
  assert.deepEqual(newCatalogModels(models,new Set(),now).map(m => m.id), ['maker/new'])
  assert.deepEqual(newCatalogModels(models,new Set(['maker/new']),now), [])
})
test('report: usa solo id verificati nel catalogo e presenta i limiti', () => {
  const text = modelReportText('2026-11-02', models, [{id:'maker/new',reason:'Da provare'}, {id:'invented/id',reason:'Errore'}], ['gpt-5-mini'])
  assert.match(text, /\$0.50 input/)
  assert.match(text, /https:\/\/openrouter.ai\/maker\/new/)
  assert.doesNotMatch(text, /invented\/id/)
  assert.match(text, /Nessun modello viene sostituito automaticamente/)
})

test('confronto del catalogo rileva anche modelli aggiunti con data più vecchia', () => {
  assert.deepEqual(catalogChanges(models, ['maker/new', 'maker/future'], now).map(m => m.id), ['~maker/old-latest', 'maker/old'])
  assert.throws(() => catalogChanges(models.slice(0, 1), ['a','b','c','d'], now), /incompleto/)
})

test('report giornaliero inviato una sola volta e documentato', async () => {
  const { modelWatchHandler } = await import('../src/lib/server/office-agents/model-watch')
  const rows: any[] = []
  const deliveries: any[] = []
  const admin: any = { from(table: string) {
    if (table === 'office_agent_outputs') {
      let key = ''
      const q: any = { select: () => q, eq: (column: string, value: string) => { if (column === 'output_key') key = value; return q },
        neq: () => q, order: () => q, limit: async () => ({data: key ? rows.filter(r => r.key === key) : rows.filter(r => r.key !== 'catalog:current'), error: null}),
        update: (value:any) => { const target = rows.find(r => r.key === 'catalog:current'); if (target) Object.assign(target, value); q.eq = () => q; q.then = (resolve:any) => resolve({error:null}); return q } }
      return q
    }
    if (table === 'office_agents') { const q: any = { select: () => q, eq: async () => ({ data: [{ id:'director', name:'Direttore', model:'gpt-5-mini', enabled:true }], error:null }) }; return q }
    if (table === 'office_news_deliveries') return {
      insert(value: any) { return { select: () => ({ single: async () => {
        if (deliveries.length) return { error: {code:'23505'} }
        deliveries.push({...value, id:'delivery'}); return {data:{id:'delivery'},error:null}
      } }) } },
      update(value: any) { Object.assign(deliveries[0], value); const q:any = {eq: () => q, then: (resolve: any) => resolve({error:null})}; return q }
    }
    throw new Error(table)
  } }
  let sends = 0
  const ctx: any = { agent: { id:'model_watch',user_id:'owner',model:'gpt-5-mini' }, runId:'run',
    addOutput: async (v:any) => {const id = v.key === 'catalog:current' ? 'inventory' : 'output'; rows.push({id,key:v.key,body:v.body});return id} }
  const handler = modelWatchHandler(admin, { now: () => now, channel: () => 'telegram',
    fetch: async () => new Response(JSON.stringify({data:[{id:'maker/new',description:'Descrizione ufficiale completa',created,pricing:{prompt:'0.000001',completion:'0.000002'}}]})),
    model: async () => ({text:JSON.stringify({recommendations:[{id:'maker/new',reason:'Da provare'}]}),costCents:1,tokensIn:1,tokensOut:1,citations:[]}),
    send: async () => { sends++; return {ok:true,providerMessageId:'123'} },
  })
  await handler(ctx)
  assert.equal(rows.length, 2)
  assert.equal(rows.find(r => r.id === 'inventory').body.models[0].id, 'maker/new')
  assert.equal(rows.find(r => r.id === 'inventory').body.models[0].description, 'Descrizione ufficiale completa')
  assert.equal(deliveries[0].status, 'sent')
  await handler(ctx)
  assert.equal(sends, 1)
})
