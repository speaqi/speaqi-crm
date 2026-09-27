-- Itinerari delle compagnie di navigazione: compagnia → itinerario → tappe → porto.
--
-- Prima si sapeva solo se una compagnia "arriva a Napoli o a Civitavecchia"
-- (shipping_companies.calls_*). Per Speaqi Maps serve di piu': ogni tappa di una
-- crociera e' una destinazione da raccontare, quindi si carica l'itinerario
-- intero (es. "MSC Mediterraneo" su MSC World Europa: Genova → Napoli →
-- Messina → La Valletta → Barcellona → Marsiglia) e da ogni porto si risale a
-- chi ci arriva e con quali crociere.
--
-- I porti sono un'anagrafica propria (`shipping_ports`), non testo libero sulla
-- tappa: "Naples", "Napoli" e "Napoli (Pompei)" devono essere lo stesso porto,
-- altrimenti la vista per porto conta tre posti diversi.

create table if not exists public.shipping_ports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- ISO 3166-1 alpha-2 (IT, ES, GR…). Null se non noto.
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  -- UN/LOCODE (ITNAP, ITCVV…): il codice che usano compagnie e autorita' portuali.
  unlocode text check (unlocode is null or unlocode ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  -- Altri nomi con cui il porto compare negli itinerari ("Naples", "Roma").
  aliases text[] not null default '{}',
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table if not exists public.shipping_itineraries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_id uuid not null references public.shipping_companies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  ship text,
  nights integer check (nights is null or nights between 0 and 400),
  -- Stagione come la scrive la compagnia ("Estate 2026", "Inverno 2026/27").
  season text,
  departure_dates date[] not null default '{}',
  source_url text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_itineraries_company_idx
  on public.shipping_itineraries (user_id, company_id);

-- Una tappa e' una sosta in porto. I giorni di navigazione non sono tappe:
-- restano visibili come salto nel numero del giorno.
create table if not exists public.shipping_itinerary_stops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  itinerary_id uuid not null references public.shipping_itineraries(id) on delete cascade,
  position integer not null check (position >= 1),
  day integer check (day is null or day between 1 and 400),
  -- restrict: cancellare un porto usato da un itinerario lascerebbe un buco nella rotta.
  port_id uuid not null references public.shipping_ports(id) on delete restrict,
  role text not null default 'call' check (role in ('embark', 'call', 'disembark', 'turnaround')),
  arrival text check (arrival is null or arrival ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  departure text check (departure is null or departure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  overnight boolean not null default false,
  notes text,
  unique (itinerary_id, position)
);

create index if not exists shipping_itinerary_stops_port_idx
  on public.shipping_itinerary_stops (user_id, port_id);

alter table public.shipping_ports enable row level security;
alter table public.shipping_itineraries enable row level security;
alter table public.shipping_itinerary_stops enable row level security;

drop policy if exists "shipping_ports_owner" on public.shipping_ports;
create policy "shipping_ports_owner" on public.shipping_ports
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "shipping_itineraries_owner" on public.shipping_itineraries;
create policy "shipping_itineraries_owner" on public.shipping_itineraries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "shipping_itinerary_stops_owner" on public.shipping_itinerary_stops;
create policy "shipping_itinerary_stops_owner" on public.shipping_itinerary_stops
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Salva itinerario e tappe in una transazione sola: scrivere prima l'itinerario
-- e poi le tappe con due chiamate lascerebbe, se la seconda cade, un itinerario
-- senza tappe o con le tappe vecchie cancellate a meta'.
-- security invoker: la RLS resta quella di chi chiama. I controlli espliciti su
-- compagnia e porti servono perche' una foreign key non guarda la RLS, e senza
-- di loro si potrebbe agganciare la tappa al porto di un altro workspace.
create or replace function public.save_shipping_itinerary(p_itinerary jsonb, p_stops jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := nullif(p_itinerary->>'id', '')::uuid;
  v_company uuid := nullif(p_itinerary->>'company_id', '')::uuid;
  v_dates date[] := coalesce(
    (select array_agg(value::date order by value::date) from jsonb_array_elements_text(coalesce(p_itinerary->'departure_dates', '[]'::jsonb))),
    '{}'
  );
begin
  if v_user is null then
    raise exception 'autenticazione richiesta' using errcode = '42501';
  end if;
  if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops) = 0 then
    raise exception 'un itinerario ha almeno una tappa' using errcode = '22023';
  end if;
  if not exists (select 1 from shipping_companies where id = v_company and user_id = v_user) then
    raise exception 'compagnia non trovata' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_stops) as s(port_id uuid)
    where not exists (select 1 from shipping_ports p where p.id = s.port_id and p.user_id = v_user)
  ) then
    raise exception 'porto non trovato' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into shipping_itineraries (user_id, company_id, name, ship, nights, season, departure_dates, source_url, notes, active)
    values (
      v_user, v_company, p_itinerary->>'name', nullif(p_itinerary->>'ship', ''),
      nullif(p_itinerary->>'nights', '')::int, nullif(p_itinerary->>'season', ''), v_dates,
      nullif(p_itinerary->>'source_url', ''), nullif(p_itinerary->>'notes', ''),
      coalesce((p_itinerary->>'active')::boolean, true)
    )
    returning id into v_id;
  else
    update shipping_itineraries set
      company_id = v_company,
      name = p_itinerary->>'name',
      ship = nullif(p_itinerary->>'ship', ''),
      nights = nullif(p_itinerary->>'nights', '')::int,
      season = nullif(p_itinerary->>'season', ''),
      departure_dates = v_dates,
      source_url = nullif(p_itinerary->>'source_url', ''),
      notes = nullif(p_itinerary->>'notes', ''),
      active = coalesce((p_itinerary->>'active')::boolean, true),
      updated_at = now()
    where id = v_id and user_id = v_user
    returning id into v_id;
    if v_id is null then
      raise exception 'itinerario non trovato' using errcode = 'P0002';
    end if;
    delete from shipping_itinerary_stops where itinerary_id = v_id;
  end if;

  insert into shipping_itinerary_stops (user_id, itinerary_id, position, day, port_id, role, arrival, departure, overnight, notes)
  select v_user, v_id, s.position, s.day, s.port_id, coalesce(s.role, 'call'),
         nullif(s.arrival, ''), nullif(s.departure, ''), coalesce(s.overnight, false), nullif(s.notes, '')
  from jsonb_to_recordset(p_stops) as s(position int, day int, port_id uuid, role text, arrival text, departure text, overnight boolean, notes text);

  return v_id;
end;
$$;

revoke all on function public.save_shipping_itinerary(jsonb, jsonb) from public, anon;
grant execute on function public.save_shipping_itinerary(jsonb, jsonb) to authenticated, service_role;

-- Unisce due porti doppioni ("Naples" creato accanto a "Napoli"): le tappe
-- passano al porto che resta, il nome e gli alias di quello che sparisce
-- diventano alias, cosi' la prossima volta "Naples" trova subito Napoli.
create or replace function public.merge_shipping_ports(p_from uuid, p_into uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_from shipping_ports%rowtype;
begin
  if v_user is null then
    raise exception 'autenticazione richiesta' using errcode = '42501';
  end if;
  if p_from = p_into then
    raise exception 'un porto non si unisce a se stesso' using errcode = '22023';
  end if;
  select * into v_from from shipping_ports where id = p_from and user_id = v_user for update;
  if not found or not exists (select 1 from shipping_ports where id = p_into and user_id = v_user) then
    raise exception 'porto non trovato' using errcode = 'P0002';
  end if;

  update shipping_itinerary_stops set port_id = p_into where port_id = p_from and user_id = v_user;
  update shipping_ports set
    aliases = (
      select coalesce(array_agg(distinct alias), '{}')
      from unnest(aliases || v_from.aliases || array[v_from.name]) as alias
      where alias is not null and btrim(alias) <> '' and alias <> shipping_ports.name
    ),
    country = coalesce(country, v_from.country),
    unlocode = coalesce(unlocode, v_from.unlocode),
    latitude = coalesce(latitude, v_from.latitude),
    longitude = coalesce(longitude, v_from.longitude),
    updated_at = now()
  where id = p_into and user_id = v_user;
  delete from shipping_ports where id = p_from and user_id = v_user;
  return p_into;
end;
$$;

revoke all on function public.merge_shipping_ports(uuid, uuid) from public, anon;
grant execute on function public.merge_shipping_ports(uuid, uuid) to authenticated, service_role;

comment on table public.shipping_ports is
  'Porti degli itinerari (/navigazione → Porti). Un porto, piu'' nomi: gli alias fanno coincidere "Naples" e "Napoli".';
comment on table public.shipping_itineraries is
  'Una crociera o una linea di una compagnia di navigazione, con le sue tappe in shipping_itinerary_stops.';
comment on table public.shipping_itinerary_stops is
  'Le soste in porto di un itinerario, in ordine. I giorni di navigazione non sono tappe.';
