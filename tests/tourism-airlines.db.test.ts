import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile, mkdtemp, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

// Catalogo delle compagnie aeree: il SQL generato da scripts/tourism/airlines.py
// entra con tourism_import, una volta sola, solo per il proprietario.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite
const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)
const migration = async (name: string) =>
  db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
async function scalar<T = string>(query: string, params: unknown[] = []) {
  return (await db.query<{ v: T }>(query, params)).rows[0]?.v
}

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
  ])
    await migration(name)
})

test('il catalogo entra, una volta sola, come compagnie aeree non verificate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'airlines-'))
  execFileSync('python3', ['scripts/tourism/airlines.py', 'sql', '--catalog', 'scripts/data/tourism-airlines.json', '--owner', OWNER, '--out', dir])
  const files = (await readdir(dir)).sort()
  assert.ok(files.length >= 2)
  const run = async () => {
    for (const file of files) await db.exec(await readFile(join(dir, file), 'utf8'))
  }
  await run()
  await db.exec('reset role')
  const catalog = JSON.parse(await readFile(new URL('../scripts/data/tourism-airlines.json', import.meta.url), 'utf8')).records
  const count = async (where: string) =>
    Number(await scalar(`select count(*) as v from tourism_entities t where t.type_code='airline' and ${where}`))
  assert.equal(await count(`t.user_id='${OWNER}'`), catalog.length)
  assert.equal(await count(`t.status<>'UNVERIFIED'`), 0)
  assert.equal(
    Number(await scalar(`select count(*) as v from tourism_evidence e join tourism_entities t on t.id=e.entity_id where t.type_code='airline'`)),
    catalog.length,
  )
  await run()
  await db.exec('reset role')
  assert.equal(await count('true'), catalog.length)
  assert.equal(await scalar(`select details->>'iata' as v from tourism_entities where name='Aer Lingus'`), 'EI')
})

test('le OTA, i bedbank e i marketplace curati entrano senza toccare le compagnie', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ota-'))
  execFileSync('python3', ['scripts/tourism/airlines.py', 'sql', '--catalog', 'scripts/data/tourism-ota-curated.json', '--owner', OWNER, '--out', dir])
  for (const file of (await readdir(dir)).sort()) await db.exec(await readFile(join(dir, file), 'utf8'))
  await db.exec('reset role')
  const catalog = JSON.parse(await readFile(new URL('../scripts/data/tourism-ota-curated.json', import.meta.url), 'utf8')).records
  assert.equal(
    Number(await scalar(`select count(*) as v from tourism_entities where type_code in ('ota','bedbank','experience_marketplace')`)),
    catalog.length,
  )
  assert.ok(Number(await scalar(`select count(*) as v from tourism_entities where type_code='airline'`)) > 700)
})
