-- Porti del mondo e superguide: da "chi arriva a Napoli" a "quali citta'
-- raccontare dopo".
--
-- L'anagrafica porti nasce per legare le tappe degli itinerari. Ora deve anche
-- dire quanto conta un porto (passeggeri e scali l'anno, con la fonte), dove sta
-- (macro-regione e sotto-area), che citta' serve davvero — Civitavecchia porta
-- a Roma, Laem Chabang a Bangkok: la superguida e' della citta', non del molo —
-- e a che punto e' la superguida Speaqi di quella citta'.

alter table public.shipping_ports
  add column if not exists region text check (region is null or char_length(btrim(region)) between 1 and 80),
  add column if not exists subregion text check (subregion is null or char_length(btrim(subregion)) between 1 and 120),
  -- La citta'/destinazione che i passeggeri visitano quando il porto e' altrove.
  add column if not exists destination text check (destination is null or char_length(btrim(destination)) between 1 and 160),
  -- Movimenti passeggeri crocieristici in un anno (imbarchi + sbarchi + transiti), come li pubblica la fonte.
  add column if not exists cruise_passengers integer check (cruise_passengers is null or cruise_passengers >= 0),
  add column if not exists passengers_year smallint check (passengers_year is null or passengers_year between 1990 and 2100),
  add column if not exists cruise_calls integer check (cruise_calls is null or cruise_calls >= 0),
  add column if not exists stats_source text,
  -- Porto d'imbarco di linee regolari (null = non noto).
  add column if not exists is_homeport boolean,
  -- A che punto e' la superguida Speaqi della citta' servita da questo porto.
  add column if not exists guide_status text not null default 'none'
    check (guide_status in ('none', 'planned', 'in_progress', 'live', 'skip')),
  add column if not exists guide_notes text;

-- Un anno senza numero, o un numero senza anno, non si confronta con niente.
alter table public.shipping_ports drop constraint if exists shipping_ports_passengers_need_year;
alter table public.shipping_ports add constraint shipping_ports_passengers_need_year
  check (cruise_passengers is null or passengers_year is not null);

create index if not exists shipping_ports_region_idx on public.shipping_ports (user_id, region);
