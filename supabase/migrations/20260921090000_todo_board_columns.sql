-- Colonne della lavagna To Do decise da chi la usa.
--
-- Finora le colonne erano quattro raggruppamenti calcolati (avanzamento, data,
-- area, priorita): ognuno sa da solo dove mettere una scheda, ma nessuno si
-- puo piegare al modo in cui una persona lavora davvero — e "Fatte" occupa un
-- quarto della lavagna per roba che non si guarda piu.
--
-- Qui si aggiunge un raggruppamento in piu, fatto di colonne con un nome dato
-- a mano. Una scheda ci finisce solo perche qualcuno ce l'ha trascinata:
-- `board_column_id` e l'unico campo che dice dove sta, e vale soltanto in
-- questo raggruppamento. Gli altri quattro restano calcolati e non toccano
-- questa colonna.
create table if not exists public.todo_board_columns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  -- Riga sotto il titolo. Facoltativa: una colonna chiamata "Da fatturare" si
  -- spiega da sola.
  hint text,
  -- Suffisso della classe CSS del colore (accent, blue, green, …): la tavolozza
  -- vive nel foglio di stile, qui si sceglie solo quale.
  tone text not null default 'accent',
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists todo_board_columns_user_idx
  on public.todo_board_columns (user_id, position, created_at);

alter table public.todo_board_columns enable row level security;

drop policy if exists "todo_board_columns_owner" on public.todo_board_columns;
create policy "todo_board_columns_owner" on public.todo_board_columns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- `on delete set null`, non `cascade`: cancellare una colonna non deve
-- cancellare il lavoro che ci stava dentro. Le schede tornano in "Da
-- smistare", da dove si rismistano.
alter table public.tasks
  add column if not exists board_column_id uuid references public.todo_board_columns(id) on delete set null;

create index if not exists tasks_board_column_idx
  on public.tasks (board_column_id)
  where board_column_id is not null;

comment on table public.todo_board_columns is
  'Colonne personalizzate della lavagna /todo, una riga per colonna e per workspace. Usate solo dal raggruppamento "Le mie colonne".';

comment on column public.tasks.board_column_id is
  'Colonna personalizzata della lavagna To Do. Null = "Da smistare". Ignorato dagli altri raggruppamenti, che si calcolano dai dati.';
