-- Porta le compagnie di navigazione in Tourism Intelligence (una volta sola,
-- ripetibile: un secondo lancio non crea doppioni).
-- Si incolla nella SQL editor di Supabase e gira come il proprietario delle
-- compagnie (stessa RLS di chi lavora nel CRM).
--
-- 1. le compagnie che non esistono ancora come ente diventano schede nuove
--    (cruise_line / ferry_operator), con sede, flotta e ufficio Italia;
-- 2. quelle gia' presenti (stesso nome, anche con un paese diverso) vengono
--    solo collegate e ricevono il tipo giusto;
-- 3. shipping_companies.entity_id punta alla scheda;
-- 4. ogni porto toccato dagli itinerari diventa un legame compagnia -> porto.
-- Le compagnie senza paese restano fuori e si vedono nell'ultima select.

begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.shipping_companies limit 1), true);
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from public.shipping_companies limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;

create temporary table ship_src on commit drop as
with cmap(raw, iso) as (values ('Algeria','DZ'),('Arabia Saudita','SA'),('Australia','AU'),('Austria','AT'),('China','CN'),('CL','CL'),('Cyprus','CY'),('Danimarca','DK'),('Denmark','DK'),('Estonia','EE'),('Finland','FI'),('Finlandia (Åland)','AX'),('France','FR'),('Francia','FR'),('French Polynesia','PF'),('Germany','DE'),('Greece','GR'),('India','IN'),('Isole Faroe','FO'),('Israel','IL'),('Italy','IT'),('Japan','JP'),('Malta','MT'),('Mexico','MX'),('Monaco','MC'),('Netherlands','NL'),('New Zealand','NZ'),('Norvegia','NO'),('Norway','NO'),('Peru','PE'),('Portugal','PT'),('Singapore','SG'),('Spain','ES'),('Svezia','SE'),('Switzerland','CH'),('Tunisia','TN'),('United Kingdom','GB'),('United States','US'),('US','US'),('Vietnam','VN'))
select c.id company_id, c.slug, c.name, c.website, c.phone, c.email,
  (select iso from cmap where raw = c.hq_country) cc,
  case when c.kind = 'ferry' then 'ferry_operator' else 'cruise_line' end type_code,
  coalesce((select s from unnest(c.sources) s where s ~ '^https?://' limit 1), c.website) source_url,
  jsonb_strip_nulls(jsonb_build_object('fleet_kind', c.kind, 'segment', c.segment, 'parent_group', c.parent_group,
    'hq_city', c.hq_city, 'hq_address', c.hq_address, 'fleet_size', c.fleet_size, 'italy_office', c.italy_office,
    'calls_naples', c.calls_naples, 'calls_civitavecchia', c.calls_civitavecchia)) details,
  (select e.id from public.tourism_entities e
     where e.user_id = c.user_id and e.kind = 'organization'
       and (e.external_ids->>'shipping_slug' = c.slug or e.name_key = public.tourism_name_key(c.name))
     order by (e.external_ids->>'shipping_slug' = c.slug) desc nulls last limit 1) existing_id
from public.shipping_companies c;

-- 1. schede nuove
select public.tourism_import(jsonb_agg(jsonb_build_object(
  'kind', 'organization', 'name', name, 'country_code', cc, 'type_code', type_code,
  'website', website, 'email', email, 'phone', phone, 'details', details,
  'external_ids', jsonb_build_object('shipping_slug', slug),
  'evidence', jsonb_build_object('source_url', source_url, 'title', name || ' · catalogo compagnie di navigazione',
    'excerpt', 'Catalogo Navigazione Speaqi (ricerca web, settembre 2026)', 'fields', jsonb_build_array('name','country_code','type_code'),
    'method', 'import'))))
from ship_src where existing_id is null and cc is not null and source_url is not null;

-- 2. schede gia' presenti: collegamento e tipo giusto
update public.tourism_entities e
   set external_ids = e.external_ids || jsonb_build_object('shipping_slug', s.slug),
       type_code = case when e.type_code in ('other','transport') then s.type_code else e.type_code end,
       details = s.details || e.details
  from ship_src s
 where s.existing_id = e.id and coalesce(e.external_ids->>'shipping_slug', '') <> s.slug;

insert into public.tourism_evidence(user_id, entity_id, source_url, title, excerpt, fields, method)
select auth.uid(), s.existing_id, s.source_url, s.name || ' · catalogo compagnie di navigazione',
       'Catalogo Navigazione Speaqi (ricerca web, settembre 2026)', array['name','type_code'], 'import'
  from ship_src s
 where s.existing_id is not null and s.source_url is not null
   and not exists (select 1 from public.tourism_evidence v where v.entity_id = s.existing_id and v.title like '%catalogo compagnie di navigazione');

-- 3. collegamento compagnia -> scheda
update public.shipping_companies c
   set entity_id = e.id
  from public.tourism_entities e
 where e.user_id = c.user_id and e.external_ids->>'shipping_slug' = c.slug
   and c.entity_id is distinct from e.id;

-- 4. compagnia -> porti toccati dagli itinerari
insert into public.tourism_hub_operators(user_id, hub_id, entity_id, role)
select distinct auth.uid(), st.port_id, c.entity_id, 'calls'
  from public.shipping_itinerary_stops st
  join public.shipping_itineraries i on i.id = st.itinerary_id
  join public.shipping_companies c on c.id = i.company_id
 where c.entity_id is not null
on conflict (user_id, hub_id, entity_id, role) do nothing;

select (select count(*) from public.shipping_companies) compagnie,
       (select count(entity_id) from public.shipping_companies) collegate,
       (select count(*) from public.tourism_entities where type_code in ('cruise_line','ferry_operator')) schede,
       (select count(distinct entity_id) from public.tourism_hub_operators) con_porti,
       (select count(*) from public.tourism_hub_operators) legami_porto,
       (select string_agg(name, ', ') from public.shipping_companies where entity_id is null) da_rivedere;
commit;
