import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Porti, aeroporti e stazioni in tourism_hubs, con shipping_ports che resta
// la vista di Navigazione. Si applicano le migration vere dei porti, si
// scrive un porto e un itinerario "alla vecchia", poi si sposta tutto.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NAPOLI = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const NAPLES = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'
let db: PGlite

const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)
const migration = async (name: string) =>
  db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
async function scalar<T = string>(query: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(query, params)).rows[0]?.v
}
const importHubs = (hubs: unknown[]) =>
  scalar<{ created: number; updated: number; unchanged: number }>('select public.tourism_import_hubs($1::jsonb) as v', [
    JSON.stringify(hubs),
  ])

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
  ])
    await migration(name)

  // Lo stato di prima: un porto con numeri e superguida, un doppione, un itinerario.
  await asUser(OWNER)
  await db.exec(`
    insert into shipping_ports(id,slug,name,country,unlocode,aliases,latitude,longitude,region,destination,cruise_passengers,passengers_year,cruise_calls,stats_source,guide_status,guide_priority)
      values('${NAPOLI}','napoli','Napoli','IT','ITNAP','{Naples}',40.84,14.25,'Mediterraneo','Napoli',1600000,2025,560,'https://adsptirreno.it','planned',1),
            ('${NAPLES}','naples-terminal','Naples Terminal','IT',null,'{}',null,null,null,null,null,null,null,null,'none',null);
    insert into shipping_companies(id,slug,name) values('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','msc','MSC Crociere');
  `)
  await db.query('select save_shipping_itinerary($1::jsonb,$2::jsonb)', [
    JSON.stringify({ company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Mediterraneo 7 notti' }),
    JSON.stringify([
      { position: 1, day: 1, port_id: NAPOLI, role: 'embark' },
      { position: 2, day: 3, port_id: NAPLES },
    ]),
  ])
  await db.exec('reset role')
  await migration('20261020090000_tourism_hubs.sql')
  await migration('20261020090100_tourism_hubs_absorb_ports.sql')
  await migration('20261020120000_tourism_property_managers.sql')
})

test('i porti passano in tourism_hubs con lo stesso id e gli stessi numeri', async () => {
  await asUser(OWNER)
  const hub = (await db.query<Record<string, unknown>>('select * from tourism_hubs where id=$1', [NAPOLI])).rows[0]
  assert.equal(hub.mode, 'sea')
  assert.equal(hub.passengers, 1600000)
  assert.equal(hub.movements, 560)
  assert.equal(hub.guide_status, 'planned')
  assert.equal(hub.guide_priority, 1)
  const port = (await db.query<Record<string, unknown>>('select * from shipping_ports where id=$1', [NAPOLI])).rows[0]
  assert.equal(port.cruise_passengers, 1600000)
  assert.equal(port.cruise_calls, 560)
  assert.equal(port.unlocode, 'ITNAP')
})

test('Navigazione scrive ancora sulla vista: nuovo porto, modifica, itinerario, unione', async () => {
  await asUser(OWNER)
  await db.exec(`insert into shipping_ports(slug,name,country) values('salerno','Salerno','IT')`)
  assert.equal(await scalar(`select mode as v from tourism_hubs where slug='salerno'`), 'sea')
  await db.exec(`update shipping_ports set cruise_passengers=300000, passengers_year=2025, guide_status='live' where slug='salerno'`)
  assert.equal(await scalar(`select passengers as v from tourism_hubs where slug='salerno'`), 300000)
  await assert.rejects(db.exec(`update shipping_ports set cruise_passengers=1 , passengers_year=null where slug='salerno'`), /passengers_need_year/)

  const salerno = await scalar(`select id as v from shipping_ports where slug='salerno'`)
  await db.query('select save_shipping_itinerary($1::jsonb,$2::jsonb)', [
    JSON.stringify({ company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Costiera' }),
    JSON.stringify([{ position: 1, port_id: salerno }]),
  ])
  await db.query('select merge_shipping_ports($1,$2)', [NAPLES, NAPOLI])
  assert.equal(await scalar<number>(`select count(*)::int as v from shipping_itinerary_stops where port_id='${NAPLES}'`), 0)
  const aliases = await scalar<string[]>(`select aliases as v from shipping_ports where id='${NAPOLI}'`)
  assert.ok(aliases.includes('Naples Terminal'))
  // Un porto usato da un itinerario non si cancella.
  await assert.rejects(db.exec(`delete from shipping_ports where id='${NAPOLI}'`), /foreign key/)
})

test('un aeroporto non compare fra i porti e la vista non lo puo scrivere', async () => {
  await asUser(OWNER)
  await importHubs([{ mode: 'air', slug: 'nap', name: 'Napoli Capodichino', country: 'IT', iata: 'NAP', icao: 'LIRN' }])
  assert.equal(await scalar<number>(`select count(*)::int as v from shipping_ports where slug='nap'`), 0)
  await assert.rejects(db.exec(`insert into shipping_ports(slug,name,mode) values('x','X','air')`), /check option|WITH CHECK/i)
  // Stesso slug in due modi diversi va bene: Napoli porto e Napoli stazione.
  await importHubs([{ mode: 'rail', slug: 'napoli', name: 'Napoli Centrale', country: 'IT', uic: '8309218' }])
  assert.equal(await scalar<number>(`select count(*)::int as v from tourism_hubs where slug='napoli'`), 2)
})

test("l'importazione e' idempotente, riempie solo i vuoti e tiene i numeri piu' recenti", async () => {
  await asUser(OWNER)
  const fco = { mode: 'air', slug: 'fco', name: 'Roma Fiumicino', country: 'IT', iata: 'FCO', icao: 'LIRF', size: 'large',
    scheduled_service: true, latitude: 41.8, longitude: 12.25, passengers: 49000000, passengers_year: 2024, stats_source: 'https://assaeroporti.com' }
  assert.deepEqual(await importHubs([fco]), { created: 1, updated: 0, unchanged: 0 })
  assert.deepEqual(await importHubs([fco]), { created: 0, updated: 0, unchanged: 1 })
  await db.exec(`update tourism_hubs set name='Fiumicino Leonardo da Vinci', guide_status='planned' where iata='FCO'`)
  // Un numero vecchio non sostituisce quello nuovo; uno nuovo si'. Per codice IATA anche con uno slug diverso.
  await importHubs([{ ...fco, slug: 'rome-fco', passengers: 40000000, passengers_year: 2019 }])
  assert.equal(await scalar<number>(`select passengers as v from tourism_hubs where iata='FCO'`), 49000000)
  await importHubs([{ ...fco, passengers: 51000000, passengers_year: 2025, aliases: ['Leonardo da Vinci'] }])
  const row = (await db.query<Record<string, unknown>>(`select * from tourism_hubs where iata='FCO'`)).rows[0]
  assert.equal(row.passengers, 51000000)
  assert.equal(row.passengers_year, 2025)
  assert.equal(row.name, 'Fiumicino Leonardo da Vinci')
  assert.equal(row.guide_status, 'planned')
  assert.deepEqual(row.aliases, ['Leonardo da Vinci'])
  assert.equal(await scalar<number>(`select count(*)::int as v from tourism_hubs where mode='air' and iata='FCO'`), 1)
})

test('destinazioni: un hub e una destinazione puntano solo a un luogo', async () => {
  await asUser(OWNER)
  const roma = await scalar(`insert into tourism_entities(kind,name,country_code) values('place','Roma','IT') returning id as v`)
  const ente = await scalar(
    `insert into tourism_entities(kind,name,country_code,type_code) values('organization','Roma Capitale Turismo','IT','dmo') returning id as v`
  )
  await db.query(`update tourism_hubs set destination_id=$1 where iata='FCO'`, [roma])
  await assert.rejects(db.query(`update tourism_hubs set destination_id=$1 where iata='FCO'`, [ente]), /must be a place/)
  await db.query(`insert into tourism_destinations(entity_id,intl_arrivals,arrivals_year,arrivals_source,languages_needed) values($1,10000000,2024,'https://istat.it','{en,de,fr,es}')`, [roma])
  await assert.rejects(db.query(`insert into tourism_destinations(entity_id) values($1)`, [ente]), /must be a place/)
  await assert.rejects(
    db.query(`update tourism_destinations set intl_arrivals=5, arrivals_source=null where entity_id=$1`, [roma]),
    /arrivals_need_year/
  )
  const overview = await scalar<Record<string, { total: number; linked: number }>>('select tourism_hub_overview() as v')
  assert.equal(overview.air.linked, 1)
  assert.ok(overview.sea.total >= 2)
})

test("un altro workspace non vede ne' scrive hub, destinazioni e operatori", async () => {
  await asUser(OTHER)
  assert.equal(await scalar<number>('select count(*)::int as v from tourism_hubs'), 0)
  assert.equal(await scalar<number>('select count(*)::int as v from shipping_ports'), 0)
  await assert.rejects(db.exec(`insert into tourism_hubs(user_id,mode,slug,name) values('${OWNER}','air','x','X')`))
  await assert.rejects(db.query(`select merge_shipping_ports($1,$2)`, [NAPOLI, NAPLES]), /porto non trovato/)
})

test('le nuove tipologie della distribuzione e la relazione SELLS', async () => {
  await asUser(OWNER)
  const to = await scalar(
    `insert into tourism_entities(kind,name,country_code,type_code) values('organization','Alpitour','IT','tour_operator') returning id as v`
  )
  const roma = await scalar(`select id as v from tourism_entities where kind='place' and name='Roma'`)
  const evidence = await scalar(
    `insert into tourism_evidence(entity_id,source_url,title,fields) values($1,'https://alpitour.it/roma','Catalogo Roma','{relationship}') returning id as v`,
    [to]
  )
  await db.query(`insert into tourism_relations(from_id,to_id,relation,evidence_id) values($1,$2,'SELLS',$3)`, [to, roma, evidence])
  // Un property manager e' un'azienda della distribuzione, mai una persona.
  await db.exec(`insert into tourism_entities(kind,name,country_code,type_code) values('organization','Halldis','IT','property_manager')`)
  await assert.rejects(db.exec(`insert into tourism_entities(kind,name,country_code) values('person','Mario Rossi','IT')`), /Personal data/)
  const hub = await scalar(`select id as v from tourism_hubs where iata='FCO'`)
  await db.query(`insert into tourism_hub_operators(hub_id,entity_id,role) values($1,$2,'route')`, [hub, to])
  assert.equal(await scalar<number>(`select count(*)::int as v from tourism_revisions where table_name='tourism_hub_operators'`), 1)
})

test("il catalogo aeroporti vero passa i vincoli, a blocchi, ed e' idempotente", async () => {
  const { readFileSync } = await import('node:fs')
  const { dedupeHubs, hubImportSql, normalizeHub } = await import('../src/lib/tourism-hubs')
  const catalog = JSON.parse(readFileSync(new URL('../scripts/data/tourism-airports.json', import.meta.url), 'utf8'))
  const { hubs } = dedupeHubs(catalog.hubs.map((row: Record<string, unknown>) => normalizeHub(row)))
  await db.exec('reset role')
  const run = async () => {
    for (let index = 0; index < hubs.length; index += 500) await db.exec(hubImportSql(hubs.slice(index, index + 500), OWNER))
  }
  await run()
  await asUser(OWNER)
  const count = await scalar<number>(`select count(*)::int as v from tourism_hubs where mode='air'`)
  // NAP e FCO c'erano gia' dai test precedenti: non si duplicano.
  assert.equal(count, hubs.length)
  await db.exec('reset role')
  await run()
  await asUser(OWNER)
  assert.equal(await scalar<number>(`select count(*)::int as v from tourism_hubs where mode='air'`), hubs.length)
  assert.equal(await scalar(`select name as v from tourism_hubs where iata='FCO'`), 'Fiumicino Leonardo da Vinci')
})
