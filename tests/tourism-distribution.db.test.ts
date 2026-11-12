import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { parseDistributionFilters, tierOf, weightedScore, SCORE_WEIGHTS, distributionCsv, coverageGaps } from '../src/lib/tourism-distribution'

// Speaqi Guides — Distribution Opportunities: il punteggio lo calcola il database
// (migration vera, PGlite), la pagina lo rilegge. Qui si prova che cio' che fa il
// database coincide con i pesi dichiarati, che un dato ignoto non si inventa e che
// il lavoro di una persona (stato, note) sopravvive a un ricalcolo.

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let db: PGlite
const asUser = (id: string) => db.exec(`reset role;set request.jwt.claim.sub='${id}';set role authenticated;`)
const migration = async (name: string) =>
  db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))

type Row = { name: string; score: number; tier: string; components: Record<string, number>; guide_slugs: string[]; model: string; quick_win: boolean; strategic: boolean; commercial_status: string }
async function rows() {
  return (await db.query<Row>(
    `select e.name, d.score, d.tier, d.components, d.guide_slugs, d.model, d.quick_win, d.strategic, d.commercial_status
       from tourism_distribution d join tourism_entities e on e.id = d.entity_id order by e.name`,
  )).rows
}
const byName = (list: Row[], name: string) => {
  const row = list.find((r) => r.name === name)
  assert.ok(row, `manca ${name}`)
  return row
}

async function entity(user: string, name: string, type: string, country: string, extra: { email?: string; phone?: string; website?: string; details?: object } = {}) {
  await db.exec('reset role')
  const r = await db.query<{ id: string }>(
    `insert into tourism_entities(user_id,kind,name,country_code,type_code,status,email,phone,website,details)
     values($1,'organization',$2,$3,$4,'UNVERIFIED',$5,$6,$7,$8) returning id`,
    [user, name, country, type, extra.email ?? null, extra.phone ?? null, extra.website ?? null, JSON.stringify(extra.details ?? {})],
  )
  return r.rows[0].id
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
    '20261104090000_tourism_distribution.sql',
    '20261104100000_tourism_distribution_summary.sql',
    '20261104110000_tourism_distribution_signals.sql',
    '20261104120000_tourism_distribution_italy_signal.sql',
    '20261104130000_tourism_distribution_flags.sql',
  ])
    await migration(name)

  // Il riferimento «Dimorra»: property manager a Napoli, piccolo, con recapiti.
  await entity(OWNER, 'Dimorra Test', 'property_manager', 'IT', {
    email: 'info@dimorra.test', phone: '+39 081 000000', website: 'https://dimorra.test',
    details: { hq_city: 'Napoli', hq_region: 'Campania', employees: '1-10', description: 'Gestione di case vacanza a Napoli' },
  })
  // Il riferimento «SNAV»: traghetti che toccano Napoli.
  await entity(OWNER, 'SNAV Test', 'ferry_operator', 'IT', { email: 'info@snav.test', website: 'https://snav.test', details: { calls_naples: true } })
  // Un tour operator americano che dice di vendere l'Italia: nessuna citta' certa.
  await entity(OWNER, 'US Italy Tours', 'tour_operator', 'US', { website: 'https://usitaly.test', details: { description: 'Custom Italy vacations', employees: '11-50' } })
  // Una compagnia aerea con un collegamento verso NAP e FCO.
  const air = await entity(OWNER, 'Test Air', 'airline', 'DE', { website: 'https://testair.test' })
  // Un'azienda lontana da tutto.
  await entity(OWNER, 'Lontana Srl', 'dmc', 'JP', { details: { description: 'Incoming a Kyoto' } })
  // Specialisti con destinazioni vendute provate da una ricerca (segnali con fonte).
  const us = await entity(OWNER, 'Roma Firenze Tours', 'tour_operator', 'US', { website: 'https://romafirenze.test', details: { employees: '11-50' }, email: 'info@romafirenze.test' })
  const generic = await entity(OWNER, 'Italy Generic Travel', 'tour_operator', 'US', { website: 'https://italygeneric.test', details: { employees: '1-10' } })
  await db.query(`insert into tourism_distribution_destinations(entity_id,slug,user_id,source) values ($1,'roma',$3,'prova'),($1,'firenze',$3,'prova'),($2,'italia',$3,'prova')`, [us, generic, OWNER])
  // Una grande compagnia di crociera e una piccola con la sede a Napoli.
  await entity(OWNER, 'Grande Crociera', 'cruise_line', 'US', { email: 'info@crociera.test', website: 'https://crociera.test', details: { calls_naples: true, employees: '10001+' } })
  // Di un altro proprietario: non deve mai comparire.
  await entity(OTHER, 'Altrui', 'dmc', 'IT', { details: { hq_city: 'Roma' } })

  for (const [slug, iata] of [['napoli-capodichino', 'NAP'], ['roma-fiumicino', 'FCO']]) {
    await db.query(`insert into tourism_hubs(user_id,mode,slug,name,country,iata) values($1,'air',$2,$3,'IT',$4)`, [OWNER, slug, `Aeroporto ${iata}`, iata])
  }
  await db.query(
    `insert into tourism_hub_operators(user_id,hub_id,entity_id,role)
     select $1, h.id, $2, 'route' from tourism_hubs h where h.user_id = $1`,
    [OWNER, air],
  )
  await asUser(OWNER)
  await db.exec('select tourism_distribution_recompute()')
})

test('un dato presente pesa, uno ignoto vale poco: Dimorra e SNAV in testa', async () => {
  const list = await rows()
  const dimorra = byName(list, 'Dimorra Test')
  const snav = byName(list, 'SNAV Test')
  const us = byName(list, 'US Italy Tours')
  const far = byName(list, 'Lontana Srl')
  assert.deepEqual(dimorra.guide_slugs, ['napoli'])
  assert.equal(dimorra.components.destinations, 100)
  assert.equal(snav.components.destinations, 92)
  assert.deepEqual(snav.guide_slugs, ['napoli'])
  assert.ok(dimorra.score > us.score && snav.score > us.score)
  assert.ok(us.score > far.score)
  // Un tour operator estero senza citta' non ha destinazioni certe, e il punteggio lo dice.
  assert.equal(us.components.destinations, 30)
  assert.deepEqual(us.guide_slugs, [])
})

test('una compagnia aerea eredita le guide dagli aeroporti che serve', async () => {
  const air = byName(await rows(), 'Test Air')
  assert.ok(air.guide_slugs.includes('roma'))
  assert.ok(['napoli', 'capri', 'costiera-amalfitana', 'pompei'].every((s) => air.guide_slugs.includes(s)))
  assert.equal(air.components.destinations, 78)
  assert.equal(air.model, 'bundle')
})

test('il punteggio del database è la somma pesata dichiarata nella libreria', async () => {
  assert.equal(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0), 100)
  for (const row of await rows()) {
    const expected = weightedScore({
      destinations: row.components.destinations, distribution: row.components.distribution,
      commercial: row.components.commercial, activation: row.components.activation,
      contacts: row.components.contacts, complementary: row.components.complementary,
    })
    assert.equal(row.score, expected, row.name)
    assert.equal(row.tier, tierOf(row.score), row.name)
  }
})

test('un ricalcolo non cancella stato e note di chi lavora', async () => {
  await asUser(OWNER)
  await db.exec(`update tourism_distribution set commercial_status = 'negotiating', notes = 'Call fissata' where entity_id = (select id from tourism_entities where name = 'SNAV Test')`)
  await db.exec('select tourism_distribution_recompute()')
  const snav = (await db.query<{ commercial_status: string; notes: string }>(
    `select commercial_status, notes from tourism_distribution d join tourism_entities e on e.id = d.entity_id where e.name = 'SNAV Test'`,
  )).rows[0]
  assert.equal(snav.commercial_status, 'negotiating')
  assert.equal(snav.notes, 'Call fissata')
  assert.equal((await rows()).length, 8)
})

test('ogni proprietario vede solo i suoi prospect', async () => {
  await asUser(OTHER)
  await db.exec('select tourism_distribution_recompute()')
  const mine = await rows()
  assert.deepEqual(mine.map((r) => r.name), ['Altrui'])
  await asUser(OWNER)
  assert.ok(!(await rows()).some((r) => r.name === 'Altrui'))
  const summary = (await db.query<{ s: { total: number } }>(`select tourism_distribution_summary() as s`)).rows[0].s
  assert.equal(summary.total, 8)
})

test('il riepilogo conta guide, categorie e celle della matrice', async () => {
  await asUser(OWNER)
  const s = (await db.query<{ s: any }>(`select tourism_distribution_summary() as s`)).rows[0].s
  const napoli = s.by_slug.find((x: { slug: string }) => x.slug === 'napoli')
  assert.ok(napoli.total >= 3)
  assert.ok(s.matrix.some((c: { slug: string; type: string }) => c.slug === 'napoli' && c.type === 'property_manager'))
  const gaps = coverageGaps(s.matrix, ['property_manager'], 3)
  assert.ok(gaps.some((g) => g.slug === 'pompei'))
})

test('i filtri dell’URL scartano ciò che non riconoscono', () => {
  const f = parseDistributionFilters(new URLSearchParams('slug=atlantide&tier=a,x,B&model=boh&limit=99999&min_score=500&contact=email&type=dmc,DROP TABLE'))
  assert.equal(f.slug, null)
  assert.deepEqual(f.tiers, ['A', 'B'])
  assert.equal(f.model, null)
  assert.equal(f.limit, 5000)
  assert.equal(f.minScore, 100)
  assert.equal(f.contact, 'email')
  assert.deepEqual(f.types, ['dmc'])
})

test('il CSV disinnesca le formule e usa il punto e virgola', () => {
  const csv = distributionCsv([{
    entity_id: 'x', score: 80, tier: 'A', components: {}, completeness: 50, guide_slugs: ['roma'], volume_potential: 'high',
    model: 'resale', model_alt: null, strategic: false, quick_win: true, commercial_status: 'new', notes: null,
    entity: { name: '=SOMMA(A1)', type_code: 'dmc', country_code: 'IT', website: null, email: 'a@b.it', phone: null },
  }])
  assert.ok(csv.startsWith('﻿Azienda;'))
  assert.ok(csv.includes("'=SOMMA(A1);dmc;IT;80;A;Roma;Alto;Acquisto e rivendita"))
})

test('le destinazioni vendute provate pesano più di «Italia» generica, e «Italia» non è una guida', async () => {
  await asUser(OWNER)
  const list = await rows()
  const romaFirenze = byName(list, 'Roma Firenze Tours')
  const generic = byName(list, 'Italy Generic Travel')
  assert.deepEqual(romaFirenze.guide_slugs, ['firenze', 'roma'])
  assert.equal(romaFirenze.components.destinations, 88)
  assert.deepEqual(generic.guide_slugs, [])
  assert.equal(generic.components.destinations, 60)
  assert.ok(romaFirenze.score > generic.score)
})

test('un grande canale è strategico ma non attivabile subito; un piccolo operatore con email sì', async () => {
  await asUser(OWNER)
  const list = await rows()
  const crociera = byName(list, 'Grande Crociera')
  assert.equal(crociera.strategic, true)
  assert.equal(crociera.quick_win, false)
  const snav = byName(list, 'SNAV Test')
  assert.equal(snav.quick_win, true)
  assert.equal(snav.strategic, false)
})
