import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222'
const external = '33333333-3333-4333-8333-333333333333',
  internal = '44444444-4444-4444-8444-444444444444'
const extMember = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  intMember = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  foreignMember = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'
const entity = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001',
  entity2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'
let db: PGlite, item: string, portfolio: string, child: string
const asUser = (id: string) =>
  db.exec(
    `reset role; set request.jwt.claim.sub='${id}';set role authenticated;`,
  )
async function scalar<T = string>(sql: string, args: unknown[] = []) {
  return (await db.query<{ v: T }>(sql, args)).rows[0]?.v
}
async function create(
  title: string,
  member: string | null = extMember,
  parent: string | null = null,
) {
  return (
    await db.query<{ id: string }>(
      `insert into tourism_work_items(user_id,kind,title,responsible_id,parent_id,next_action,due_on)
    values($1,'partner',$2,$3,$4,'Chiamare il referente',(now() at time zone 'UTC')::date) returning id`,
      [owner, title, member, parent],
    )
  ).rows[0].id
}
before(async () => {
  db = new PGlite()
  await db.exec(`create schema auth;create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}','owner@example.org'),('${other}','other@example.org'),('${external}','external@example.org'),('${internal}','internal@example.org');
    create table team_members(id uuid primary key,user_id uuid not null references auth.users(id),auth_user_id uuid,email text,name text,allowed_areas text[]);
    insert into team_members values('${extMember}','${owner}','${external}','external@example.org','Partner',null),('${intMember}','${owner}','${internal}','internal@example.org','Collega','{}'),('${foreignMember}','${other}',null,'other@example.org','Estraneo',null);
    alter table team_members enable row level security;
    create policy owner on team_members for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy self on team_members for select to authenticated using(auth_user_id=auth.uid());
    grant select,insert,update,delete on team_members to authenticated;
    create table contacts(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),name text not null,company text,country text,email text,phone text,status text,source text,contact_scope text,marketing_eligibility text,legacy_id text,note text,updated_at timestamptz default now(),unique(user_id,legacy_id));
    create table activities(id uuid primary key default gen_random_uuid(),user_id uuid not null,contact_id uuid references contacts(id),type text,content text);
    grant select,insert,update,delete on contacts,activities to authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant all on functions to anon,authenticated;
    alter default privileges in schema public grant all on sequences to anon,authenticated;`)
  for (const path of [
    'supabase/migrations/20261017205455_tourism_intelligence.sql',
    'supabase/migrations/20261018185155_tourism_site_research.sql',
    'scripts/sql/tourism-work.sql',
  ]) {
    await db.exec(
      await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
    )
  }
  await asUser(owner)
  await db.exec(
    `insert into tourism_entities(id,user_id,kind,name,country_code,type_code) values('${entity}','${owner}','organization','Partner turismo','IT','dmo'),('${entity2}','${owner}','organization','Partner secondo','IT','dmo');`,
  )
})
after(async () => {
  await db.close()
})

test('profili collegati al team, senza privilegi incrociati; abilita anche la navigazione', async () => {
  await asUser(owner)
  await assert.rejects(
    db.query(
      `insert into tourism_work_members(member_id,user_id) values($1,$2)`,
      [foreignMember, owner],
    ),
    /altro workspace/,
  )
  await db.query(
    `insert into tourism_work_members(member_id,user_id,access_kind) values($1,$3,'external'),($2,$3,'internal')`,
    [extMember, intMember, owner],
  )
  assert.equal(
    await scalar<boolean>(
      `select 'tourism'=any(allowed_areas) as v from team_members where id=$1`,
      [extMember],
    ),
    true,
  )
  assert.equal(
    await scalar<boolean>(
      `select 'pipeline'=any(allowed_areas) as v from team_members where id=$1`,
      [extMember],
    ),
    true,
  )
  assert.equal(
    await scalar<boolean>(
      `select 'pipeline'=any(allowed_areas) as v from team_members where id=$1`,
      [intMember],
    ),
    false,
  )
  item = await create('Ente assegnato')
  await asUser(external)
  assert.equal(
    await scalar(`select tourism_work_identity($1)->>'member_id' as v`, [
      owner,
    ]),
    extMember,
  )
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_work_items`),
    1,
  )
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_entities`),
    0,
  )
  await assert.rejects(
    db.query(
      `insert into tourism_work_members(member_id,user_id) values($1,$2)`,
      [foreignMember, owner],
    ),
    /row-level/,
  )
})
test('il partner aggiorna stato, scadenza e presa in carico, ma non può riassegnare o alterare il contesto', async () => {
  await asUser(external)
  await db.query(
    `update tourism_work_items set stage='contact',next_action='Richiamare venerdì',acknowledged_at=now() where id=$1`,
    [item],
  )
  assert.equal(
    await scalar<number>(
      `select version as v from tourism_work_items where id=$1`,
      [item],
    ),
    2,
  )
  await assert.rejects(
    db.query(`update tourism_work_items set responsible_id=$2 where id=$1`, [
      item,
      intMember,
    ]),
    /proprietario/,
  )
  await assert.rejects(
    db.query(
      `update tourism_work_items set shared_context='Riscritto' where id=$1`,
      [item],
    ),
    /proprietario/,
  )
  await assert.rejects(
    db.query(`update tourism_work_items set version=99 where id=$1`, [item]),
    /Versione gestita/,
  )
  await assert.rejects(
    db.query(`select tourism_work_handoff($1,2,$2,'{}')`, [item, intMember]),
    /non trovata/,
  )
})
test('note e documenti interni restano invisibili al partner, anche via PostgREST diretto', async () => {
  await asUser(owner)
  await db.query(
    `update tourism_work_items set collaborator_ids=array[$2::uuid] where id=$1`,
    [item, intMember],
  )
  await db.query(
    `insert into tourism_work_notes(user_id,item_id,body,visibility,document_url) values($1,$2,'Nota riservata','internal','https://example.org/interno')`,
    [owner, item],
  )
  await db.query(
    `insert into tourism_work_notes(user_id,item_id,body,visibility) values($1,$2,'Prossimo incontro','shared')`,
    [owner, item],
  )
  await asUser(external)
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_work_notes`),
    1,
  )
  await assert.rejects(
    db.query(
      `insert into tourism_work_notes(user_id,item_id,body,visibility) values($1,$2,'Tentativo','internal')`,
      [owner, item],
    ),
    /row-level/,
  )
  await db.query(
    `insert into tourism_work_notes(user_id,item_id,body,visibility) values($1,$2,'Risposta del partner','shared')`,
    [owner, item],
  )
  await asUser(internal)
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_work_notes`),
    3,
  )
  assert.ok(
    (await scalar<number>(
      `select count(*)::int as v from tourism_work_events`,
    )) > 2,
  )
  await assert.rejects(
    db.exec(
      `insert into tourism_work_events(user_id,item_id,actor_id,event) values('${owner}','${item}','${internal}','Falso')`,
    ),
    /permission denied/,
  )
})
test('isolamento fra workspace e schede non assegnate, anche su note e storico', async () => {
  await asUser(other)
  for (const table of [
    'tourism_work_items',
    'tourism_work_notes',
    'tourism_work_events',
    'tourism_work_members',
    'tourism_work_rules',
  ]) {
    assert.equal(
      await scalar<number>(`select count(*)::int as v from ${table}`),
      0,
    )
  }
  assert.equal(
    await scalar<number>(
      `select (tourism_work_summary($1)->>'open')::int as v`,
      [owner],
    ),
    0,
  )
  await asUser(owner)
  const hidden = await create('Non assegnato al partner', intMember)
  await asUser(external)
  assert.equal(
    await scalar<number>(
      `select count(*)::int as v from tourism_work_items where id=$1`,
      [hidden],
    ),
    0,
  )
  await assert.rejects(
    db.query(
      `insert into tourism_work_notes(user_id,item_id,body,visibility) values($1,$2,'Spiare una scheda','shared')`,
      [owner, hidden],
    ),
    /row-level/,
  )
})
test('passaggio del portafoglio atomico, eredità sulle nuove schede e storico conservato', async () => {
  await asUser(owner)
  portfolio = await create('Portafoglio Italia', extMember)
  child = await create('Figlio del portafoglio', intMember, portfolio)
  assert.equal(
    await scalar(
      `select responsible_id as v from tourism_work_items where id=$1`,
      [child],
    ),
    extMember,
  )
  await db.query(`select tourism_work_handoff($1,1,$2,'{}')`, [
    portfolio,
    intMember,
  ])
  assert.equal(
    await scalar<number>(
      `select count(*)::int as v from tourism_work_items where id=any($1::uuid[]) and responsible_id=$2`,
      [[portfolio, child], intMember],
    ),
    2,
  )
  await assert.rejects(
    db.query(`select tourism_work_handoff($1,1,$2,'{}')`, [
      portfolio,
      extMember,
    ]),
    /Version conflict/,
  )
  await assert.rejects(
    db.query(`select tourism_work_handoff($1,2,$2,'{}')`, [
      portfolio,
      foreignMember,
    ]),
    /altro workspace/,
  )
  assert.equal(
    await scalar(
      `select responsible_id as v from tourism_work_items where id=$1`,
      [child],
    ),
    intMember,
  )
  await asUser(external)
  assert.equal(
    await scalar<number>(
      `select count(*)::int as v from tourism_work_items where id=any($1::uuid[])`,
      [[portfolio, child]],
    ),
    0,
  )
})
test('no cicli, niente portafogli annidati o responsabilità tra tenant', async () => {
  await asUser(owner)
  await assert.rejects(
    db.query(`update tourism_work_items set parent_id=id where id=$1`, [
      portfolio,
    ]),
    /Portafoglio/,
  )
  await assert.rejects(
    create('Nipote non ammesso', extMember, child),
    /Portafoglio/,
  )
  await assert.rejects(
    create('Responsabile estraneo', foreignMember),
    /altro workspace/,
  )
})
test('regole per territorio e segmento bilanciano il carico; reimport idempotente', async () => {
  await asUser(owner)
  const rule = await scalar(
    `insert into tourism_work_rules(user_id,name,country_code,segment,member_ids) values($1,'Italia DMO','IT','dmo',array[$2::uuid,$3::uuid]) returning id as v`,
    [owner, extMember, intMember],
  )
  assert.equal(
    await scalar<number>(
      `select tourism_work_assign_entities($1,null,$2,null,'Qualificare il referente',current_date+1) as v`,
      [[entity, entity2], rule],
    ),
    2,
  )
  assert.equal(
    await scalar<number>(
      `select tourism_work_assign_entities($1,null,$2,null,'Nuova azione',current_date+1) as v`,
      [[entity, entity2], rule],
    ),
    0,
  )
  assert.equal(
    await scalar<number>(
      `select count(*)::int as v from tourism_work_items where entity_id=any($1::uuid[])`,
      [[entity, entity2]],
    ),
    2,
  )
  await assert.rejects(
    db.query(
      `insert into tourism_work_rules(user_id,name,member_ids) values($1,'Regola errata',array[$2::uuid])`,
      [owner, foreignMember],
    ),
    /altro workspace/,
  )
  await assert.rejects(
    db.query(
      `select tourism_work_assign_entities($1,null,$2,null,'Azione',current_date+1)`,
      [[], rule],
    ),
    /Selezionare/,
  )
})
test('segnale tracciato senza duplicati, checklist validata e aggiornabile dal partner', async () => {
  await asUser(owner)
  const signal = await scalar(
    `insert into tourism_project_opportunities(user_id,entity_id,title,source_url,rationale) values($1,$2,'Nuova guida multilingua','https://example.org/fonte','Segnale da verificare con il referente') returning id as v`,
    [owner, entity],
  )
  const work = await scalar(
    `insert into tourism_work_items(user_id,kind,title,entity_id,source_opportunity_id,source_key,responsible_id,next_action,due_on,checklist) values($1,'opportunity','Verifica segnale',$2,$3,$4,$5,'Verificare la fonte',current_date+1,'[{"label":"Verificare la fonte","done":false}]') returning id as v`,
    [owner, entity, signal, `signal:${signal}`, extMember],
  )
  await assert.rejects(
    db.query(
      `insert into tourism_work_items(user_id,kind,title,source_key,next_action,due_on) values($1,'opportunity','Duplicato',$2,'Verificare',current_date+1)`,
      [owner, `signal:${signal}`],
    ),
    /unique constraint/,
  )
  await asUser(external)
  await db.query(
    `update tourism_work_items set checklist='[{"label":"Verificare la fonte","done":true}]' where id=$1`,
    [work],
  )
  assert.equal(
    await scalar<boolean>(
      `select (checklist->0->>'done')::boolean as v from tourism_work_items where id=$1`,
      [work],
    ),
    true,
  )
  await assert.rejects(
    db.query(
      `update tourism_work_items set checklist='[{"label":"Verificare la fonte","done":"yes"}]' where id=$1`,
      [work],
    ),
    /Checklist non valida/,
  )
})

test('attesa e archiviazione richiedono motivo; ogni scheda aperta richiede una scadenza', async () => {
  await asUser(owner)
  await assert.rejects(
    db.query(
      `update tourism_work_items set stage='waiting',reason='' where id=$1`,
      [item],
    ),
    /check constraint/,
  )
  await assert.rejects(
    db.query(`update tourism_work_items set due_on=null where id=$1`, [item]),
    /check constraint/,
  )
  await db.query(
    `update tourism_work_items set stage='archived',reason='Non pertinente',due_on=null where id=$1`,
    [item],
  )
})
test('revoca profilo e revoca area negano immediatamente lettura e scrittura', async () => {
  await asUser(owner)
  await db.query(
    `update tourism_work_members set enabled=false where member_id=$1`,
    [extMember],
  )
  await asUser(external)
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_work_items`),
    0,
  )
  await asUser(owner)
  await db.query(
    `update tourism_work_members set enabled=true where member_id=$1`,
    [extMember],
  )
  await db.query(`update team_members set allowed_areas='{}' where id=$1`, [
    extMember,
  ])
  await asUser(external)
  assert.equal(
    await scalar<number>(`select count(*)::int as v from tourism_work_items`),
    0,
  )
})
test('anonimo senza grant e funzioni private non invocabili', async () => {
  await db.exec(`reset role;set request.jwt.claim.sub='';set role anon;`)
  await assert.rejects(
    db.exec('select * from tourism_work_items'),
    /permission denied/,
  )
  await assert.rejects(
    db.exec(`select tourism_work_identity('${owner}')`),
    /permission denied/,
  )
  await asUser(owner)
  await assert.rejects(
    db.exec('select tourism_private.work_audit()'),
    /permission denied/,
  )
})
