import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Enti per destinazione: la gerarchia PART_OF si scende, i legami sono quelli
// verificati, le funzioni valgono la RLS del proprietario.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite
const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)
const migration = async (name: string) =>
  db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
async function scalar<T = string>(query: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(query, params)).rows[0]?.v
}

let n = 0
async function entity(user: string, kind: 'place' | 'organization', name: string, type?: string, extra = '') {
  await db.exec(`reset role`)
  const id = await scalar(
    `insert into tourism_entities(user_id,kind,name,country_code,type_code,status${extra ? ',' + extra.split('=')[0] : ''})
     values($1,$2,$3,'IT',$4,'UNVERIFIED'${extra ? ',' + extra.split('=')[1] : ''}) returning id as v`,
    [user, kind, name, type ?? null],
  )
  return id as string
}
async function link(user: string, from: string, to: string, relation: string) {
  await db.exec('reset role')
  const evidence = await scalar(
    `insert into tourism_evidence(user_id,entity_id,source_url,title,fields,method,status)
     values($1,$2,'https://example.com/'||$3,'Prova '||$3,array['coverage','name'],'manual','UNVERIFIED') returning id as v`,
    [user, from, String(++n)],
  )
  await db.query(
    `insert into tourism_relations(user_id,from_id,to_id,relation,evidence_id) values($1,$2,$3,$4,$5)`,
    [user, from, to, relation, evidence],
  )
}

let roma: string, capri: string, costiera: string, positano: string, campania: string
let dmcRoma: string, toRoma: string, pmCapri: string, pmPositano: string, dmcAltrui: string

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users(id) values('${OWNER}'),('${OTHER}');
    create table contacts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text not null,company text,country text,email text,phone text,status text,source text,contact_scope text,marketing_eligibility text,legacy_id text,note text);
    create table activities(id uuid primary key default gen_random_uuid(),user_id uuid not null,contact_id uuid references contacts(id),type text,content text);
    grant select,insert,update,delete on contacts,activities to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant all on functions to anon,authenticated;
  `)
  for (const name of [
    '20260926090000_shipping_companies.sql',
    '20260927090000_shipping_itineraries.sql',
    '20260928090000_shipping_ports_world.sql',
    '20260928120000_shipping_ports_guide_priority.sql',
    '20261017205455_tourism_intelligence.sql',
    '20261018185155_tourism_site_research.sql',
    '20261018185533_tourism_research_indexes.sql',
    '20261019051155_tourism_sitemap_targeting.sql',
    '20261019085842_tourism_outreach_priority.sql',
    '20261020090000_tourism_hubs.sql',
    '20261020090100_tourism_hubs_absorb_ports.sql',
    '20261020120000_tourism_property_managers.sql',
    '20261029100000_tourism_destination_scope.sql',
  ])
    await migration(name)

  roma = await entity(OWNER, 'place', 'Roma')
  capri = await entity(OWNER, 'place', 'Capri')
  costiera = await entity(OWNER, 'place', 'Costiera Amalfitana')
  positano = await entity(OWNER, 'place', 'Positano')
  campania = await entity(OWNER, 'place', 'Campania')
  await link(OWNER, capri, campania, 'PART_OF')
  await link(OWNER, costiera, campania, 'PART_OF')
  await link(OWNER, positano, costiera, 'PART_OF')

  dmcRoma = await entity(OWNER, 'organization', 'Roma Incoming DMC', 'dmc')
  toRoma = await entity(OWNER, 'organization', 'Roma Tour Operator', 'tour_operator')
  pmCapri = await entity(OWNER, 'organization', 'Capri Stays', 'property_manager')
  pmPositano = await entity(OWNER, 'organization', 'Positano Homes', 'property_manager')
  await link(OWNER, dmcRoma, roma, 'COVERS')
  await link(OWNER, toRoma, roma, 'SELLS')
  await link(OWNER, pmCapri, capri, 'MANAGES')
  await link(OWNER, pmPositano, positano, 'MANAGES')

  const altruiPlace = await entity(OTHER, 'place', 'Roma')
  dmcAltrui = await entity(OTHER, 'organization', 'Altrui DMC', 'dmc')
  await link(OTHER, dmcAltrui, altruiPlace, 'COVERS')
})

const list = async (place: string, children: boolean, types: string[] | null = null) =>
  scalar<{ total: number; items: { id: string; places: string[]; relations: string[] }[] }>(
    `select tourism_destination_entities($1,$2,$3) as v`,
    [place, children, types],
  )

test('il perimetro scende per la gerarchia e dipende da includi sotto-aree', async () => {
  await asUser(OWNER)
  assert.equal((await scalar<string[]>('select tourism_place_scope($1,true) as v', [campania]))!.length, 4)
  assert.equal((await scalar<string[]>('select tourism_place_scope($1,false) as v', [campania]))!.length, 1)
  assert.deepEqual(await scalar<string[]>('select tourism_place_scope($1,true) as v', [roma]), [roma])
})

test('Costiera Amalfitana trova anche gli enti di Positano, Capri solo i suoi', async () => {
  await asUser(OWNER)
  const costa = await list(costiera, true)
  assert.deepEqual(costa!.items.map((i) => i.id), [pmPositano])
  assert.deepEqual(costa!.items[0].places, ['Positano'])
  assert.equal((await list(costiera, false))!.total, 0)
  assert.deepEqual((await list(capri, true))!.items.map((i) => i.id), [pmCapri])
  const campaniaAll = await list(campania, true)
  assert.equal(campaniaAll!.total, 2)
})

test('i tipi si combinano e i legami SELLS contano come COVERS', async () => {
  await asUser(OWNER)
  const both = await list(roma, true, ['dmc', 'tour_operator'])
  assert.equal(both!.total, 2)
  assert.deepEqual((await list(roma, true, ['tour_operator']))!.items.map((i) => i.id), [toRoma])
  assert.deepEqual((await list(roma, true, ['property_manager']))!.items, [])
})

test('le opzioni portano conteggi per tipo, anche tramite le sotto-aree', async () => {
  await asUser(OWNER)
  const options = await scalar<{ name: string; total: number; by_type: Record<string, number>; parent: string | null }[]>(
    'select tourism_destination_options() as v',
  )
  const byName = Object.fromEntries(options!.map((o) => [o.name, o]))
  assert.equal(byName['Roma'].total, 2)
  assert.deepEqual(byName['Roma'].by_type, { dmc: 1, tour_operator: 1 })
  assert.equal(byName['Campania'].total, 2)
  assert.equal(byName['Costiera Amalfitana'].total, 1)
  assert.equal(byName['Positano'].parent, 'Costiera Amalfitana')
})

test('un altro proprietario non vede niente e una funzione non esce dal suo workspace', async () => {
  await asUser(OTHER)
  assert.deepEqual(await scalar<string[]>('select tourism_place_scope($1,true) as v', [roma]), [])
  assert.equal((await list(roma, true))!.total, 0)
  await asUser(OWNER)
  assert.ok(!(await list(roma, true))!.items.some((i) => i.id === dmcAltrui))
})

test('ricerca, ordine, pagina e disattivati', async () => {
  await asUser(OWNER)
  const found = await scalar<{ total: number }>(`select tourism_destination_entities($1,true,null,null,'active',null,'incoming') as v`, [roma])
  assert.equal(found!.total, 1)
  const page2 = await scalar<{ total: number; items: unknown[] }>(
    `select tourism_destination_entities($1,true,null,null,'active',null,null,'name',1,1) as v`, [roma])
  assert.equal(page2!.total, 2)
  assert.equal(page2!.items.length, 1)
  await db.exec(`reset role; update tourism_entities set disabled=true where id='${toRoma}'`)
  await asUser(OWNER)
  assert.equal((await list(roma, true))!.total, 1)
  assert.equal(await scalar<number>(`select (tourism_destination_entities($1,true,null,null,'all') ->> 'total')::int as v`, [roma]), 2)
})

test('la sede dichiarata (hq_city) collega l ente alla citta, anche con il nome inglese', async () => {
  await db.exec('reset role')
  await db.exec(`update tourism_entities set aliases = array['Rome'] where id = '${roma}'`)
  const viaggi = await scalar<string>(
    `insert into tourism_entities(user_id,kind,name,country_code,type_code,status,details)
     values('${OWNER}','organization','Rome Travel Srl','IT','travel_agency','UNVERIFIED','{"hq_city":"Rome"}') returning id as v`)
  const nessuna = await scalar<string>(
    `insert into tourism_entities(user_id,kind,name,country_code,type_code,status,details)
     values('${OWNER}','organization','Altrove Viaggi','IT','travel_agency','UNVERIFIED','{"hq_city":"Torino"}') returning id as v`)
  await asUser(OWNER)
  const found = await list(roma, true, ['travel_agency'])
  assert.deepEqual(found!.items.map((i) => i.id), [viaggi])
  assert.deepEqual(found!.items[0].relations, ['HQ'])
  assert.ok(!found!.items.some((i) => i.id === nessuna))
  const options = await scalar<{ name: string; by_type: Record<string, number> }[]>('select tourism_destination_options() as v')
  assert.equal(options!.find((o) => o.name === 'Roma')!.by_type.travel_agency, 1)
})
