import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import pilot from '../src/data/tourism-italy-pilot'
import { normalizeRecord } from '../src/lib/tourism'

const OWNER = '11111111-1111-4111-8111-111111111111',
  OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite
async function scalar<T = string>(query: string, params: unknown[] = []) {
  return (await db.query<Record<string, T>>(query, params)).rows[0]?.v
}
async function asUser(id: string) {
  await db.exec(
    `reset role;set request.jwt.claim.sub='${id}';set role authenticated;`
  )
}
const records = pilot.records.map((r) => normalizeRecord(r, 'pilot'))
async function importRecords(
  rows = records,
  edges: unknown[] = pilot.relations
) {
  return scalar<{ created: number; duplicates: number; ids: string[] }>(
    'select public.tourism_import($1::jsonb,$2::jsonb) as v',
    [JSON.stringify(rows), JSON.stringify(edges)]
  )
}
async function verify(id: string) {
  const version = await scalar<number>(
    'select version as v from tourism_entities where id=$1',
    [id]
  )
  const evidence = await scalar(
    'select id as v from tourism_evidence where entity_id=$1 order by acquired_at limit 1',
    [id]
  )
  await db.query('select tourism_review($1,$2,$3,true)', [
    id,
    evidence,
    version
  ])
}

before(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users(id) values('${OWNER}'),('${OTHER}');
    create table contacts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text not null,company text,country text,email text,phone text,status text not null,source text,contact_scope text,marketing_eligibility text,legacy_id text,note text,updated_at timestamptz default now(),unique(user_id,legacy_id));
    create table activities(id uuid primary key default gen_random_uuid(),user_id uuid not null,contact_id uuid references contacts(id),type text,content text);
    alter table contacts enable row level security;alter table activities enable row level security;
    create policy owner on contacts for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy owner on activities for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    grant select,insert,update,delete on contacts,activities to authenticated;
  `)
  await db.exec(
    `alter default privileges in schema public grant all on tables to anon,authenticated;
     alter default privileges in schema public grant all on functions to anon,authenticated;
     alter default privileges in schema public grant all on sequences to anon,authenticated;`
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261017205455_tourism_intelligence.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261017214525_tourism_acquisition_matching.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL('../scripts/tourism/ota-taxonomy.sql', import.meta.url),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261018185155_tourism_site_research.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261019051155_tourism_sitemap_targeting.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261019085842_tourism_outreach_priority.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await asUser(OWNER)
})
after(async () => {
  await db?.close()
})

test('OTA imports as a commercial category and remains unverified', async () => {
  await db.exec('begin')
  try {
    const row = normalizeRecord({
      ...records[0],
      name: 'Example Online Travel Agency',
      type_code: 'ota'
    })
    const result = await importRecords([row], [])
    assert.equal(result?.created, 1)
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        result!.ids[0]
      ]),
      'UNVERIFIED'
    )
    assert.equal(
      await scalar<boolean>(
        "select governance as v from tourism_taxonomy where code='ota'"
      ),
      false
    )
  } finally {
    await db.exec('rollback')
  }
})

test('TTG source IDs survive import without creating CRM contacts', async () => {
  await db.exec('begin')
  try {
    const before = await scalar<number>(
      'select count(*)::int as v from contacts'
    )
    const input = normalizeRecord({
      ...records[0],
      name: 'TTG Destination Fixture',
      type_code: 'dmc',
      external_ids: { ttg_2026: '8000000' }
    })
    const result = await importRecords([input], [])
    assert.equal(result?.created, 1)
    const id = result!.ids[0]
    assert.equal(
      await scalar(
        "select external_ids->>'ttg_2026' as v from tourism_entities where id=$1",
        [id]
      ),
      '8000000'
    )
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        id
      ]),
      'UNVERIFIED'
    )
    assert.equal(
      await scalar<number>('select count(*)::int as v from contacts'),
      before
    )
  } finally {
    await db.exec('rollback')
  }
})

test('inherited Supabase grants cannot expose RPCs, trigger functions or audit sequences', async () => {
  const functions = await db.query<{
    name: string
    anon: boolean
    authenticated: boolean
  }>(`
    select proname as name,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and proname like 'tourism_%'
  `)
  assert.ok(functions.rows.length >= 18)
  const internal = new Set([
    'tourism_audit',
    'tourism_entity_guard',
    'tourism_evidence_guard',
    'tourism_evidence_invalidate',
    'tourism_relation_guard',
    'tourism_link_guard',
    'tourism_match_guard',
    'tourism_research_guard'
  ])
  for (const fn of functions.rows) {
    assert.equal(fn.anon, false, `${fn.name} must deny anonymous execution`)
    assert.equal(
      fn.authenticated,
      !internal.has(fn.name),
      `${fn.name} has unexpected authenticated grants`
    )
  }
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      await scalar<boolean>(
        `select has_sequence_privilege('${role}','tourism_revisions_id_seq','USAGE') as v`
      ),
      false
    )
  }
})

test('pilot imports atomically with evidence, geographic coverage and no CRM writes', async () => {
  const r = await importRecords()
  assert.equal(r.created, 17)
  assert.equal(r.duplicates, 0)
  assert.equal(
    await scalar<number>('select count(*)::int as v from tourism_entities'),
    17
  )
  assert.equal(
    await scalar<number>('select count(*)::int as v from tourism_relations'),
    7
  )
  assert.equal(
    await scalar<number>('select count(*)::int as v from contacts'),
    0
  )
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_entities where status='VERIFIED'"
    ),
    0
  )
})
test('reimport preserves manual edits, evidence and reviews', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='ENIT S.p.A.'"
  )
  await verify(id)
  const before = await scalar<number>(
    'select version as v from tourism_entities where id=$1',
    [id]
  )
  const r = await importRecords()
  assert.equal(r.created, 0)
  assert.equal(r.duplicates, 17)
  assert.equal(
    await scalar<number>(
      'select version as v from tourism_entities where id=$1',
      [id]
    ),
    before
  )
  assert.equal(
    await scalar('select status as v from tourism_entities where id=$1', [id]),
    'VERIFIED'
  )
})
test('failing import rolls back previous rows and their audits', async () => {
  const unique = { ...records[0], name: 'Rollback candidate' }
  await assert.rejects(() =>
    importRecords(
      [
        unique,
        { ...unique, name: 'Invalid category', type_code: 'not_real' as 'nto' }
      ],
      []
    )
  )
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_entities where name='Rollback candidate'"
    ),
    0
  )
})
test('unverified identities cannot be promoted even through RPC or direct SQL', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='Italy Creative'"
  )
  await assert.rejects(
    () => db.query('select tourism_promote($1)', [id]),
    /verified/i
  )
  await assert.rejects(
    () =>
      db.query("update tourism_entities set status='VERIFIED' where id=$1", [
        id
      ]),
    /evidence/i
  )
})
test('CRM promotion is repeatable and creates neither outreach eligibility nor activities twice', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='ENIT S.p.A.'"
  )
  const first = await scalar<{ contact_id: string; created: boolean }>(
    'select tourism_promote($1) as v',
    [id]
  )
  const second = await scalar<{ contact_id: string; created: boolean }>(
    'select tourism_promote($1) as v',
    [id]
  )
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(first.contact_id, second.contact_id)
  assert.equal(
    await scalar(
      'select marketing_eligibility as v from contacts where id=$1',
      [first.contact_id]
    ),
    'review'
  )
  assert.equal(
    await scalar<number>(
      'select count(*)::int as v from activities where contact_id=$1',
      [first.contact_id]
    ),
    1
  )
})
test('editing a verified entity invalidates evidence and preserves before/after history', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='ENIT S.p.A.'"
  )
  await db.query("update tourism_entities set phone='+39 000' where id=$1", [
    id
  ])
  assert.equal(
    await scalar('select status as v from tourism_entities where id=$1', [id]),
    'NEEDS_REVIEW'
  )
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_evidence where entity_id=$1 and status='VERIFIED'",
      [id]
    ),
    0
  )
  assert.ok(
    (await scalar<number>(
      "select count(*)::int as v from tourism_revisions where record_id=$1 and before_data->>'status'='VERIFIED'",
      [id]
    )) > 0
  )
})
test('stale review is rejected, and rejecting a source removes verified status', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='Visit Piemonte S.c.r.l.'"
  )
  const evidence = await scalar(
    'select id as v from tourism_evidence where entity_id=$1',
    [id]
  )
  await assert.rejects(
    () => db.query('select tourism_review($1,$2,999,true)', [id, evidence]),
    /Version conflict/
  )
  await verify(id)
  await db.query("update tourism_evidence set status='REJECTED' where id=$1", [
    evidence
  ])
  assert.equal(
    await scalar('select status as v from tourism_entities where id=$1', [id]),
    'NEEDS_REVIEW'
  )
})
test('RLS blocks another workspace including direct REST-style updates and RPCs', async () => {
  assert.equal(
    await scalar<boolean>(
      "select has_table_privilege('authenticated','tourism_revisions','TRUNCATE') as v"
    ),
    false
  )
  assert.equal(
    await scalar<boolean>(
      "select has_table_privilege('anon','tourism_entities','SELECT') as v"
    ),
    false
  )
  const id = await scalar(
    "select id as v from tourism_entities where name='ENIT S.p.A.'"
  )
  await asUser(OTHER)
  try {
    assert.equal(
      await scalar<number>('select count(*)::int as v from tourism_entities'),
      0
    )
    assert.equal(
      await scalar<number>('select count(*)::int as v from tourism_revisions'),
      0
    )
    await assert.rejects(
      () => db.query('select tourism_promote($1)', [id]),
      /not found/
    )
    await assert.rejects(
      () =>
        db.query(
          "insert into tourism_entities(user_id,kind,name,country_code,type_code) values($1,'organization','Foreign write','IT','nto')",
          [OWNER]
        ),
      /row-level security/
    )
    await assert.rejects(
      () =>
        db.query(
          "insert into tourism_revisions(user_id,table_name,record_id,operation) values($1,'fake',$2,'UPDATE')",
          [OTHER, id]
        ),
      /permission denied/
    )
  } finally {
    await asUser(OWNER)
  }
})
test('typed relations reject DMC to brand as territorial governance and geographic cycles', async () => {
  const org = await scalar(
    "select id as v from tourism_entities where name='Italy Creative'"
  )
  const brand = await scalar(
    "select id as v from tourism_entities where name='Trentino' and kind='brand'"
  )
  const ev = await scalar(
    'select id as v from tourism_evidence where entity_id=$1',
    [org]
  )
  await assert.rejects(
    () =>
      db.query(
        "insert into tourism_relations(from_id,to_id,relation,evidence_id)values($1,$2,'COVERS',$3)",
        [org, brand, ev]
      ),
    /Invalid relationship/
  )
  const places = (
    await db.query<{ id: string }>(
      "select id from tourism_entities where kind='place' order by id limit 2"
    )
  ).rows
  const a = places[0].id,
    b = places[1].id
  const ae = await scalar(
    'select id as v from tourism_evidence where entity_id=$1',
    [a]
  )
  const be = await scalar(
    'select id as v from tourism_evidence where entity_id=$1',
    [b]
  )
  await db.query(
    "insert into tourism_relations(from_id,to_id,relation,evidence_id)values($1,$2,'PART_OF',$3)",
    [a, b, ae]
  )
  await assert.rejects(
    () =>
      db.query(
        "insert into tourism_relations(from_id,to_id,relation,evidence_id)values($1,$2,'PART_OF',$3)",
        [b, a, be]
      ),
    /Geographic cycle/
  )
})
test('expired discovery jobs can resume and active jobs cannot run concurrently', async () => {
  const id = await scalar(
    "insert into tourism_jobs(query)values('Trova le DMO italiane')returning id as v"
  )
  await db.query('select tourism_claim_job($1)', [id])
  await assert.rejects(
    () => db.query('select tourism_claim_job($1)', [id]),
    /already running/
  )
  await db.query(
    "update tourism_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [id]
  )
  const job = await scalar<{ attempts: number }>(
    'select to_jsonb(tourism_claim_job($1)) as v',
    [id]
  )
  assert.equal(job.attempts, 2)
})
test('international names remain distinct and full text supports searches outside Latin script', async () => {
  const rows = [
    { ...records[0], name: '東京都観光財団', country_code: 'JP' },
    { ...records[0], name: '大阪観光局', country_code: 'JP' }
  ]
  const imported = await importRecords(rows, [])
  assert.equal(imported.created, 2)
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_entities where search_document @@ websearch_to_tsquery('simple','東京都観光財団')"
    ),
    1
  )
})
test('overview totals are database-wide, not limited to the first page', async () => {
  const overview = await scalar<{ organizations: number; countries: number }>(
    'select tourism_overview() as v'
  )
  assert.equal(overview.organizations, 10)
  assert.equal(overview.countries, 2)
})

test('null versions and invalid personal-data imports are rejected at the database boundary', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='Italy Creative'"
  )
  const ev = await scalar(
    'select id as v from tourism_evidence where entity_id=$1',
    [id]
  )
  await assert.rejects(
    () => db.query('select tourism_review($1,$2,null,true)', [id, ev]),
    /Version conflict/
  )
  await assert.rejects(
    () =>
      db.query(
        "select tourism_save_indicator($1,1,'map_need',null,'https:\/\/example.com','Test')",
        [id]
      ),
    /Invalid indicator/
  )
  await assert.rejects(() => db.query('select tourism_import(null)'), /1-200/)
  await assert.rejects(
    () =>
      db.query(
        "insert into tourism_entities(kind,name,country_code)values('person','Fixture person','IT')"
      ),
    /lawful-basis/
  )
})

test('score observations and evidence are saved atomically and require new review', async () => {
  const id = await scalar(
    "select id as v from tourism_entities where name='Italy Creative'"
  )
  await verify(id)
  const version = await scalar<number>(
    'select version as v from tourism_entities where id=$1',
    [id]
  )
  await db.query(
    "select tourism_save_indicator($1,$2,'map_need',70,'https://example.com/digital','Esigenza documentata dal responsabile')",
    [id, version]
  )
  assert.equal(
    await scalar('select status as v from tourism_entities where id=$1', [id]),
    'NEEDS_REVIEW'
  )
  assert.equal(
    await scalar<number>(
      "select (details->'indicators'->'map_need'->>'value')::int as v from tourism_entities where id=$1",
      [id]
    ),
    70
  )
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_evidence where entity_id=$1 and fields @> array['indicator:map_need'] and status='UNVERIFIED'",
      [id]
    ),
    1
  )
})

test('CRM country ambiguity and shared email never create silent duplicate accounts', async () => {
  const row = normalizeRecord({
    ...pilot.records[0],
    name: 'CRM ambiguity fixture',
    email: 'shared@example.com'
  })
  const imported = await importRecords([row], [])
  const id = imported.ids[0]
  await verify(id)
  await db.query(
    "insert into contacts(user_id,name,company,country,status)values($1,'CRM ambiguity fixture','CRM ambiguity fixture','Italia','New')",
    [OWNER]
  )
  await assert.rejects(
    () => db.query('select tourism_promote($1)', [id]),
    /country mismatch/
  )
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from contacts where company='CRM ambiguity fixture'"
    ),
    1
  )
  await db.query("delete from contacts where company='CRM ambiguity fixture'")
  await db.query(
    "insert into contacts(user_id,name,company,email,status)values($1,'Other fixture','Different organization','shared@example.com','New')",
    [OWNER]
  )
  await assert.rejects(
    () => db.query('select tourism_promote($1)', [id]),
    /Email already used/
  )
  assert.equal(
    await scalar<number>(
      'select count(*)::int as v from tourism_crm_links where entity_id=$1',
      [id]
    ),
    0
  )
})

test('deleting unlinked records preserves append-only audit history', async () => {
  const imported = await importRecords(
    [normalizeRecord({ ...pilot.records[0], name: 'Delete fixture' })],
    []
  )
  const id = imported.ids[0]
  await db.query('delete from tourism_entities where id=$1', [id])
  assert.equal(
    await scalar<number>(
      "select count(*)::int as v from tourism_revisions where record_id=$1 and operation='DELETE'",
      [id]
    ),
    1
  )
  assert.equal(
    await scalar<number>(
      'select count(*)::int as v from tourism_evidence where entity_id=$1',
      [id]
    ),
    0
  )
})

test('batch ingestion and full-text pagination work beyond a single directory page', async () => {
  const started = performance.now()
  for (let batch = 0; batch < 3; batch++) {
    const fixtures = Array.from({ length: 200 }, (_, i) =>
      normalizeRecord({
        ...pilot.records[0],
        name: `Pagination fixture ${String(batch * 200 + i).padStart(4, '0')}`,
        country_code: 'FR',
        description: 'Test fixture, not real research'
      })
    )
    assert.equal((await importRecords(fixtures, [])).created, 200)
  }
  const queryStarted = performance.now()
  const first = (
    await db.query<{ id: string }>(
      "select id from tourism_entities where search_document @@ websearch_to_tsquery('simple','Pagination fixture') order by name,id limit 50 offset 0"
    )
  ).rows
  const second = (
    await db.query<{ id: string }>(
      "select id from tourism_entities where search_document @@ websearch_to_tsquery('simple','Pagination fixture') order by name,id limit 50 offset 50"
    )
  ).rows
  assert.equal(first.length, 50)
  assert.equal(second.length, 50)
  assert.equal(new Set([...first, ...second].map((r) => r.id)).size, 100)
  console.log(
    `Tourism local performance: 600 fixture records in ${Math.round(queryStarted - started)}ms; 2 search pages in ${Math.round(performance.now() - queryStarted)}ms (PGlite, not a production benchmark).`
  )
})

test('CRM suggestions require verified identity and explicit linking, without replacing CRM fields', async () => {
  const imported = await importRecords(
    [
      normalizeRecord({
        ...pilot.records[0],
        name: 'Match review fixture',
        email: null,
        phone: null
      })
    ],
    []
  )
  const id = imported.ids[0]
  const contact = await scalar(
    "insert into contacts(user_id,name,company,country,email,phone,status,marketing_eligibility) values($1,'Existing identity','Original CRM identity','IT','preserved@example.org','+390123','New','review') returning id as v",
    [OWNER]
  )
  await db.query(
    "insert into tourism_crm_matches(user_id,entity_id,contact_id,rule,score) values($1,$2,$3,'website_domain',97)",
    [OWNER, id, contact]
  )
  await assert.rejects(
    () => db.query('select tourism_link_existing($1,$2,1)', [id, contact]),
    /Verified organization required/
  )
  await verify(id)
  const version = await scalar<number>(
    'select version as v from tourism_entities where id=$1',
    [id]
  )
  const before = await scalar<number>('select count(*)::int as v from contacts')
  await assert.rejects(
    () => db.query('select tourism_promote($1)', [id]),
    /matches require review/
  )
  assert.equal(
    await scalar<number>('select count(*)::int as v from contacts'),
    before
  )
  await assert.rejects(
    () => db.query('select tourism_link_existing($1,$2,999)', [id, contact]),
    /Version conflict/
  )
  const first = await scalar<{ contact_id: string; created: boolean }>(
    'select tourism_link_existing($1,$2,$3) as v',
    [id, contact, version]
  )
  const repeated = await scalar<{ contact_id: string; created: boolean }>(
    'select tourism_link_existing($1,$2,$3) as v',
    [id, contact, version]
  )
  assert.equal(first.contact_id, contact)
  assert.deepEqual(repeated, first)
  assert.equal(first.created, false)
  assert.equal(
    await scalar('select email as v from contacts where id=$1', [contact]),
    'preserved@example.org'
  )
  assert.equal(
    await scalar('select phone as v from contacts where id=$1', [contact]),
    '+390123'
  )
  assert.equal(
    await scalar(
      'select state as v from tourism_crm_matches where entity_id=$1',
      [id]
    ),
    'confirmed'
  )
  assert.equal(
    await scalar<number>(
      'select count(*)::int as v from activities where contact_id=$1',
      [contact]
    ),
    1
  )
})

test('match suggestions and acquisition receipts enforce workspace boundaries and explicit grants', async () => {
  const entity = await scalar(
    "select id as v from tourism_entities where name='Match review fixture'"
  )
  await asUser(OTHER)
  const otherContact = await scalar(
    "insert into contacts(user_id,name,status) values($1,'Other workspace','New') returning id as v",
    [OTHER]
  )
  await asUser(OWNER)
  await assert.rejects(
    () =>
      db.query(
        "insert into tourism_crm_matches(user_id,entity_id,contact_id,rule,score) values($1,$2,$3,'name',80)",
        [OWNER, entity, otherContact]
      ),
    /Cross-workspace CRM match denied/
  )
  await db.query(
    "insert into tourism_acquisitions(user_id,run_key,state,sources,stats) values($1,'test-public-sources','completed','[]','{}')",
    [OWNER]
  )
  for (const table of ['tourism_crm_matches', 'tourism_acquisitions']) {
    assert.equal(
      await scalar<boolean>(
        `select has_table_privilege('anon','${table}','SELECT') as v`
      ),
      false
    )
    assert.equal(
      await scalar<boolean>(
        `select has_table_privilege('authenticated','${table}','TRUNCATE') as v`
      ),
      false
    )
  }
  await asUser(OTHER)
  assert.equal(
    await scalar<number>('select count(*)::int as v from tourism_crm_matches'),
    0
  )
  assert.equal(
    await scalar<number>('select count(*)::int as v from tourism_acquisitions'),
    0
  )
  await asUser(OWNER)
})

test('coverage separates geographic reference countries, missing organizations and verified links', async () => {
  await importRecords(
    ['IT', 'GB'].map((code) =>
      normalizeRecord({
        kind: 'place',
        name: 'Country coverage ' + code,
        country_code: code,
        details: { place_level: 'country' },
        evidence: {
          source_url: 'https://example.org/geography/' + code,
          title: 'Country reference',
          fields: ['name', 'country_code']
        }
      })
    ),
    []
  )
  const coverage = await scalar<{
    reference_countries: number
    countries_without_organizations: number
    by_country: { country_code: string; total: number }[]
    runs: unknown[]
  }>('select tourism_catalog_coverage() as v')
  assert.equal(coverage.reference_countries, 2)
  assert.equal(coverage.countries_without_organizations, 1)
  assert.equal(
    coverage.by_country.find((row) => row.country_code === 'GB')?.total,
    0
  )
  assert.equal(coverage.runs.length, 1)
  await asUser(OTHER)
  const other = await scalar<{ reference_countries: number; runs: unknown[] }>(
    'select tourism_catalog_coverage() as v'
  )
  assert.equal(other.reference_countries, 0)
  assert.equal(other.runs.length, 0)
  await asUser(OWNER)
})

async function researchTransaction(run: () => Promise<void>) {
  await asUser(OWNER)
  await db.exec('begin')
  try {
    await run()
  } finally {
    await db.exec('rollback')
    await asUser(OWNER)
  }
}
async function rejectedStatement(run: () => Promise<unknown>, pattern: RegExp) {
  await db.exec('savepoint rejected_statement')
  await assert.rejects(run, pattern)
  await db.exec(
    'rollback to savepoint rejected_statement;release savepoint rejected_statement'
  )
}
async function researchSource() {
  return (
    await db.query<{ id: string }>(
      "insert into tourism_site_sources(user_id,url,label,country_code,enabled,max_requests) values($1,'https://research.example.org/','Research destination','IT',true,15) returning id",
      [OWNER]
    )
  ).rows[0].id
}
async function researchEntities() {
  const rows = ['Research Alpha', 'Research Beta'].map((name) =>
    normalizeRecord({ ...records[0], name })
  )
  return (await importRecords(rows, []))!.ids
}
const researchReport = (
  url = 'https://research.example.org/',
  latitude = 40.8
) => ({
  schema_version: 1,
  site_url: url,
  fetched_at: new Date().toISOString(),
  state: 'completed',
  title: 'Research',
  destination_signals: [],
  languages: ['it'],
  map_detected: true,
  catalogue_pages: [],
  sitemap_urls_seen: 50,
  place_url_candidates: 30,
  restaurant_url_candidates: 10,
  declared_lists: [],
  candidates: [
    {
      source_url: url + 'poi/museum',
      name: 'Research museum',
      category: 'place',
      latitude,
      longitude: 14.2,
      address: null,
      evidence_kind: 'jsonld'
    }
  ],
  geocoded_candidates: 1,
  requests: 3,
  bytes: 10000,
  duration_ms: 1500,
  sample_limited: true,
  count_note: 'Bounded inventory',
  errors: [],
  receipts: []
})

test('research tables deny anonymous and cross-workspace access, including role escalation in claim', () =>
  researchTransaction(async () => {
    const sid = await researchSource()
    await asUser(OTHER)
    assert.equal(
      await scalar<number>(
        'select count(*)::integer as v from tourism_site_sources'
      ),
      0
    )
    await rejectedStatement(
      () => db.query('select tourism_claim_site($1,$2)', [sid, OWNER]),
      /Owner access denied/
    )
    await asUser(OWNER)
    for (const table of [
      'tourism_site_sources',
      'tourism_site_scans',
      'tourism_poi_candidates',
      'tourism_project_opportunities',
      'tourism_canonical_links'
    ]) {
      assert.equal(
        await scalar<boolean>(
          `select has_table_privilege('anon','${table}','SELECT') as v`
        ),
        false
      )
      assert.equal(
        await scalar<boolean>(
          `select has_table_privilege('authenticated','${table}','TRUNCATE') as v`
        ),
        false
      )
    }
  }))
test('site claims are exclusive and finishing stages candidates without verifying identity or permitting reuse', () =>
  researchTransaction(async () => {
    const sid = await researchSource()
    const claim = await scalar<any>('select tourism_claim_site($1) as v', [sid])
    assert.ok(claim.lease_token)
    assert.equal(
      await scalar('select tourism_claim_site($1) as v', [sid]),
      null
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_finish_site($1,gen_random_uuid(),$2,$3)', [
          sid,
          JSON.stringify(researchReport()),
          '{}'
        ]),
      /expired site lease/
    )
    await db.query('select tourism_finish_site($1,$2,$3,$4)', [
      sid,
      claim.lease_token,
      JSON.stringify(researchReport()),
      '{"baseline":true}'
    ])
    assert.equal(
      await scalar(
        'select official_status as v from tourism_site_sources where id=$1',
        [sid]
      ),
      'candidate'
    )
    assert.equal(
      await scalar(
        'select state as v from tourism_poi_candidates where source_id=$1',
        [sid]
      ),
      'candidate'
    )
    assert.equal(
      await scalar(
        'select reuse_status as v from tourism_poi_candidates where source_id=$1',
        [sid]
      ),
      'unknown'
    )
    assert.equal(
      await scalar<number>(
        'select count(*)::integer as v from tourism_site_scans where source_id=$1',
        [sid]
      ),
      1
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_finish_site($1,$2,$3,$4)', [
          sid,
          claim.lease_token,
          JSON.stringify(researchReport()),
          '{}'
        ]),
      /expired site lease/
    )
  }))
test('site approval needs a source and project/POI approvals cannot pass through null SQL checks', () =>
  researchTransaction(async () => {
    const sid = await researchSource()
    await rejectedStatement(
      () =>
        db.query(
          "update tourism_site_sources set official_status='confirmed',review_note='Checked identity' where id=$1",
          [sid]
        ),
      /check constraint/
    )
    const claim = await scalar<any>('select tourism_claim_site($1) as v', [sid])
    await db.query('select tourism_finish_site($1,$2,$3,$4)', [
      sid,
      claim.lease_token,
      JSON.stringify(researchReport()),
      '{}'
    ])
    await rejectedStatement(
      () =>
        db.query(
          "update tourism_poi_candidates set state='approved',reuse_status='open',review_note='License inspected',reviewed_by=$1,reviewed_at=now() where source_id=$2",
          [OWNER, sid]
        ),
      /check constraint/
    )
    await db.query(
      "update tourism_poi_candidates set state='approved',reuse_status='open',reuse_url='https://research.example.org/license',review_note='License inspected',reviewed_by=$1,reviewed_at=now() where source_id=$2",
      [OWNER, sid]
    )
    const nextClaim = await scalar<any>('select tourism_claim_site($1) as v', [
      sid
    ])
    await db.query('select tourism_finish_site($1,$2,$3,$4)', [
      sid,
      nextClaim.lease_token,
      JSON.stringify(researchReport(undefined, 41)),
      '{}'
    ])
    assert.equal(
      await scalar(
        'select state as v from tourism_poi_candidates where source_id=$1',
        [sid]
      ),
      'candidate'
    )
    assert.equal(
      await scalar(
        'select reviewed_at as v from tourism_poi_candidates where source_id=$1',
        [sid]
      ),
      null
    )
    assert.equal(
      await scalar<number>(
        'select count(*)::integer as v from tourism_poi_candidates where source_id=$1',
        [sid]
      ),
      1
    )
  }))
test('daily site request budget includes active reservations across sites', () =>
  researchTransaction(async () => {
    const ids = []
    for (let i = 0; i < 4; i++)
      ids.push(
        await scalar(
          "insert into tourism_site_sources(user_id,url,label,country_code,max_requests,enabled) values($1,$2,'Budget destination','IT',40,true) returning id as v",
          [OWNER, `https://budget${i}.example.org/`]
        )
      )
    for (let i = 0; i < 3; i++)
      assert.ok(
        (await scalar<any>('select tourism_claim_site($1) as v', [ids[i]]))
          .lease_token
      )
    assert.equal(
      await scalar('select tourism_claim_site($1) as v', [ids[3]]),
      null
    )
  }))
test('bulk identity review is atomic on version conflict and never creates CRM contacts', () =>
  researchTransaction(async () => {
    const ids = await researchEntities(),
      items: { id: string; version: number; evidence_id: string }[] = []
    for (const eid of ids)
      items.push({
        id: eid,
        version: await scalar<number>(
          'select version as v from tourism_entities where id=$1',
          [eid]
        ),
        evidence_id: await scalar(
          'select id as v from tourism_evidence where entity_id=$1 limit 1',
          [eid]
        )
      })
    const contacts = await scalar<number>(
      'select count(*)::integer as v from contacts'
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_bulk_review($1)', [
          JSON.stringify(
            items.map((item, i) => ({
              ...item,
              version: i ? 999 : item.version
            }))
          )
        ]),
      /Version conflict/
    )
    assert.equal(
      await scalar<number>(
        "select count(*)::integer as v from tourism_entities where id=any($1::uuid[]) and status='VERIFIED'",
        [ids]
      ),
      0
    )
    assert.equal(
      await scalar<number>('select tourism_bulk_review($1) as v', [
        JSON.stringify(items)
      ]),
      2
    )
    assert.equal(
      await scalar<number>('select count(*)::integer as v from contacts'),
      contacts
    )
  }))
test('canonical consolidation is reversible without moving evidence and rejects stale undo', () =>
  researchTransaction(async () => {
    const [duplicate, canonical] = await researchEntities()
    const before = await scalar<number>(
      'select count(*)::integer as v from tourism_evidence where entity_id=$1',
      [duplicate]
    )
    const link = await scalar(
      'select tourism_set_canonical($1,$2,1,1,$3) as v',
      [duplicate, canonical, 'Same legal entity, confirmed in source']
    )
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        duplicate
      ]),
      'DUPLICATE'
    )
    assert.equal(
      await scalar<number>(
        'select count(*)::integer as v from tourism_evidence where entity_id=$1',
        [duplicate]
      ),
      before
    )
    await db.query('select tourism_undo_canonical($1)', [link])
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        duplicate
      ]),
      'UNVERIFIED'
    )
    const version = await scalar<number>(
      'select version as v from tourism_entities where id=$1',
      [duplicate]
    )
    const link2 = await scalar(
      'select tourism_set_canonical($1,$2,$3,1,$4) as v',
      [duplicate, canonical, version, 'Same legal entity, confirmed in source']
    )
    await db.query(
      "update tourism_entities set status='NEEDS_REVIEW' where id=$1",
      [duplicate]
    )
    await rejectedStatement(
      () => db.query('select tourism_undo_canonical($1)', [link2]),
      /Version conflict/
    )
  }))
test('commercial dossiers remain research until identity is verified and CRM-linked, with project lifecycle separate', () =>
  researchTransaction(async () => {
    const [eid] = await researchEntities()
    const opportunity = await scalar(
      "insert into tourism_project_opportunities(user_id,entity_id,title,source_url,rationale) values($1,$2,'Destination map','https://research.example.org/','Public catalogue observed; review needed') returning id as v",
      [OWNER, eid]
    )
    await rejectedStatement(
      () =>
        db.query(
          "update tourism_project_opportunities set stage='meeting' where id=$1",
          [opportunity]
        ),
      /Verified organization linked to CRM required/
    )
    await rejectedStatement(
      () =>
        db.query(
          "update tourism_project_opportunities set project_status='active',platform_project_url='https://guides.speaqi.com/project' where id=$1",
          [opportunity]
        ),
      /Verified organization linked to CRM required/
    )
    await verify(eid)
    await db.query('select tourism_promote($1)', [eid])
    await db.query(
      "update tourism_project_opportunities set stage='meeting' where id=$1",
      [opportunity]
    )
    await rejectedStatement(
      () =>
        db.query(
          "update tourism_project_opportunities set project_status='trial' where id=$1",
          [opportunity]
        ),
      /check constraint/
    )
    await db.query(
      "update tourism_project_opportunities set project_status='trial',platform_project_url='https://guides.speaqi.com/project' where id=$1",
      [opportunity]
    )
    const summary = await scalar<any>('select tourism_research_overview() as v')
    assert.equal(summary.stages.meeting, 1)
    assert.equal(summary.project_statuses.trial, 1)
    assert.equal(summary.coverage[0].official_denominator, null)
  }))

test('directory disable is reversible, preserves verified evidence and cancels future site work', () =>
  researchTransaction(async () => {
    const e = normalizeRecord({
      ...records[0],
      name: 'Target toggle fixture',
      website: 'https://target.example.org/'
    })
    const eid = (await importRecords([e], []))!.ids[0]
    await verify(eid)
    const sid = await scalar(
      "insert into tourism_site_sources(user_id,entity_id,url,label,country_code,enabled,qualification_pending) values($1,$2,'https://target.example.org/','Target fixture','IT',true,true) returning id as v",
      [OWNER, eid]
    )
    const version = await scalar<number>(
      'select version as v from tourism_entities where id=$1',
      [eid]
    )
    await db.query('select tourism_toggle_entity($1,$2,true)', [eid, version])
    assert.equal(
      await scalar<boolean>(
        'select disabled as v from tourism_entities where id=$1',
        [eid]
      ),
      true
    )
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        eid
      ]),
      'VERIFIED'
    )
    assert.equal(
      await scalar(
        'select status as v from tourism_evidence where entity_id=$1 limit 1',
        [eid]
      ),
      'VERIFIED'
    )
    assert.equal(
      await scalar<boolean>(
        'select excluded as v from tourism_site_sources where id=$1',
        [sid]
      ),
      true
    )
    assert.equal(
      await scalar('select tourism_claim_site($1) as v', [sid]),
      null
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_toggle_entity($1,$2,false)', [eid, version]),
      /Version conflict/
    )
    await db.query('select tourism_toggle_entity($1,$2,false)', [
      eid,
      version + 1
    ])
    assert.equal(
      await scalar<boolean>(
        'select disabled as v from tourism_entities where id=$1',
        [eid]
      ),
      false
    )
    assert.equal(
      await scalar<boolean>(
        'select qualification_pending as v from tourism_site_sources where id=$1',
        [sid]
      ),
      true
    )
    await asUser(OTHER)
    await rejectedStatement(
      () =>
        db.query('select tourism_toggle_entity($1,$2,true)', [
          eid,
          version + 2
        ]),
      /Entity not found/
    )
    await asUser(OWNER)
  }))

test('all-URL qualification includes DMC and OTA, deduplicates identical URLs and respects manual exclusions', () =>
  researchTransaction(async () => {
    const input = ['DMC', 'OTA', 'Disabled'].map((n, i) =>
      normalizeRecord({
        ...records[0],
        name: 'All URLs ' + n,
        type_code: i === 1 ? 'ota' : 'dmc',
        website:
          i === 2
            ? 'https://disabled.example.org/'
            : 'https://incoming.example.org/'
      })
    )
    const ids = (await importRecords(input, []))!.ids
    await db.query('select tourism_toggle_entity($1,1,true)', [ids[2]])
    const result = await scalar<any>('select tourism_queue_site_checks() as v')
    assert.ok(result.queued >= 1)
    assert.equal(
      await scalar<number>(
        "select count(*)::int as v from tourism_site_sources where url='https://incoming.example.org/'"
      ),
      1
    )
    assert.equal(
      await scalar<number>(
        "select count(*)::int as v from tourism_site_sources where url='https://disabled.example.org/'"
      ),
      0
    )
    await db.query(
      "update tourism_site_sources set excluded=true,exclusion_origin='manual',qualification_pending=false where url='https://incoming.example.org/'"
    )
    await db.query('select tourism_queue_site_checks()')
    assert.equal(
      await scalar<boolean>(
        "select qualification_pending as v from tourism_site_sources where url='https://incoming.example.org/'"
      ),
      false
    )
  }))

test('a source shared by two records remains available until both are disabled', () =>
  researchTransaction(async () => {
    const ids = (await importRecords(
      ['A', 'B'].map((n) =>
        normalizeRecord({
          ...records[0],
          name: 'Shared target ' + n,
          website: 'https://shared-target.example.org/'
        })
      ),
      []
    ))!.ids
    await db.query('select tourism_queue_site_checks()')
    await db.query('select tourism_toggle_entity($1,1,true)', [ids[0]])
    assert.equal(
      await scalar<boolean>(
        "select excluded as v from tourism_site_sources where url='https://shared-target.example.org/'"
      ),
      false
    )
    await db.query('select tourism_toggle_entity($1,1,true)', [ids[1]])
    assert.equal(
      await scalar<boolean>(
        "select excluded as v from tourism_site_sources where url='https://shared-target.example.org/'"
      ),
      true
    )
  }))

test('qualification persists its reasons without verifying organizations or changing human exclusion', () =>
  researchTransaction(async () => {
    const record = normalizeRecord({
      ...records[0],
      name: 'Qualified incoming fixture',
      website: 'https://research.example.org/'
    })
    const eid = (await importRecords([record], []))!.ids[0]
    const sid = await researchSource()
    await db.query(
      'update tourism_site_sources set qualification_pending=true where id=$1',
      [sid]
    )
    const claim = await scalar<any>('select tourism_claim_site($1) as v', [sid])
    const report = {
      ...researchReport(),
      sitemap: { status: 'found', enumeration_complete: true },
      target_check: {
        classification: 'incoming_likely',
        evidence: [
          {
            url: 'https://research.example.org/',
            signal: 'Incoming tour operator',
            kind: 'incoming_self_description'
          }
        ]
      }
    }
    await db.query('select tourism_finish_site($1,$2,$3,$4)', [
      sid,
      claim.lease_token,
      JSON.stringify(report),
      '{}'
    ])
    assert.equal(
      await scalar(
        "select site_qualification->>'classification' as v from tourism_entities where id=$1",
        [eid]
      ),
      'incoming_likely'
    )
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        eid
      ]),
      'UNVERIFIED'
    )
    assert.equal(
      await scalar<boolean>(
        'select disabled as v from tourism_entities where id=$1',
        [eid]
      ),
      false
    )
    assert.equal(
      await scalar<boolean>(
        'select qualification_pending as v from tourism_site_sources where id=$1',
        [sid]
      ),
      false
    )
    assert.ok(
      await scalar(
        'select qualification_checked_at as v from tourism_site_sources where id=$1',
        [sid]
      )
    )
    assert.equal(
      await scalar<boolean>(
        "select has_table_privilege('authenticated','tourism_site_work_queue','SELECT') as v"
      ),
      false
    )
  }))

test('outreach priority is a commercial flag: it never touches verification', () =>
  researchTransaction(async () => {
    const e = normalizeRecord({
      ...records[0],
      name: 'Outreach priority fixture',
      website: 'https://outreach.example.org/'
    })
    const eid = (await importRecords([e], []))!.ids[0]
    await verify(eid)
    const version = await scalar<number>(
      'select version as v from tourism_entities where id=$1',
      [eid]
    )
    await db.query('select tourism_set_outreach($1,$2,1::smallint,$3)', [
      eid,
      version,
      'Nessuna guida multilingue ufficiale'
    ])
    assert.equal(
      await scalar<number>(
        'select outreach_priority as v from tourism_entities where id=$1',
        [eid]
      ),
      1
    )
    assert.equal(
      await scalar('select status as v from tourism_entities where id=$1', [
        eid
      ]),
      'VERIFIED'
    )
    assert.equal(
      await scalar(
        'select status as v from tourism_evidence where entity_id=$1 limit 1',
        [eid]
      ),
      'VERIFIED'
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_set_outreach($1,$2,2::smallint)', [
          eid,
          version
        ]),
      /Version conflict/
    )
    await rejectedStatement(
      () =>
        db.query('select tourism_set_outreach($1,$2,4::smallint)', [
          eid,
          version + 1
        ]),
      /Priority must be 1, 2 or 3/
    )
    // Without a new note the previous one stays; leaving the list clears it.
    await db.query('select tourism_set_outreach($1,$2,2::smallint)', [
      eid,
      version + 1
    ])
    assert.equal(
      await scalar(
        'select outreach_note as v from tourism_entities where id=$1',
        [eid]
      ),
      'Nessuna guida multilingue ufficiale'
    )
    await db.query('select tourism_set_outreach($1,$2,null)', [
      eid,
      version + 2
    ])
    assert.equal(
      await scalar(
        "select outreach_priority is null and outreach_note='' as v from tourism_entities where id=$1",
        [eid]
      ),
      true
    )
    await asUser(OTHER)
    await rejectedStatement(
      () =>
        db.query('select tourism_set_outreach($1,$2,1::smallint)', [
          eid,
          version + 3
        ]),
      /Entity not found/
    )
    await asUser(OWNER)
  }))
