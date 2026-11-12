-- Speaqi Guides — Distribution Opportunities: le destinazioni che un'azienda vende.
--
-- «Cerca chi vende Roma» e' un fatto con una fonte: la ricerca che l'ha trovata
-- (LeadOcean per parola chiave, un elenco, una persona). Si salva qui, una riga per
-- azienda e guida, e il punteggio lo legge come destinazione certa. Cosi' un tour
-- operator americano che compare per «Rome tours» e «Florence tours» sa di
-- Roma e Firenze senza scrivere niente dentro `details` dell'ente (che lo
-- riporterebbe a «da confermare»).

create table if not exists public.tourism_distribution_destinations (
  entity_id uuid not null references public.tourism_entities(id) on delete cascade,
  slug text not null check (slug in ('venezia','bologna','milano','roma','firenze','napoli','capri','costiera-amalfitana','pompei')),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (char_length(btrim(source)) between 1 and 200),
  source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),
  noted_at timestamptz not null default now(),
  primary key (entity_id, slug)
);
create index if not exists tourism_distribution_destinations_user_idx on public.tourism_distribution_destinations(user_id, slug);

alter table public.tourism_distribution_destinations enable row level security;
drop policy if exists tourism_distribution_destinations_owner on public.tourism_distribution_destinations;
create policy tourism_distribution_destinations_owner on public.tourism_distribution_destinations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Il ricalcolo legge anche i segnali. La funzione si riscrive dal suo testo (stessa
-- logica di prima, piu' le destinazioni certe): idempotente, non fa niente se gia' applicato.
do $mig$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'tourism_distribution_recompute' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'tourism_distribution_recompute non trovata'; end if;
  if position('sig_slugs' in v_def) > 0 then return; end if;

  v_def := replace(v_def,
    'coalesce(h.guide_hubs, 0) as guide_hubs,',
    'coalesce(h.guide_hubs, 0) as guide_hubs,
           coalesce((select array_agg(distinct g.slug order by g.slug) from public.tourism_distribution_destinations g where g.entity_id = e.id and g.user_id = v_owner), ''{}''::text[]) as sig_slugs,');
  v_def := replace(v_def,
    'f.hq_slugs || f.txt_slugs || f.hub_slugs',
    'f.hq_slugs || f.txt_slugs || f.hub_slugs || f.sig_slugs');
  v_def := replace(v_def,
    'when s.guide_hubs >= 3 then 90',
    'when cardinality(s.sig_slugs) >= 3 then 95
        when cardinality(s.sig_slugs) = 2 then 88
        when cardinality(s.sig_slugs) = 1 then 80
        when s.guide_hubs >= 3 then 90');
  if position('sig_slugs' in v_def) = 0 then raise exception 'sostituzione non riuscita'; end if;
  execute v_def;
end $mig$;
