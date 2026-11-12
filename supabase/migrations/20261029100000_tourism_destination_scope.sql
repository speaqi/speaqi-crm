-- Tourism Intelligence: filtrare gli enti per destinazione.
--
-- Chi distribuisce la mappa di Roma deve sapere chi sono i DMC, i tour operator e
-- i property manager di Roma. Gli enti si legano ai luoghi (COVERS, MANAGES,
-- PROMOTES, SELLS, OPERATES_IN) e i luoghi stanno uno dentro l'altro (PART_OF):
-- Capri e Positano dentro la Costiera, la Costiera dentro la Campania. Mancava
-- la ricerca che scende per la gerarchia. Solo letture, nessuna tabella nuova:
-- sono funzioni security invoker, quindi valgono la RLS e il proprietario.

-- Le chiavi con cui un luogo si riconosce: il nome e gli alias ("Rome" per Roma).
create or replace function public.tourism_place_keys(p_name_key text, p_aliases text[])
returns text[]
language sql immutable set search_path = public as $$
  select array_remove(array[p_name_key] || coalesce((select array_agg(public.tourism_name_key(a)) from unnest(p_aliases) a), '{}'::text[]), '')
$$;

-- Il luogo e, se richiesto, tutti i luoghi che ne fanno parte (a qualunque livello).
create or replace function public.tourism_place_scope(p_place uuid, p_children boolean default true)
returns uuid[]
language sql stable set search_path = public as $$
  with recursive scope(id) as (
    select e.id from public.tourism_entities e
     where e.id = p_place and e.user_id = auth.uid() and e.kind = 'place'
    union
    select r.from_id from public.tourism_relations r
      join scope s on r.to_id = s.id
     where p_children and r.user_id = auth.uid() and r.relation = 'PART_OF'
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from scope
$$;

-- I luoghi fra cui scegliere: quelli con enti legati (anche tramite le sotto-aree)
-- e quelli con una mappa Speaqi, anche se ancora vuoti: sono le destinazioni da popolare.
create or replace function public.tourism_destination_options()
returns jsonb
language sql stable set search_path = public as $$
  with recursive places as (
    select e.id, e.name, e.country_code
      from public.tourism_entities e
     where e.user_id = auth.uid() and e.kind = 'place' and not e.disabled
  ),
  closure(anc, node) as (
    select id, id from places
    union
    select c.anc, r.from_id from closure c
      join public.tourism_relations r on r.to_id = c.node and r.relation = 'PART_OF' and r.user_id = auth.uid()
  ),
  cov as (
    select distinct c.anc, o.id as entity_id, o.type_code
      from closure c
      join public.tourism_relations r on r.to_id = c.node and r.user_id = auth.uid()
       and r.relation in ('COVERS','MANAGES','PROMOTES','SELLS','OPERATES_IN')
      join public.tourism_entities o on o.id = r.from_id and o.user_id = auth.uid()
       and o.kind = 'organization' and not o.disabled
    union
    -- La sede dichiarata (details.hq_city) vale come legame debole con la citta'.
    select distinct c.anc, o.id, o.type_code
      from closure c
      join public.tourism_entities pl on pl.id = c.node and pl.user_id = auth.uid()
      join public.tourism_entities o on o.user_id = auth.uid() and o.kind = 'organization' and not o.disabled
       and nullif(o.details ->> 'hq_city', '') is not null
       and public.tourism_name_key(o.details ->> 'hq_city') = any (public.tourism_place_keys(pl.name_key, pl.aliases))
  ),
  by_type as (
    select anc, type_code, count(*)::int as n from cov group by anc, type_code
  ),
  totals as (
    select anc, count(*)::int as total from cov group by anc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'country_code', p.country_code,
      'parent', (select pe.name from public.tourism_relations pr
                   join public.tourism_entities pe on pe.id = pr.to_id and pe.user_id = auth.uid()
                  where pr.from_id = p.id and pr.relation = 'PART_OF' and pr.user_id = auth.uid()
                  order by pe.name limit 1),
      'map_slug', d.speaqi_map_slug,
      'total', coalesce(t.total, 0),
      'by_type', coalesce((select jsonb_object_agg(b.type_code, b.n) from by_type b where b.anc = p.id), '{}'::jsonb)
    ) order by p.name), '[]'::jsonb)
  from places p
  left join totals t on t.anc = p.id
  left join public.tourism_destinations d on d.entity_id = p.id and d.user_id = auth.uid()
  where coalesce(t.total, 0) > 0 or d.speaqi_map_slug is not null
$$;

-- Gli enti di una destinazione, con gli stessi filtri essenziali della directory.
-- Ogni ente porta i luoghi per cui e' stato trovato e il tipo di legame.
create or replace function public.tourism_destination_entities(
  p_place uuid,
  p_children boolean default true,
  p_types text[] default null,
  p_status text default null,
  p_availability text default 'active',
  p_country text default null,
  p_q text default null,
  p_sort text default 'name',
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language sql stable set search_path = public as $$
  with scope as (
    select unnest(public.tourism_place_scope(p_place, p_children)) as id
  ),
  raw(entity_id, place, relation) as (
    select r.from_id, pe.name, r.relation
      from scope s
      join public.tourism_relations r on r.to_id = s.id and r.user_id = auth.uid()
       and r.relation in ('COVERS','MANAGES','PROMOTES','SELLS','OPERATES_IN')
      join public.tourism_entities pe on pe.id = s.id and pe.user_id = auth.uid()
    union all
    select o.id, pe.name, 'HQ'
      from scope s
      join public.tourism_entities pe on pe.id = s.id and pe.user_id = auth.uid()
      join public.tourism_entities o on o.user_id = auth.uid() and o.kind = 'organization'
       and nullif(o.details ->> 'hq_city', '') is not null
       and public.tourism_name_key(o.details ->> 'hq_city') = any (public.tourism_place_keys(pe.name_key, pe.aliases))
  ),
  hits as (
    select entity_id,
           array_agg(distinct place order by place) as places,
           array_agg(distinct relation order by relation) as relations
      from raw group by entity_id
  ),
  filtered as (
    select e.id, e.name, e.created_at, e.outreach_priority, h.places, h.relations
      from hits h
      join public.tourism_entities e on e.id = h.entity_id and e.user_id = auth.uid()
     where e.kind = 'organization'
       and (p_types is null or e.type_code = any(p_types))
       and (p_status is null or e.status = p_status)
       and (p_availability = 'all' or e.disabled = (p_availability = 'disabled'))
       and (p_country is null or e.country_code = p_country)
       and (nullif(public.tourism_name_key(coalesce(p_q, '')), '') is null
            or e.name_key like '%' || replace(public.tourism_name_key(p_q), ' ', '%') || '%'
            or coalesce(e.website, '') ilike '%' || replace(public.tourism_name_key(p_q), ' ', '') || '%')
  ),
  ordered as (
    select f.*, row_number() over (
      order by
        case when p_sort = 'outreach' then coalesce(f.outreach_priority, 9) end asc nulls last,
        case when p_sort = 'recent' then f.created_at end desc nulls last,
        f.name asc, f.id asc
    ) as rn
    from filtered f
  )
  select jsonb_build_object(
    'total', (select count(*)::int from filtered),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'places', o.places, 'relations', o.relations) order by o.rn)
        from ordered o
       where o.rn > greatest(p_offset, 0) and o.rn <= greatest(p_offset, 0) + least(greatest(p_limit, 1), 200)
    ), '[]'::jsonb)
  )
$$;

revoke all on function public.tourism_place_keys(text, text[]),
  public.tourism_place_scope(uuid, boolean),
  public.tourism_destination_options(),
  public.tourism_destination_entities(uuid, boolean, text[], text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.tourism_place_keys(text, text[]),
  public.tourism_place_scope(uuid, boolean),
  public.tourism_destination_options(),
  public.tourism_destination_entities(uuid, boolean, text[], text, text, text, text, text, integer, integer)
  to authenticated;
