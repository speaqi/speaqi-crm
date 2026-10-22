-- Tourism Intelligence 2: porti, aeroporti e stazioni in un'anagrafica sola,
-- destinazioni con i loro numeri, e la distribuzione (tour operator, OTA,
-- compagnie) come enti.
--
-- La domanda e' "quale citta' raccontiamo dopo, in quante lingue, e a chi la
-- vendiamo". Ci si arriva solo se il porto, l'aeroporto e la stazione che
-- portano visitatori in una citta' stanno nello stesso posto: Civitavecchia,
-- Fiumicino e Roma Termini servono la stessa guida di Roma.
--
-- - tourism_hubs: un hub di trasporto (`mode` sea|air|rail). Prende il posto di
--   shipping_ports (vedi la migration successiva, che ci sposta le righe).
--   Non passa dal regime di evidenze degli enti: nasce da dataset pubblici con
--   codici ufficiali (UN/LOCODE, IATA/ICAO, UIC), e ogni numero porta anno e fonte.
-- - tourism_destinations: i dati della destinazione accanto all'entita'
--   `kind='place'`, che resta la sua identita' (evidenze, revisioni, PART_OF).
-- - tourism_hub_operators: chi opera dove (una compagnia che fa scalo a un
--   porto, un vettore con base in un aeroporto), con ruolo e stagione.
-- - tourism_hub_destinations: le destinazioni AGGIUNTIVE di un hub che serve
--   piu' citta'. La principale e' tourism_hubs.destination_id e non si ripete.
-- - nuovi tipi in tassonomia per la distribuzione e due relazioni del grafo:
--   SELLS (un operatore vende una destinazione) e OPERATES_IN (ci ha attivita'
--   o alloggi: property manager, catene, DMC). Non esistono SERVES ne'
--   OPERATES_AT: hub → destinazione e operatore → hub hanno ciascuno un solo
--   posto autorevole, le due tabelle qui sotto.
--
-- Tre famiglie di numeri, mai sommate fra loro: arrivi turistici misurati
-- nella destinazione, traffico degli hub (accessibilita', non turisti) e stime
-- dichiarate con metodo e affidabilita'.

insert into public.tourism_taxonomy(code, labels, governance) values
 ('ota','{"it":"OTA · agenzia di viaggi online","en":"Online travel agency"}',false),
 ('tour_operator','{"it":"Tour operator","en":"Tour operator"}',false),
 ('wholesaler','{"it":"Wholesaler / grossista","en":"Wholesaler"}',false),
 ('travel_agency','{"it":"Rete di agenzie di viaggio","en":"Travel agency network"}',false),
 ('bedbank','{"it":"Bedbank","en":"Bedbank"}',false),
 ('experience_marketplace','{"it":"Marketplace di esperienze","en":"Experience marketplace"}',false),
 ('cruise_line','{"it":"Compagnia di crociera","en":"Cruise line"}',false),
 ('ferry_operator','{"it":"Compagnia di traghetti","en":"Ferry operator"}',false),
 ('airline','{"it":"Compagnia aerea","en":"Airline"}',false),
 ('rail_operator','{"it":"Operatore ferroviario","en":"Rail operator"}',false),
 ('bus_operator','{"it":"Operatore di autobus","en":"Bus operator"}',false)
on conflict (code) do nothing;

-- Un operatore vende una destinazione: la stessa forma di COVERS (organizzazione → luogo).
alter table public.tourism_relations drop constraint if exists tourism_relations_relation_check;
alter table public.tourism_relations add constraint tourism_relations_relation_check
  check (relation in ('PART_OF','COVERS','MANAGES','PROMOTES','SELLS','OPERATES_IN','OPERATES_BRAND','OPERATES_PORTAL','MEMBER_OF','PARTNER_OF','WORKS_FOR'));

create or replace function public.tourism_relation_guard() returns trigger
language plpgsql set search_path = public as $$
declare fk text; tk text; source_entity uuid;
begin
  if new.relation = 'PART_OF' then perform pg_advisory_xact_lock(hashtext(new.user_id::text||':tourism-geography')); end if;
  select kind into fk from public.tourism_entities where id = new.from_id and user_id = new.user_id;
  select kind into tk from public.tourism_entities where id = new.to_id and user_id = new.user_id;
  select entity_id into source_entity from public.tourism_evidence where id = new.evidence_id and user_id = new.user_id;
  if source_entity is distinct from new.from_id then raise exception 'Evidence must belong to source entity'; end if;
  if not exists(select 1 from public.tourism_evidence where id=new.evidence_id and fields && array['coverage','relationship']) then raise exception 'Relationship evidence required'; end if;
  if not (
    (new.relation = 'PART_OF' and fk = 'place' and tk = 'place') or
    (new.relation in ('COVERS','MANAGES','PROMOTES','SELLS','OPERATES_IN') and fk = 'organization' and tk = 'place') or
    (new.relation = 'OPERATES_BRAND' and fk = 'organization' and tk = 'brand') or
    (new.relation = 'OPERATES_PORTAL' and fk = 'organization' and tk = 'portal') or
    (new.relation in ('MEMBER_OF','PARTNER_OF') and fk = 'organization' and tk = 'organization') or
    (new.relation = 'WORKS_FOR' and fk = 'person' and tk = 'organization')
  ) then raise exception 'Invalid relationship types'; end if;
  if new.relation = 'PART_OF' and exists (
    with recursive ancestors(id) as (
      select new.to_id union select r.to_id from public.tourism_relations r join ancestors a on r.from_id = a.id
      where r.user_id = new.user_id and r.relation = 'PART_OF' and r.id <> new.id
    ) select 1 from ancestors where id = new.from_id
  ) then raise exception 'Geographic cycle'; end if;
  return new;
end $$;

create table public.tourism_hubs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode text not null check (mode in ('sea','air','rail')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  -- ISO 3166-1 alpha-2. Null se non noto.
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  aliases text[] not null default '{}',
  -- Codici ufficiali, uno per tipo: il modo piu' sicuro di riconoscere un hub.
  unlocode text check (unlocode is null or unlocode ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  iata text check (iata is null or iata ~ '^[A-Z0-9]{3}$'),
  icao text check (icao is null or icao ~ '^[A-Z0-9]{4}$'),
  uic text check (uic is null or uic ~ '^[0-9]{7,9}$'),
  -- Altri riferimenti (wikidata, ourairports, trainline): solo stringhe.
  external_ids jsonb not null default '{}' check (jsonb_typeof(external_ids) = 'object'),
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  region text check (region is null or char_length(btrim(region)) between 1 and 80),
  subregion text check (subregion is null or char_length(btrim(subregion)) between 1 and 120),
  -- La citta' che serve, scritta (resta finche' destination_id non e' risolto).
  destination text check (destination is null or char_length(btrim(destination)) between 1 and 160),
  destination_id uuid,
  -- large|medium|small: per gli aeroporti la classe OurAirports, per le stazioni i nodi principali.
  size text check (size is null or size in ('large','medium','small')),
  -- Passeggeri in un anno (porti: crocieristi movimentati; aeroporti: passeggeri totali; stazioni: frequentazione).
  passengers integer check (passengers is null or passengers >= 0),
  passengers_year smallint check (passengers_year is null or passengers_year between 1990 and 2100),
  -- Quota di passeggeri internazionali, 0-100, solo se pubblicata.
  intl_share numeric(5, 2) check (intl_share is null or intl_share between 0 and 100),
  -- Movimenti in un anno (porti: scali delle navi; aeroporti: voli).
  movements integer check (movements is null or movements >= 0),
  stats_source text,
  is_homeport boolean,
  scheduled_service boolean,
  -- Superguida Speaqi: sta qui solo finche' l'hub non e' collegato a una
  -- destinazione. Il collegamento (tourism_link_hub_destination) la sposta
  -- sulla destinazione, svuota questi campi e scrive guide_moved_at: da li' in
  -- poi ogni lettura prende la guida dalla destinazione.
  guide_status text not null default 'none' check (guide_status in ('none','planned','in_progress','live','skip')),
  guide_priority smallint check (guide_priority is null or guide_priority between 1 and 3),
  guide_notes text,
  guide_moved_at timestamptz,
  notes text,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, mode, slug),
  foreign key (user_id, destination_id) references public.tourism_entities(user_id, id) on delete set null (destination_id),
  -- Un numero senza anno non si confronta con niente.
  constraint tourism_hubs_passengers_need_year check (passengers is null or passengers_year is not null),
  constraint tourism_hubs_guide_priority_open check (guide_priority is null or guide_status in ('planned','in_progress')),
  -- Dopo il trasferimento sul porto non resta una seconda verita'.
  constraint tourism_hubs_guide_moved_empty check (guide_moved_at is null or (guide_status = 'none' and guide_priority is null and guide_notes is null))
);
create unique index tourism_hubs_iata_idx on public.tourism_hubs (user_id, mode, iata) where iata is not null;
create unique index tourism_hubs_icao_idx on public.tourism_hubs (user_id, icao) where icao is not null;
create unique index tourism_hubs_uic_idx on public.tourism_hubs (user_id, uic) where uic is not null;
create index tourism_hubs_filters_idx on public.tourism_hubs (user_id, mode, country, region);
create index tourism_hubs_destination_idx on public.tourism_hubs (user_id, destination_id) where destination_id is not null;

create table public.tourism_destinations (
  entity_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  population integer check (population is null or population >= 0),
  -- Arrivi internazionali in un anno (UN Tourism, Eurostat, ISTAT…): solo con anno e fonte.
  intl_arrivals integer check (intl_arrivals is null or intl_arrivals >= 0),
  arrivals_year smallint check (arrivals_year is null or arrivals_year between 1990 and 2100),
  arrivals_source text,
  -- A che livello e' misurato il numero: il comune di Roma non e' la provincia.
  arrivals_granularity text check (arrivals_granularity is null or arrivals_granularity in ('municipality','province','region','country')),
  -- Un numero stimato e non misurato porta metodo e affidabilita'.
  arrivals_estimated boolean not null default false,
  estimate_method text,
  reliability text check (reliability is null or reliability in ('high','medium','low')),
  -- [{"country":"US","share":18.5}], quote 0-100 dei mercati di provenienza.
  source_markets jsonb not null default '[]' check (jsonb_typeof(source_markets) = 'array'),
  -- Lingue che una guida dovrebbe avere (codici ISO 639-1).
  languages_needed text[] not null default '{}',
  guide_status text not null default 'none' check (guide_status in ('none','planned','in_progress','live','skip')),
  guide_priority smallint check (guide_priority is null or guide_priority between 1 and 3),
  guide_notes text,
  -- La mappa Speaqi che e' la guida di questa destinazione.
  speaqi_map_id uuid,
  speaqi_map_slug text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (user_id, entity_id) references public.tourism_entities(user_id, id) on delete cascade,
  constraint tourism_destinations_arrivals_need_year check (intl_arrivals is null or (arrivals_year is not null and arrivals_source is not null)),
  constraint tourism_destinations_estimate_declared check (not arrivals_estimated or (estimate_method is not null and reliability is not null)),
  constraint tourism_destinations_guide_priority_open check (guide_priority is null or guide_status in ('planned','in_progress'))
);
create index tourism_destinations_guide_idx on public.tourism_destinations (user_id, guide_status, guide_priority);

-- Solo le destinazioni aggiuntive: la principale e' tourism_hubs.destination_id.
create table public.tourism_hub_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hub_id uuid not null,
  destination_id uuid not null,
  source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  foreign key (user_id, hub_id) references public.tourism_hubs(user_id, id) on delete cascade,
  foreign key (user_id, destination_id) references public.tourism_entities(user_id, id) on delete cascade,
  unique (user_id, hub_id, destination_id)
);

create table public.tourism_hub_operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  hub_id uuid not null,
  entity_id uuid not null,
  role text not null check (role in ('base','homeport','calls','route')),
  season text check (season is null or char_length(btrim(season)) between 1 and 80),
  weekly_frequency numeric(6, 1) check (weekly_frequency is null or weekly_frequency >= 0),
  source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
  checked_at date,
  created_at timestamptz not null default now(),
  foreign key (user_id, hub_id) references public.tourism_hubs(user_id, id) on delete cascade,
  foreign key (user_id, entity_id) references public.tourism_entities(user_id, id) on delete cascade,
  unique (user_id, hub_id, entity_id, role)
);
create index tourism_hub_operators_entity_idx on public.tourism_hub_operators (user_id, entity_id);

-- La destinazione e' un luogo; un hub punta a un luogo. Un'organizzazione al
-- posto della citta' sarebbe un errore silenzioso nelle classifiche.
create or replace function public.tourism_place_guard() returns trigger
language plpgsql set search_path = public as $$
declare target uuid;
begin
  -- Due istruzioni e non un CASE: plpgsql risolve ogni campo di NEW nell'espressione intera.
  if tg_table_name = 'tourism_hubs' then target := new.destination_id;
  else target := new.entity_id;
  end if;
  if target is not null and not exists (
    select 1 from public.tourism_entities where id = target and user_id = new.user_id and kind = 'place'
  ) then raise exception 'Destination must be a place'; end if;
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger tourism_hubs_guard before insert or update on public.tourism_hubs
  for each row execute function public.tourism_place_guard();
create trigger tourism_destinations_guard before insert or update on public.tourism_destinations
  for each row execute function public.tourism_place_guard();

create or replace function public.tourism_hub_destination_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.tourism_entities where id = new.destination_id and user_id = new.user_id and kind = 'place') then
    raise exception 'Destination must be a place';
  end if;
  if exists (select 1 from public.tourism_hubs where id = new.hub_id and user_id = new.user_id and destination_id = new.destination_id) then
    raise exception 'Primary destination is not an additional destination';
  end if;
  return new;
end $$;
create trigger tourism_hub_destinations_guard before insert or update on public.tourism_hub_destinations
  for each row execute function public.tourism_hub_destination_guard();

-- Cambiare la principale toglie la riga aggiuntiva uguale: niente doppioni.
create or replace function public.tourism_hub_primary_dedupe() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.destination_id is not null and new.destination_id is distinct from old.destination_id then
    delete from public.tourism_hub_destinations where hub_id = new.id and user_id = new.user_id and destination_id = new.destination_id;
  end if;
  return new;
end $$;
create trigger tourism_hubs_primary_dedupe after update of destination_id on public.tourism_hubs
  for each row execute function public.tourism_hub_primary_dedupe();

-- Il registro delle revisioni identifica la riga con `id`; la destinazione ha
-- come chiave l'entita'.
create or replace function public.tourism_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare before_row jsonb; after_row jsonb; current_row jsonb;
begin
  if tg_op <> 'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row:=to_jsonb(new); end if;
  current_row:=coalesce(after_row,before_row);
  insert into public.tourism_revisions(user_id,table_name,record_id,actor_id,operation,before_data,after_data)
  values ((current_row->>'user_id')::uuid,tg_table_name,
    (case when tg_table_name in ('tourism_crm_links','tourism_destinations') then current_row->>'entity_id' else current_row->>'id' end)::uuid,
    auth.uid(),tg_op,before_row,after_row);
  return coalesce(new,old);
end $$;

do $$ declare t text; begin
  foreach t in array array['tourism_hubs','tourism_destinations','tourism_hub_destinations','tourism_hub_operators'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tourism_owner on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create trigger tourism_audit after insert or update or delete on public.%I for each row execute function public.tourism_audit()', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on function public.tourism_place_guard(), public.tourism_hub_destination_guard(), public.tourism_hub_primary_dedupe() from public, anon, authenticated;

-- Importazione a blocchi da dataset pubblici. Idempotente: un hub si ritrova
-- per codice ufficiale, poi per slug. Di un hub esistente si riempiono solo i
-- campi vuoti; i numeri si aggiornano solo con un anno piu' recente. Superguida,
-- destinazione e note scelte a mano non si toccano mai.
create or replace function public.tourism_import_hubs(p_hubs jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  h jsonb; existing public.tourism_hubs; nxt public.tourism_hubs; v_mode text; v_year smallint; v_passengers integer;
  newer boolean; created integer := 0; updated integer := 0; unchanged integer := 0;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if p_hubs is null or jsonb_typeof(p_hubs) <> 'array' or jsonb_array_length(p_hubs) not between 1 and 500 then
    raise exception 'Import requires 1-500 hubs';
  end if;
  for h in select value from jsonb_array_elements(p_hubs) loop
    v_mode := h->>'mode';
    existing := null;
    select * into existing from public.tourism_hubs t
      where t.user_id = auth.uid() and t.mode = v_mode and (
        (nullif(h->>'iata','') is not null and t.iata = h->>'iata') or
        (nullif(h->>'icao','') is not null and t.icao = h->>'icao') or
        (nullif(h->>'uic','') is not null and t.uic = h->>'uic') or
        (nullif(h->>'unlocode','') is not null and t.unlocode = h->>'unlocode') or
        t.slug = h->>'slug'
      )
      order by (t.slug = h->>'slug') desc
      limit 1 for update;
    v_passengers := nullif(h->>'passengers','')::integer;
    v_year := nullif(h->>'passengers_year','')::smallint;
    if existing.id is null then
      insert into public.tourism_hubs(user_id, mode, slug, name, country, aliases, unlocode, iata, icao, uic, external_ids,
        latitude, longitude, region, subregion, destination, size, passengers, passengers_year, intl_share, movements,
        stats_source, is_homeport, scheduled_service)
      values (auth.uid(), v_mode, h->>'slug', h->>'name', nullif(h->>'country',''),
        array(select jsonb_array_elements_text(coalesce(h->'aliases','[]'))),
        nullif(h->>'unlocode',''), nullif(h->>'iata',''), nullif(h->>'icao',''), nullif(h->>'uic',''),
        coalesce(h->'external_ids','{}'),
        nullif(h->>'latitude','')::numeric, nullif(h->>'longitude','')::numeric,
        nullif(h->>'region',''), nullif(h->>'subregion',''), nullif(h->>'destination',''), nullif(h->>'size',''),
        v_passengers, case when v_passengers is null then null else v_year end,
        nullif(h->>'intl_share','')::numeric, nullif(h->>'movements','')::integer,
        case when v_passengers is null then null else nullif(h->>'stats_source','') end,
        (h->>'is_homeport')::boolean, (h->>'scheduled_service')::boolean);
      created := created + 1;
      continue;
    end if;

    nxt := existing;
    nxt.country := coalesce(existing.country, nullif(h->>'country',''));
    nxt.unlocode := coalesce(existing.unlocode, nullif(h->>'unlocode',''));
    nxt.iata := coalesce(existing.iata, nullif(h->>'iata',''));
    nxt.icao := coalesce(existing.icao, nullif(h->>'icao',''));
    nxt.uic := coalesce(existing.uic, nullif(h->>'uic',''));
    nxt.external_ids := coalesce(h->'external_ids','{}') || existing.external_ids;
    nxt.aliases := (
      select coalesce(array_agg(distinct a order by a), '{}') from unnest(existing.aliases || array(select jsonb_array_elements_text(coalesce(h->'aliases','[]')))) a
      where btrim(a) <> '' and a <> existing.name
    );
    if existing.latitude is null or existing.longitude is null then
      nxt.latitude := nullif(h->>'latitude','')::numeric;
      nxt.longitude := nullif(h->>'longitude','')::numeric;
      if nxt.latitude is null or nxt.longitude is null then
        nxt.latitude := existing.latitude; nxt.longitude := existing.longitude;
      end if;
    end if;
    nxt.region := coalesce(existing.region, nullif(h->>'region',''));
    nxt.subregion := coalesce(existing.subregion, nullif(h->>'subregion',''));
    nxt.destination := coalesce(existing.destination, nullif(h->>'destination',''));
    nxt.size := coalesce(nullif(h->>'size',''), existing.size);
    nxt.scheduled_service := coalesce((h->>'scheduled_service')::boolean, existing.scheduled_service);
    nxt.is_homeport := coalesce(existing.is_homeport, (h->>'is_homeport')::boolean);
    -- Un numero piu' recente sostituisce il vecchio insieme a anno e fonte; uno piu' vecchio no.
    newer := v_passengers is not null and v_year is not null and (existing.passengers_year is null or v_year > existing.passengers_year);
    if newer then
      nxt.passengers := v_passengers;
      nxt.passengers_year := v_year;
      nxt.stats_source := nullif(h->>'stats_source','');
      nxt.intl_share := nullif(h->>'intl_share','')::numeric;
      nxt.movements := coalesce(nullif(h->>'movements','')::integer, existing.movements);
    end if;

    if row(nxt.*) is distinct from row(existing.*) then
      update public.tourism_hubs set
        country = nxt.country, unlocode = nxt.unlocode, iata = nxt.iata, icao = nxt.icao, uic = nxt.uic,
        external_ids = nxt.external_ids, aliases = nxt.aliases, latitude = nxt.latitude, longitude = nxt.longitude,
        region = nxt.region, subregion = nxt.subregion, destination = nxt.destination, size = nxt.size,
        scheduled_service = nxt.scheduled_service, is_homeport = nxt.is_homeport,
        passengers = nxt.passengers, passengers_year = nxt.passengers_year, stats_source = nxt.stats_source,
        intl_share = nxt.intl_share, movements = nxt.movements
      where id = existing.id;
      updated := updated + 1;
    else
      unchanged := unchanged + 1;
    end if;
  end loop;
  return jsonb_build_object('created', created, 'updated', updated, 'unchanged', unchanged);
end $$;
revoke all on function public.tourism_import_hubs(jsonb) from public, anon, authenticated;
grant execute on function public.tourism_import_hubs(jsonb) to authenticated;

-- Collega un hub alla sua destinazione principale e ci sposta la superguida.
-- Regola: se la destinazione ha gia' una guida (stato diverso da 'none') vince
-- la destinazione, e il porto dice "conflitto" nella risposta; altrimenti stato,
-- priorita' e note del porto passano alla destinazione. Sul porto si svuotano
-- comunque e resta guide_moved_at: una sola verita' da quel momento.
create or replace function public.tourism_link_hub_destination(p_hub uuid, p_destination uuid) returns jsonb
language plpgsql set search_path = public as $$
declare h public.tourism_hubs; d public.tourism_destinations; moved boolean := false; conflict boolean := false;
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  select * into h from public.tourism_hubs where id = p_hub and user_id = auth.uid() for update;
  if not found then raise exception 'Hub not found'; end if;
  if not exists (select 1 from public.tourism_entities where id = p_destination and user_id = auth.uid() and kind = 'place') then
    raise exception 'Destination must be a place';
  end if;
  insert into public.tourism_destinations(user_id, entity_id) values (auth.uid(), p_destination) on conflict (entity_id) do nothing;
  select * into d from public.tourism_destinations where entity_id = p_destination and user_id = auth.uid() for update;
  if h.guide_status <> 'none' or h.guide_notes is not null then
    if d.guide_status = 'none' then
      update public.tourism_destinations set guide_status = h.guide_status, guide_priority = h.guide_priority,
        guide_notes = coalesce(h.guide_notes, guide_notes) where entity_id = p_destination;
      moved := true;
    elsif d.guide_status is distinct from h.guide_status or d.guide_priority is distinct from h.guide_priority then
      conflict := true;
    end if;
  end if;
  update public.tourism_hubs set destination_id = p_destination,
    guide_status = 'none', guide_priority = null, guide_notes = null, guide_moved_at = coalesce(guide_moved_at, now())
  where id = p_hub;
  return jsonb_build_object('moved', moved, 'conflict', conflict,
    'hub_guide', jsonb_build_object('status', h.guide_status, 'priority', h.guide_priority, 'notes', h.guide_notes));
end $$;
revoke all on function public.tourism_link_hub_destination(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tourism_link_hub_destination(uuid, uuid) to authenticated;

-- Quadro per la pagina: quanti hub per tipo, con e senza numeri, e quanti
-- portano gia' a una destinazione.
create or replace function public.tourism_hub_overview() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(mode, totals), '{}'::jsonb) from (
    select mode, jsonb_build_object(
      'total', count(*),
      'with_stats', count(*) filter (where passengers is not null),
      'linked', count(*) filter (where destination_id is not null),
      'countries', count(distinct country),
      'passengers', coalesce(sum(passengers), 0)
    ) as totals
    from public.tourism_hubs where user_id = auth.uid() and active
    group by mode
  ) m;
$$;
revoke all on function public.tourism_hub_overview() from public, anon, authenticated;
grant execute on function public.tourism_hub_overview() to authenticated;

comment on table public.tourism_hubs is
  'Porti, aeroporti e stazioni (mode sea|air|rail): da dove arrivano i visitatori di una destinazione. shipping_ports e'' la vista dei porti.';
comment on table public.tourism_destinations is
  'Dati di una destinazione (tourism_entities kind=place): arrivi internazionali, mercati, lingue, stato della superguida Speaqi.';
comment on table public.tourism_hub_destinations is
  'Destinazioni aggiuntive di un hub multi-citta''. La principale e'' tourism_hubs.destination_id e qui non si ripete.';
comment on table public.tourism_hub_operators is
  'Chi opera dove: compagnie di crociera e traghetti nei porti, vettori negli aeroporti, operatori ferroviari nelle stazioni.';
