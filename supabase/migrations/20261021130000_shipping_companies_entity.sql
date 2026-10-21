-- Una compagnia di navigazione e' anche una scheda di Tourism Intelligence:
-- li' sta l'anagrafica unica, da cui si decide a chi scrivere. Navigazione
-- tiene flotta, scali e itinerari; il contatto in Contatti nasce solo quando
-- c'e' un contatto vero.

alter table public.shipping_companies
  add column if not exists entity_id uuid references public.tourism_entities(id) on delete set null;

create index if not exists shipping_companies_entity_idx
  on public.shipping_companies(entity_id) where entity_id is not null;
