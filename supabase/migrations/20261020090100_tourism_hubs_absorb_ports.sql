-- I porti di Navigazione entrano in tourism_hubs (mode = 'sea').
--
-- Le righe passano con lo stesso id, quindi tappe degli itinerari, link e
-- preferenze salvate continuano a puntare allo stesso porto. shipping_ports
-- diventa una vista aggiornabile con le colonne di prima (cruise_passengers e
-- cruise_calls sono i nomi "da porto" di passengers e movements): /navigazione,
-- save_shipping_itinerary e l'esportazione CSV non cambiano.
--
-- La tabella vecchia resta come shipping_ports_legacy, senza accesso, finche'
-- una release successiva non verifica il passaggio e la cancella.

insert into public.tourism_hubs (
  id, user_id, mode, slug, name, country, aliases, unlocode, latitude, longitude,
  region, subregion, destination, passengers, passengers_year, movements, stats_source,
  is_homeport, guide_status, guide_priority, guide_notes, notes, created_at, updated_at
)
select
  id, user_id, 'sea', slug, name, country, aliases, unlocode, latitude, longitude,
  region, subregion, destination, cruise_passengers, passengers_year, cruise_calls, stats_source,
  is_homeport, guide_status, guide_priority, guide_notes, notes, created_at, updated_at
from public.shipping_ports
on conflict (id) do nothing;

alter table public.shipping_itinerary_stops drop constraint if exists shipping_itinerary_stops_port_id_fkey;
alter table public.shipping_itinerary_stops
  add constraint shipping_itinerary_stops_port_id_fkey
  foreign key (port_id) references public.tourism_hubs(id) on delete restrict;

alter table public.shipping_ports rename to shipping_ports_legacy;
revoke all on public.shipping_ports_legacy from anon, authenticated;

create view public.shipping_ports with (security_invoker = true) as
  select id, user_id, slug, name, country, unlocode, aliases, latitude, longitude, notes,
         created_at, updated_at, region, subregion, destination,
         passengers as cruise_passengers, passengers_year, movements as cruise_calls,
         stats_source, is_homeport, guide_status, guide_priority, guide_notes, mode
  from public.tourism_hubs
  where mode = 'sea'
  with cascaded check option;

alter view public.shipping_ports alter column mode set default 'sea';
alter view public.shipping_ports alter column user_id set default auth.uid();
alter view public.shipping_ports alter column guide_status set default 'none';
alter view public.shipping_ports alter column aliases set default '{}';

revoke all on public.shipping_ports from anon, authenticated;
grant select, insert, update, delete on public.shipping_ports to authenticated;

-- L'unione dei porti lavora ora sulla tabella vera: oltre alle tappe sposta
-- anche le compagnie che operano nel porto che sparisce.
create or replace function public.merge_shipping_ports(p_from uuid, p_into uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_from tourism_hubs%rowtype;
begin
  if v_user is null then
    raise exception 'autenticazione richiesta' using errcode = '42501';
  end if;
  if p_from = p_into then
    raise exception 'un porto non si unisce a se stesso' using errcode = '22023';
  end if;
  select * into v_from from tourism_hubs where id = p_from and user_id = v_user and mode = 'sea' for update;
  if not found or not exists (select 1 from tourism_hubs where id = p_into and user_id = v_user and mode = 'sea') then
    raise exception 'porto non trovato' using errcode = 'P0002';
  end if;

  update shipping_itinerary_stops set port_id = p_into where port_id = p_from and user_id = v_user;
  insert into tourism_hub_operators (user_id, hub_id, entity_id, role, season, weekly_frequency, source_url, checked_at)
    select user_id, p_into, entity_id, role, season, weekly_frequency, source_url, checked_at
    from tourism_hub_operators where hub_id = p_from and user_id = v_user
    on conflict (user_id, hub_id, entity_id, role) do nothing;
  update tourism_hubs set
    aliases = (
      select coalesce(array_agg(distinct alias), '{}')
      from unnest(aliases || v_from.aliases || array[v_from.name]) as alias
      where alias is not null and btrim(alias) <> '' and alias <> tourism_hubs.name
    ),
    country = coalesce(country, v_from.country),
    unlocode = coalesce(unlocode, v_from.unlocode),
    latitude = coalesce(latitude, v_from.latitude),
    longitude = coalesce(longitude, v_from.longitude),
    destination = coalesce(destination, v_from.destination),
    destination_id = coalesce(destination_id, v_from.destination_id),
    external_ids = v_from.external_ids || external_ids
  where id = p_into and user_id = v_user;
  delete from tourism_hubs where id = p_from and user_id = v_user;
  return p_into;
end;
$$;

revoke all on function public.merge_shipping_ports(uuid, uuid) from public, anon;
grant execute on function public.merge_shipping_ports(uuid, uuid) to authenticated, service_role;

comment on view public.shipping_ports is
  'I porti (tourism_hubs con mode = sea) con i nomi di colonna di Navigazione. Si scrive anche da qui.';
