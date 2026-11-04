-- Speaqi Guides — Distribution Opportunities: lo specialista «Italia» generico.
--
-- Un tour operator americano che si chiama «Italy Perfect» vende l'Italia, non una
-- guida in particolare. Il segnale `italia` lo dice: pesa meno di una destinazione
-- certa (60 contro 80-95) e non compare fra le guide pertinenti.

alter table public.tourism_distribution_destinations
  drop constraint if exists tourism_distribution_destinations_slug_check;
alter table public.tourism_distribution_destinations
  add constraint tourism_distribution_destinations_slug_check
  check (slug in ('venezia','bologna','milano','roma','firenze','napoli','capri','costiera-amalfitana','pompei','italia'));

do $mig$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'tourism_distribution_recompute' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'tourism_distribution_recompute non trovata'; end if;
  if position('sig_italy' in v_def) > 0 then return; end if;

  v_def := replace(v_def,
    'where g.entity_id = e.id and g.user_id = v_owner), ''{}''::text[]) as sig_slugs,',
    'where g.entity_id = e.id and g.user_id = v_owner and g.slug <> ''italia''), ''{}''::text[]) as sig_slugs,
           exists (select 1 from public.tourism_distribution_destinations g where g.entity_id = e.id and g.user_id = v_owner and g.slug = ''italia'') as sig_italy,');
  v_def := replace(v_def,
    'when cardinality(s.reg_slugs) > 0 then 55',
    'when s.sig_italy then 60
        when cardinality(s.reg_slugs) > 0 then 55');
  if position('sig_italy' in v_def) = 0 or position('when s.sig_italy' in v_def) = 0 then
    raise exception 'sostituzione non riuscita';
  end if;
  execute v_def;
end $mig$;
