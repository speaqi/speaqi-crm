-- Tourism Intelligence contiene tutti gli espositori delle fiere: la riga della
-- fiera (trade_fair_exhibitors) diventa una partecipazione collegata alla sua
-- scheda. I Comuni hanno una categoria loro.
--
-- Applicata in produzione il 21/10/2026 insieme all'import dei 1.645 espositori
-- TTG mancanti (tourism_import, a blocchi di 200).

insert into public.tourism_taxonomy(code, labels, governance) values
 ('municipality','{"it":"Comune","en":"Municipality"}',true)
on conflict (code) do nothing;

alter table public.trade_fair_exhibitors
  add column if not exists entity_id uuid references public.tourism_entities(id) on delete set null;
create index if not exists trade_fair_exhibitors_entity_idx
  on public.trade_fair_exhibitors(entity_id) where entity_id is not null;
