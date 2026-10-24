import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_director_orders_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const sql = (s: string) => query(s, DB)
const scalar = (s: string) => value(s, DB)
const expectError = (s: string) => failure(s, DB)
/** Ultima riga: i SET prima della query stampano la loro conferma. */
const last = async (s: string) => (await sql(s)).at(-1)?.[0] ?? null
const json = async (s: string) => JSON.parse((await scalar(s))!)
const queue = (agent: string, entry: Record<string, unknown>, owner = OWNER) =>
  json(`select public.office_director_queue('${owner}','${agent}','${JSON.stringify(entry).replace(/'/g, "''")}'::jsonb)`)
let outputId: string

before(async () => {
  await resetOfficeDatabase(DB, ['20261024090000_office_director_orders.sql', '20261024140000_office_queue_update.sql'])
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})
beforeEach(async () => {
  await sql(`truncate office_agents, contacts cascade;
    insert into office_agents(id,user_id,name,department,settings) values
      ('director','${OWNER}','Direttore','direzione','{}'),
      ('mymaps_builder','${OWNER}','Mappe','mappe','{"queue":[],"run_budget_cents":300}'),
      ('maps_quality','${OWNER}','Qualità','mappe','{}'),
      ('presentations','${OWNER}','Presentazioni','commerciale','{"queue":[]}'),
      ('finance','${OWNER}','Finanza','finanza','{}');`)
  outputId = (await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body)
    values('director','${OWNER}','order:1:contact','proposal','Nuovo contatto: Marie',
    '{"action":"create_contact","contact":{"name":"Marie Dupont"},"category":"destinazione"}') returning id`))!
})

test('coda: elenco chiuso, Napoli fuori, nessun doppione, impostazioni intatte', async () => {
  assert.match(String(await expectError(`select public.office_director_queue('${OWNER}','finance','{"key":"x"}')`)), /Destinatario non ammesso/)
  assert.match(String(await expectError(`select public.office_director_queue('${OWNER}','mymaps_builder','{"key":"build_map:napoli","slug":"napoli","city":"Napoli"}')`)), /Napoli/)
  assert.match(String(await expectError(`select public.office_director_queue('${OWNER}','maps_quality','{"slug":"x"}')`)), /senza chiave/)
  assert.equal((await queue('agency', { key: 'agency:contact:1' })).reason, 'agent_missing')
  const results = await Promise.all(Array.from({ length: 8 }, () => queue('mymaps_builder', { key: 'build_map:marsiglia', slug: 'marsiglia', city: 'Marsiglia' })))
  assert.equal(results.filter((r) => r.queued).length, 1)
  assert.equal(results.every((r) => r.enabled === false), true)
  assert.equal(await scalar(`select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'`), '1')
  assert.equal(await scalar(`select settings->>'run_budget_cents' from office_agents where id='mymaps_builder'`), '300')
  assert.equal(await scalar(`select settings->'queue'->0->>'origin' from office_agents where id='mymaps_builder'`), 'director_order')
  // Un altro workspace non vede l'agente: niente coda.
  assert.equal((await queue('mymaps_builder', { key: 'build_map:lione', slug: 'lione', city: 'Lione' }, OTHER)).reason, 'agent_missing')
  assert.equal(await scalar('select count(*) from office_agents where enabled'), '0')
  assert.equal(await scalar('select count(*) from office_agent_runs'), '0')
})

test('coda: lo stesso lavoro con un dato nuovo aggiorna la voce, senza cancellare quello che c’era', async () => {
  assert.equal((await queue('mymaps_builder', { key: 'build_map:marsiglia', slug: 'marsiglia', city: 'Marsiglia' })).queued, true)
  const link = 'https://www.google.com/maps/d/viewer?mid=abc'
  const updated = await queue('mymaps_builder', { key: 'build_map:marsiglia', slug: 'marsiglia', city: 'Marsiglia', source: link })
  assert.equal(updated.reason, 'updated')
  assert.deepEqual(updated.fields, ['source'])
  assert.equal(await scalar(`select settings->'queue'->0->>'source' from office_agents where id='mymaps_builder'`), link)
  assert.equal(await scalar(`select settings->'queue'->0->>'revisions' from office_agents where id='mymaps_builder'`), '1')
  // Un ordine senza link non cancella il link di prima.
  assert.equal((await queue('mymaps_builder', { key: 'build_map:marsiglia', slug: 'marsiglia', city: 'Marsiglia', source: null })).reason, 'already_queued')
  assert.equal(await scalar(`select settings->'queue'->0->>'source' from office_agents where id='mymaps_builder'`), link)
  assert.equal(await scalar(`select jsonb_array_length(settings->'queue') from office_agents where id='mymaps_builder'`), '1')
})

test('contatto: otto clic insieme, uno solo lavora; poi la proposta risulta approvata una volta', async () => {
  const claims = await Promise.all(Array.from({ length: 8 }, () => json(`select public.office_director_contact_claim('${outputId}','${OWNER}')`)))
  assert.equal(claims.filter((c) => c.state === 'go').length, 1)
  assert.equal(claims.filter((c) => c.state === 'busy').length, 7)
  const contact = (await scalar(`insert into contacts(user_id,name,status,legacy_id) values('${OWNER}','Marie Dupont','New','office-director:${outputId}') returning id`))!
  // Lo stesso legacy_id non nasce due volte: il secondo tentativo ritrova il primo.
  assert.match(String(await expectError(`insert into contacts(user_id,name,status,legacy_id) values('${OWNER}','Marie','New','office-director:${outputId}')`)), /duplicate key|unique/)
  const done = await json(`select public.office_director_contact_done('${outputId}','${OWNER}','${contact}','{"notes":["ok"]}')`)
  assert.equal(done.output.status, 'approved')
  assert.equal(done.output.body.contact_id, contact)
  assert.equal(done.output.body.claimed_at, undefined)
  assert.equal((await json(`select public.office_director_contact_done('${outputId}','${OWNER}','${contact}','{}')`)).reason, 'already_decided')
  assert.equal((await json(`select public.office_director_contact_claim('${outputId}','${OWNER}')`)).state, 'already_decided')
})

test('contatto: altro workspace, contatto altrui e proposte diverse non passano', async () => {
  assert.equal((await json(`select public.office_director_contact_claim('${outputId}','${OTHER}')`)).state, 'not_found')
  const foreign = (await scalar(`insert into contacts(user_id,name,status) values('${OTHER}','Altro','New') returning id`))!
  assert.match(String(await expectError(`select public.office_director_contact_done('${outputId}','${OWNER}','${foreign}','{}')`)), /non del workspace/)
  const map = (await scalar(`insert into office_agent_outputs(agent_id,user_id,output_key,kind,title,body)
    values('director','${OWNER}','altra','proposal','Costruire Marsiglia','{"action":"build_map"}') returning id`))!
  assert.equal((await json(`select public.office_director_contact_claim('${map}','${OWNER}')`)).state, 'not_found')
  // Approvare la proposta di contatto dalla decisione generica non crea niente: si rifiuta.
  assert.match(String(await expectError(`select public.decide_office_output('${outputId}','${OWNER}','approved')`)), /Proposta del Direttore non valida/)
  assert.equal((await json(`select public.decide_office_output('${outputId}','${OWNER}','rejected')`)).output.status, 'rejected')
})

test('ordini: solo il proprietario li legge, nessuno li scrive dal browser', async () => {
  await sql(`insert into office_director_orders(user_id,text) values('${OWNER}','Come va?')`)
  assert.match(String(await expectError(`insert into office_director_orders(user_id,status) values('${OWNER}','inventato')`)), /check/)
  assert.equal(await last(`set role authenticated; set request.jwt.claim.sub='${OWNER}'; select count(*) from office_director_orders`), '1')
  assert.equal(await last(`set role authenticated; set request.jwt.claim.sub='${OTHER}'; select count(*) from office_director_orders`), '0')
  assert.match(String(await expectError(`set role authenticated; set request.jwt.claim.sub='${OWNER}'; insert into office_director_orders(user_id,text) values('${OWNER}','x')`)), /permission denied/)
  assert.match(String(await expectError(`set role authenticated; select public.office_director_queue('${OWNER}','presentations','{"key":"x"}')`)), /permission denied/)
})
