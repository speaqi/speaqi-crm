-- Idee per vendere le guide ai partner (area Marketing del CRM).
--
-- Le idee di partenza stanno nel codice (`src/lib/marketing-ideas.ts`): qui
-- si salva solo lo stato di lavoro di ognuna (stato, responsabile, scadenza,
-- avanzamento, note) e le idee scritte a mano dall'interfaccia, che hanno
-- `title` valorizzato. Una riga per (proprietario, idea).
--
-- Solo additiva: nessun dato esistente viene toccato.
create table if not exists public.marketing_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  idea_key text not null check (char_length(idea_key) between 1 and 80),
  status text not null default 'Backlog'
    check (status in ('Backlog', 'Da validare', 'Pianificata', 'In corso', 'Bloccata', 'Completata')),
  owner text not null default '' check (char_length(owner) <= 80),
  deadline date,
  progress integer not null default 0 check (progress between 0 and 100),
  notes text not null default '' check (char_length(notes) <= 4000),
  -- Solo per le idee scritte a mano: quelle di partenza vengono dal codice.
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  category text check (category is null or char_length(category) <= 40),
  budget text check (budget is null or budget in ('< €500', '€500–€5k', '€5k+', 'Partnership')),
  description text check (description is null or char_length(description) <= 1500),
  next_action text check (next_action is null or char_length(next_action) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idea_key)
);

alter table public.marketing_ideas enable row level security;

drop policy if exists "marketing_ideas_owner" on public.marketing_ideas;
create policy "marketing_ideas_owner" on public.marketing_ideas
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.marketing_ideas is
  'Stato di lavoro delle idee per vendere le guide ai partner (/marketing/idee) e idee scritte a mano. Solo del proprietario del workspace.';
