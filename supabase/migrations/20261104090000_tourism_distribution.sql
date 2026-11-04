-- Speaqi Guides — Distribution Opportunities.
--
-- Un motore commerciale sopra Tourism Intelligence: per ogni organizzazione che
-- potrebbe comprare, rivendere o distribuire le guide (Venezia, Bologna, Milano,
-- Roma, Firenze, Napoli, Capri, Costiera Amalfitana, Pompei) un punteggio 0-100,
-- una fascia (Tier A-D), le destinazioni pertinenti, il modello commerciale
-- consigliato e lo stato commerciale. Non duplica niente: legge gli enti, le
-- relazioni e i collegamenti compagnia-scalo che gia' ci sono e scrive solo la
-- valutazione, in una tabella a parte (modificare `details` di un ente lo
-- riporterebbe a "da confermare": il trigger tourism_entity_guard).
--
-- Il punteggio e' un ordinamento, non un fatto: usa solo dati presenti e un
-- campo ignoto vale "ignoto", mai un valore indovinato. Pesi: destinazioni 20,
-- potenziale distributivo 25, compatibilita' commerciale 20, facilita' di
-- attivazione 15, accesso ai contatti 10, servizi complementari 10.
-- Solo letture e scritture sulla nuova tabella, security invoker: vale la RLS.

create table if not exists public.tourism_distribution (
  entity_id uuid primary key references public.tourism_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  tier text not null check (tier in ('A','B','C','D')),
  components jsonb not null default '{}'::jsonb,
  completeness smallint not null default 0 check (completeness between 0 and 100),
  guide_slugs text[] not null default '{}',
  destination_basis jsonb not null default '{}'::jsonb,
  volume_potential text not null check (volume_potential in ('low','medium','high','very_high')),
  model text not null check (model in ('affiliate','resale','bundle','b2b_guests','revenue_share')),
  model_alt text check (model_alt in ('affiliate','resale','bundle','b2b_guests','revenue_share')),
  strategic boolean not null default false,
  quick_win boolean not null default false,
  commercial_status text not null default 'new'
    check (commercial_status in ('new','qualified','contacted','replied','negotiating','active','not_fit')),
  notes text,
  scored_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tourism_distribution_rank_idx on public.tourism_distribution(user_id, score desc);
create index if not exists tourism_distribution_tier_idx on public.tourism_distribution(user_id, tier);
create index if not exists tourism_distribution_slugs_idx on public.tourism_distribution using gin(guide_slugs);

alter table public.tourism_distribution enable row level security;
drop policy if exists tourism_distribution_owner on public.tourism_distribution;
create policy tourism_distribution_owner on public.tourism_distribution
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Le nove guide: lo slug e' quello della guida, non della citta'.
create or replace function public.tourism_guide_slugs_in(p_text text)
returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_remove(array[
    case when p_text ~* '(^|[^a-z])(venezia|venice|venise|venedig|mestre|murano|burano)([^a-z]|$)' then 'venezia' end,
    case when p_text ~* '(^|[^a-z])bologna([^a-z]|$)' then 'bologna' end,
    case when p_text ~* '(^|[^a-z])(milano|milan|mailand|malpensa|linate)([^a-z]|$)' then 'milano' end,
    case when p_text ~* '(^|[^a-z])(roma|rome|fiumicino|ciampino|civitavecchia)([^a-z]|$)' then 'roma' end,
    case when p_text ~* '(^|[^a-z])(firenze|florence|florenz)([^a-z]|$)' then 'firenze' end,
    case when p_text ~* '(^|[^a-z])(napoli|naples|neapel|ercolano|herculaneum|vesuvio|vesuvius)([^a-z]|$)' then 'napoli' end,
    case when p_text ~* '(^|[^a-z])(capri|anacapri)([^a-z]|$)' then 'capri' end,
    case when p_text ~* '(^|[^a-z])(amalfi|positano|ravello|praiano|maiori|minori|cetara|atrani|sorrento|vietri sul mare)([^a-z]|$)' then 'costiera-amalfitana' end,
    case when p_text ~* '(^|[^a-z])(pompei|pompeii|scafati|torre annunziata|oplontis)([^a-z]|$)' then 'pompei' end
  ], null), '{}'::text[])
$$;

-- La regione e' un legame debole: stessa area di una guida, non la stessa citta'.
create or replace function public.tourism_guide_slugs_region(p_region text)
returns text[]
language sql immutable set search_path = public as $$
  select case
    when p_region ~* 'veneto' then array['venezia']
    when p_region ~* 'emilia' then array['bologna']
    when p_region ~* 'lombard' then array['milano']
    when p_region ~* 'lazio' then array['roma']
    when p_region ~* 'tosc' then array['firenze']
    when p_region ~* 'campania' then array['napoli','capri','costiera-amalfitana','pompei']
    else '{}'::text[] end
$$;

-- Aeroporti e porti delle nove guide.
create or replace function public.tourism_guide_slugs_hub(p_iata text, p_text text)
returns text[]
language sql immutable set search_path = public as $$
  select case upper(coalesce(p_iata, ''))
    when 'VCE' then array['venezia'] when 'TSF' then array['venezia']
    when 'BLQ' then array['bologna']
    when 'MXP' then array['milano'] when 'LIN' then array['milano'] when 'BGY' then array['milano']
    when 'FCO' then array['roma'] when 'CIA' then array['roma']
    when 'FLR' then array['firenze'] when 'PSA' then array['firenze']
    when 'NAP' then array['napoli','capri','costiera-amalfitana','pompei']
    else public.tourism_guide_slugs_in(coalesce(p_text, '')) end
$$;

-- Il primo numero di una fascia di dipendenti ("51-200", "10001+").
create or replace function public.tourism_employees_floor(p_text text)
returns integer
language sql immutable set search_path = public as $$
  select nullif(substring(replace(coalesce(p_text, ''), ',', '') from '[0-9]+'), '')::integer
$$;

create or replace function public.tourism_distribution_recompute()
returns jsonb
language plpgsql set search_path = public as $$
declare
  v_owner uuid := auth.uid();
  v_rows integer;
  v_tiers jsonb;
begin
  if v_owner is null then
    raise exception 'tourism_distribution_recompute: serve un utente autenticato';
  end if;

  with hubs as (
    select o.entity_id,
           array_agg(distinct s) filter (where s is not null) as slugs,
           count(distinct h.id) filter (where cardinality(public.tourism_guide_slugs_hub(h.iata, h.name || ' ' || coalesce(h.destination, ''))) > 0) as guide_hubs
      from public.tourism_hub_operators o
      join public.tourism_hubs h on h.id = o.hub_id and h.user_id = v_owner
      left join lateral unnest(public.tourism_guide_slugs_hub(h.iata, h.name || ' ' || coalesce(h.destination, ''))) s on true
     where o.user_id = v_owner
     group by o.entity_id
  ),
  base as (
    select e.id, e.type_code, e.country_code,
           coalesce(nullif(e.website, ''), null) as website,
           coalesce(nullif(e.email, ''), null) as email,
           coalesce(nullif(e.phone, ''), null) as phone,
           e.details,
           lower(coalesce(e.details->>'hq_city', '')) as hq_city,
           lower(coalesce(e.details->>'hq_region', '')) as hq_region,
           lower(concat_ws(' ', e.name, e.details->>'description', e.details->>'sells')) as txt,
           public.tourism_employees_floor(e.details->>'employees') as emp,
           (e.details->>'calls_naples')::boolean is true as calls_naples,
           (e.details->>'calls_civitavecchia')::boolean is true as calls_civ,
           coalesce(h.slugs, '{}'::text[]) as hub_slugs,
           coalesce(h.guide_hubs, 0) as guide_hubs,
           exists (select 1 from public.tourism_crm_links l where l.entity_id = e.id) as in_crm
      from public.tourism_entities e
      left join hubs h on h.entity_id = e.id
     where e.user_id = v_owner and e.kind = 'organization' and not e.disabled
       and e.type_code in ('dmc','tour_operator','travel_agency','ota','bedbank','experience_marketplace',
                           'accommodation','property_manager','cruise_line','ferry_operator','transport',
                           'airline','technology','tourism_supplier','network','consortium','association',
                           'travel_media')
  ),
  feat as (
    select b.*,
           public.tourism_guide_slugs_in(b.hq_city) as hq_slugs,
           public.tourism_guide_slugs_in(b.txt) as txt_slugs,
           public.tourism_guide_slugs_region(b.hq_region) as reg_slugs
      from base b
  ),
  slugs as (
    select f.*,
           (select coalesce(array_agg(distinct s order by s), '{}'::text[]) from unnest(
              f.hq_slugs || f.txt_slugs || f.hub_slugs
              || case when f.calls_naples then array['napoli'] else '{}'::text[] end
              || case when f.calls_civ then array['roma'] else '{}'::text[] end) s) as strong_slugs
      from feat f
  ),
  comp as (
    select s.*,
      -- 1. Destinazioni (20)
      case
        when cardinality(s.hq_slugs) > 0 then 100
        when s.calls_naples or s.calls_civ then 92
        when s.guide_hubs >= 3 then 90
        when s.guide_hubs = 2 then 78
        when s.guide_hubs = 1 then 62
        when cardinality(s.txt_slugs) > 0 then least(80, 62 + 6 * cardinality(s.txt_slugs))
        when cardinality(s.reg_slugs) > 0 then 55
        when s.country_code = 'IT' then 35
        when s.txt ~* '(italy|italia|italie|italien|italya)' then 30
        else 8 end as c_dest,
      -- 2. Potenziale distributivo (25)
      least(100, round(
        case when s.emp is not null
          then 0.6 * case when s.emp <= 10 then 15 when s.emp <= 50 then 30 when s.emp <= 200 then 50
                          when s.emp <= 500 then 65 when s.emp <= 1000 then 78 when s.emp <= 5000 then 90
                          when s.emp <= 10000 then 95 else 100 end
               + 0.4 * (case s.type_code when 'ota' then 85 when 'cruise_line' then 80 when 'airline' then 60
                         when 'ferry_operator' then 70 when 'transport' then 55 when 'network' then 70
                         when 'consortium' then 65 when 'tour_operator' then 55 when 'dmc' then 45
                         when 'travel_agency' then 40 when 'property_manager' then 45 when 'accommodation' then 40
                         when 'technology' then 50 when 'experience_marketplace' then 80 when 'bedbank' then 75
                         when 'travel_media' then 35 else 25 end)
          else 0.7 * (case s.type_code when 'ota' then 85 when 'cruise_line' then 80 when 'airline' then 60
                         when 'ferry_operator' then 70 when 'transport' then 55 when 'network' then 70
                         when 'consortium' then 65 when 'tour_operator' then 55 when 'dmc' then 45
                         when 'travel_agency' then 40 when 'property_manager' then 45 when 'accommodation' then 40
                         when 'technology' then 50 when 'experience_marketplace' then 80 when 'bedbank' then 75
                         when 'travel_media' then 35 else 25 end)
        end
        + case when s.type_code = 'airline' then 8 * least(s.guide_hubs, 6) else 0 end)) as c_dist,
      -- 3. Compatibilita' commerciale (20)
      case s.type_code when 'ota' then 90 when 'tour_operator' then 90 when 'dmc' then 85
        when 'property_manager' then 90 when 'ferry_operator' then 90 when 'experience_marketplace' then 90
        when 'cruise_line' then 85 when 'transport' then 80 when 'travel_agency' then 75
        when 'technology' then 75 when 'accommodation' then 70 when 'airline' then 70
        when 'network' then 70 when 'consortium' then 70 when 'bedbank' then 60 when 'travel_media' then 60
        when 'tourism_supplier' then 50 when 'association' then 40 else 30 end as c_comm,
      -- 4. Facilita' di attivazione (15)
      least(100, greatest(0, 50
        + case when s.emp is null then 0 when s.emp <= 50 then 20 when s.emp <= 200 then 10 when s.emp <= 1000 then 0 else -15 end
        + case when s.country_code = 'IT' then 15 else 0 end
        + case when s.email is not null then 10 else 0 end
        + case when s.phone is not null then 5 else 0 end
        + case when s.website is not null then 5 else 0 end
        + case when s.type_code in ('ferry_operator','property_manager') then 10
               when s.type_code in ('dmc','tour_operator') then 5 else 0 end)) as c_act,
      -- 5. Accesso ai contatti (10)
      least(100, (case when s.email is not null then 55 else 0 end)
        + (case when s.phone is not null then 25 else 0 end)
        + (case when s.website is not null then 15 else 0 end)
        + (case when s.in_crm then 5 else 0 end)) as c_contact,
      -- 6. Servizi complementari (10)
      case s.type_code when 'ota' then 85 when 'experience_marketplace' then 90 when 'property_manager' then 80
        when 'accommodation' then 75 when 'dmc' then 75 when 'tour_operator' then 75 when 'ferry_operator' then 70
        when 'cruise_line' then 70 when 'transport' then 70 when 'airline' then 65 when 'travel_agency' then 60
        when 'technology' then 60 when 'network' then 55 when 'consortium' then 55 when 'travel_media' then 50
        when 'bedbank' then 50 else 35 end as c_comp,
      (case when s.website is not null then 1 else 0 end + case when s.email is not null then 1 else 0 end
       + case when s.phone is not null then 1 else 0 end + case when s.emp is not null then 1 else 0 end
       + case when s.hq_city <> '' then 1 else 0 end
       + case when coalesce(s.details->>'description', '') <> '' then 1 else 0 end) as known
    from slugs s
  ),
  scored as (
    select c.*,
      round(0.20 * c.c_dest + 0.25 * c.c_dist + 0.20 * c.c_comm + 0.15 * c.c_act + 0.10 * c.c_contact + 0.10 * c.c_comp)::int as total
    from comp c
  ),
  final as (
    select sc.*,
      case when sc.total >= 72 then 'A' when sc.total >= 58 then 'B' when sc.total >= 44 then 'C' else 'D' end as tier_v,
      case when sc.c_dist >= 80 then 'very_high' when sc.c_dist >= 60 then 'high' when sc.c_dist >= 40 then 'medium' else 'low' end as vol,
      case sc.type_code
        when 'ota' then 'affiliate' when 'experience_marketplace' then 'affiliate' when 'travel_media' then 'affiliate'
        when 'technology' then 'affiliate'
        when 'tour_operator' then 'resale' when 'dmc' then 'resale' when 'travel_agency' then 'resale'
        when 'bedbank' then 'resale'
        when 'property_manager' then 'b2b_guests' when 'accommodation' then 'b2b_guests'
        when 'ferry_operator' then 'bundle' when 'cruise_line' then 'bundle' when 'transport' then 'bundle'
        when 'airline' then 'bundle'
        else 'revenue_share' end as model_v,
      case sc.type_code
        when 'ota' then 'revenue_share' when 'experience_marketplace' then 'revenue_share'
        when 'travel_media' then 'revenue_share' when 'technology' then 'revenue_share'
        when 'tour_operator' then 'bundle' when 'dmc' then 'bundle' when 'travel_agency' then 'affiliate'
        when 'bedbank' then 'affiliate'
        when 'property_manager' then 'bundle' when 'accommodation' then 'bundle'
        when 'ferry_operator' then 'b2b_guests' when 'cruise_line' then 'b2b_guests' when 'transport' then 'b2b_guests'
        when 'airline' then 'affiliate'
        else 'affiliate' end as model_alt_v
    from scored sc
  )
  insert into public.tourism_distribution as d
    (entity_id, user_id, score, tier, components, completeness, guide_slugs, destination_basis,
     volume_potential, model, model_alt, strategic, quick_win, scored_at, updated_at)
  select f.id, v_owner, f.total, f.tier_v,
         jsonb_build_object('destinations', f.c_dest, 'distribution', f.c_dist, 'commercial', f.c_comm,
                            'activation', f.c_act, 'contacts', f.c_contact, 'complementary', f.c_comp),
         round(100.0 * f.known / 6)::int,
         case when cardinality(f.strong_slugs) > 0 then f.strong_slugs else f.reg_slugs end,
         jsonb_build_object('hq', f.hq_slugs, 'text', f.txt_slugs, 'hubs', f.hub_slugs, 'region', f.reg_slugs,
                            'cruise_naples', f.calls_naples, 'cruise_civitavecchia', f.calls_civ),
         f.vol, f.model_v, f.model_alt_v,
         (f.tier_v = 'A' and f.c_dist >= 75),
         (f.tier_v in ('A','B') and f.c_act >= 70 and f.email is not null),
         now(), now()
    from final f
  on conflict (entity_id) do update set
    score = excluded.score, tier = excluded.tier, components = excluded.components,
    completeness = excluded.completeness, guide_slugs = excluded.guide_slugs,
    destination_basis = excluded.destination_basis, volume_potential = excluded.volume_potential,
    model = excluded.model, model_alt = excluded.model_alt, strategic = excluded.strategic,
    quick_win = excluded.quick_win, scored_at = now(), updated_at = now();

  get diagnostics v_rows = row_count;
  select coalesce(jsonb_object_agg(tier, n), '{}'::jsonb) into v_tiers
    from (select tier, count(*) n from public.tourism_distribution where user_id = v_owner group by tier) t;
  return jsonb_build_object('scored', v_rows, 'tiers', v_tiers);
end $$;

revoke all on function public.tourism_distribution_recompute() from public, anon;
grant execute on function public.tourism_distribution_recompute() to authenticated;
