-- Tourism Intelligence: la Panoramica non si caricava piu' (timeout).
-- tourism_destination_options e tourism_destination_entities calcolavano
-- tourism_name_key(details->>'hq_city') per ogni coppia (luogo, organizzazione):
-- con ~9.000 organizzazioni con una sede e qualche centinaio di luoghi erano
-- milioni di chiamate. Ora la chiave della sede si calcola una volta per
-- organizzazione, le chiavi dei luoghi una volta per luogo, e si uniscono per
-- uguaglianza. Stesso risultato, stessa firma.

create or replace function public.tourism_destination_options()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with recursive places as (
    select e.id, e.name, e.country_code, e.name_key, e.aliases
      from public.tourism_entities e
     where e.user_id = auth.uid() and e.kind = 'place' and not e.disabled
  ),
  closure(anc, node) as (
    select id, id from places
    union
    select c.anc, r.from_id from closure c
      join public.tourism_relations r on r.to_id = c.node and r.relation = 'PART_OF' and r.user_id = auth.uid()
  ),
  place_keys as materialized (
    select pl.id, k.key
      from public.tourism_entities pl
      cross join lateral unnest(public.tourism_place_keys(pl.name_key, pl.aliases)) as k(key)
     where pl.user_id = auth.uid() and pl.kind = 'place'
  ),
  hq as materialized (
    select o.id, o.type_code, public.tourism_name_key(o.details ->> 'hq_city') as key
      from public.tourism_entities o
     where o.user_id = auth.uid() and o.kind = 'organization' and not o.disabled
       and nullif(o.details ->> 'hq_city', '') is not null
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
    select distinct c.anc, h.id, h.type_code
      from closure c
      join place_keys pk on pk.id = c.node
      join hq h on h.key = pk.key
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
$function$;

create or replace function public.tourism_destination_entities(p_place uuid, p_children boolean default true, p_types text[] default null::text[], p_status text default null::text, p_availability text default 'active'::text, p_country text default null::text, p_q text default null::text, p_sort text default 'name'::text, p_offset integer default 0, p_limit integer default 50)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with scope as (
    select unnest(public.tourism_place_scope(p_place, p_children)) as id
  ),
  scope_keys as materialized (
    select pe.id, pe.name, k.key
      from scope s
      join public.tourism_entities pe on pe.id = s.id and pe.user_id = auth.uid()
      cross join lateral unnest(public.tourism_place_keys(pe.name_key, pe.aliases)) as k(key)
  ),
  hq as materialized (
    select o.id, public.tourism_name_key(o.details ->> 'hq_city') as key
      from public.tourism_entities o
     where o.user_id = auth.uid() and o.kind = 'organization'
       and nullif(o.details ->> 'hq_city', '') is not null
  ),
  raw(entity_id, place, relation) as (
    select r.from_id, pe.name, r.relation
      from scope s
      join public.tourism_relations r on r.to_id = s.id and r.user_id = auth.uid()
       and r.relation in ('COVERS','MANAGES','PROMOTES','SELLS','OPERATES_IN')
      join public.tourism_entities pe on pe.id = s.id and pe.user_id = auth.uid()
    union all
    select distinct h.id, sk.name, 'HQ'
      from scope_keys sk
      join hq h on h.key = sk.key
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
$function$;
