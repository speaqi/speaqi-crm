-- Presentazioni Tourism: due basi di partenza invece di una.
--   destination  = partnership destinazioni (l'ente distribuisce le guide, noi le facciamo)
--   distribution = partnership di distribuzione (compagnie di navigazione, tour operator, aeroporti, reti di vendita)
-- Ogni proprietario ha un modello di partenza per tipo; ogni presentazione ricorda da quale è nata,
-- cosi' una rigenerazione riparte dalla base giusta. Le righe esistenti sono tutte `destination`.
-- Additiva: nessun dato riscritto, il modello salvato resta com'e'.

alter table public.tourism_deck_templates
  add column if not exists kind text not null default 'destination' check (kind in ('destination','distribution'));
alter table public.tourism_decks
  add column if not exists template_kind text not null default 'destination' check (template_kind in ('destination','distribution'));

-- Prima un solo modello di partenza per proprietario, ora uno per proprietario e tipo.
drop index if exists public.tourism_deck_templates_default_idx;
create unique index if not exists tourism_deck_templates_default_kind_idx on public.tourism_deck_templates(user_id, kind) where is_default;
