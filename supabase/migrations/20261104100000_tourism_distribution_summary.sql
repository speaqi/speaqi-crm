-- Speaqi Guides — Distribution Opportunities: riepilogo per la dashboard.
--
-- Una sola lettura (security invoker, quindi RLS) con tutto cio' che serve alla
-- dashboard e alla matrice DESTINAZIONE x CATEGORIA x PAESE: fasce, stati, modelli,
-- copertura per guida, per categoria e per paese, e le celle della matrice con
-- quanti prospect Tier A/B ci sono. Le celle vuote le calcola la pagina, perche'
-- "nessun prospect" e' un'informazione (segmento inesplorato), non un errore.

create or replace function public.tourism_distribution_summary()
returns jsonb
language sql stable set search_path = public as $$
  with d as (
    select x.*, e.type_code, e.country_code, (e.email is not null and e.email <> '') as has_email,
           (e.phone is not null and e.phone <> '') as has_phone
      from public.tourism_distribution x
      join public.tourism_entities e on e.id = x.entity_id and not e.disabled
     where x.user_id = auth.uid()
  ),
  cells as (
    select s.slug, d.type_code, d.country_code, d.tier, d.entity_id
      from d, lateral unnest(d.guide_slugs) s(slug)
  )
  select jsonb_build_object(
    'total', (select count(*) from d),
    'tiers', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from d group by 1) t), '{}'::jsonb),
    'statuses', coalesce((select jsonb_object_agg(commercial_status, n) from (select commercial_status, count(*) n from d group by 1) t), '{}'::jsonb),
    'models', coalesce((select jsonb_object_agg(model, n) from (select model, count(*) n from d where tier in ('A','B') group by 1) t), '{}'::jsonb),
    'strategic', (select count(*) from d where strategic),
    'quick_wins', (select count(*) from d where quick_win),
    'with_email', (select count(*) from d where has_email),
    'qualified', (select count(*) from d where tier in ('A','B')),
    'by_slug', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'total', total, 'a', a, 'b', b, 'quick', quick, 'with_email', email) order by total desc)
        from (select c.slug, count(distinct c.entity_id) total,
                     count(distinct c.entity_id) filter (where c.tier = 'A') a,
                     count(distinct c.entity_id) filter (where c.tier = 'B') b,
                     count(distinct c.entity_id) filter (where dd.quick_win) quick,
                     count(distinct c.entity_id) filter (where dd.has_email) email
                from cells c join d dd on dd.entity_id = c.entity_id group by 1) t), '[]'::jsonb),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', type_code, 'total', total, 'a', a, 'b', b) order by total desc)
        from (select type_code, count(*) total, count(*) filter (where tier = 'A') a, count(*) filter (where tier = 'B') b from d group by 1) t), '[]'::jsonb),
    'by_country', coalesce((select jsonb_agg(jsonb_build_object('country', country_code, 'total', total, 'ab', ab) order by ab desc, total desc)
        from (select country_code, count(*) total, count(*) filter (where tier in ('A','B')) ab from d group by 1 order by 3 desc, 2 desc limit 40) t), '[]'::jsonb),
    'matrix', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'type', type_code, 'total', total, 'ab', ab))
        from (select slug, type_code, count(distinct entity_id) total, count(distinct entity_id) filter (where tier in ('A','B')) ab from cells group by 1, 2) t), '[]'::jsonb),
    'matrix_country', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'country', country_code, 'total', total, 'ab', ab))
        from (select slug, country_code, count(distinct entity_id) total, count(distinct entity_id) filter (where tier in ('A','B')) ab from cells group by 1, 2 having count(distinct entity_id) filter (where tier in ('A','B')) > 0) t), '[]'::jsonb)
  )
$$;

revoke all on function public.tourism_distribution_summary() from public, anon;
grant execute on function public.tourism_distribution_summary() to authenticated;
