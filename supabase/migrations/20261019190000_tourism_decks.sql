-- Presentazioni per destinazione (Tourism Intelligence).
-- Un modello generico modificabile (la presentazione TTG) e un deck per ogni destinazione/ente.
-- Foto e documenti stanno nel bucket privato "tourism-deck-assets" (creato dall'API alla prima
-- richiesta, come il bucket dei backup); qui restano solo i riferimenti.
-- Operazioni riservate al proprietario del workspace; la vista pubblica passa dal service role
-- con il token del deck, mai da una policy aperta.

create table public.tourism_deck_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Mappa per destinazioni (TTG)' check (length(btrim(name)) between 1 and 120),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  is_default boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Un solo modello di partenza per proprietario.
create unique index tourism_deck_templates_default_idx on public.tourism_deck_templates(user_id) where is_default;

create table public.tourism_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id uuid references public.tourism_entities(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  destination text not null check (length(btrim(destination)) between 1 and 200),
  input jsonb not null default '{}' check (jsonb_typeof(input) = 'object'),
  notes text not null default '' check (length(notes) <= 30000),
  assets jsonb not null default '[]' check (jsonb_typeof(assets) = 'array'),
  slides jsonb not null default '[]' check (jsonb_typeof(slides) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  status text not null default 'draft' check (status in ('draft','generating','ready','approved','failed')),
  error text check (error is null or length(error) <= 1000),
  public_token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  generated_at timestamptz,
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_at is not null))
);
create index tourism_decks_owner_idx on public.tourism_decks(user_id, updated_at desc);
create index tourism_decks_entity_idx on public.tourism_decks(entity_id) where entity_id is not null;

alter table public.tourism_deck_templates enable row level security;
alter table public.tourism_decks enable row level security;
create policy tourism_owner on public.tourism_deck_templates for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tourism_owner on public.tourism_decks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
