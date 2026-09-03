-- To Do board: le "cose da fare" escono dalla dashboard e diventano una pagina
-- a sé (/todo), unico punto dove segnare anche le attività extra Speaqi.
-- I task standalone (contact_id is null, type = 'todo') avevano solo titolo,
-- data e spunta: qui aggiungiamo l'area di appartenenza, lo stato di
-- avanzamento con percentuale e la data di inizio, che serve a disegnare le
-- barre della vista Gantt.

alter table public.tasks
  add column if not exists area text not null default 'speaqi',
  add column if not exists progress_state text not null default 'todo',
  add column if not exists progress_percent integer not null default 0,
  add column if not exists start_date timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_area_check'
  ) then
    alter table public.tasks
      add constraint tasks_area_check check (area in ('speaqi', 'personale', 'altro'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tasks_progress_state_check'
  ) then
    alter table public.tasks
      add constraint tasks_progress_state_check
      check (progress_state in ('todo', 'in_progress', 'blocked', 'done'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tasks_progress_percent_check'
  ) then
    alter table public.tasks
      add constraint tasks_progress_percent_check
      check (progress_percent between 0 and 100);
  end if;
end
$$;

-- Backfill: lo stato di avanzamento deve partire allineato allo status binario
-- già esistente, altrimenti tutte le attività chiuse risulterebbero "da fare".
update public.tasks
  set progress_state = 'done', progress_percent = 100
  where status = 'done' and progress_state <> 'done';

update public.tasks
  set progress_state = 'in_progress'
  where status = 'pending' and started_at is not null and progress_state = 'todo';

-- La vista Gantt legge tutte le attività standalone in una finestra di date.
create index if not exists tasks_user_standalone_span_idx
  on public.tasks(user_id, start_date, due_date)
  where contact_id is null;

comment on column public.tasks.area is
  'Ambito dell''attività standalone: speaqi (lavoro), personale, altro. Serve al filtro e al colore della barra nel Gantt di /todo.';

comment on column public.tasks.progress_state is
  'Stato di avanzamento: todo, in_progress, blocked, done. Resta allineato a status (pending/done) dalla rotta /api/tasks/standalone.';

comment on column public.tasks.start_date is
  'Inizio previsto dell''attività: con due_date definisce la barra nella vista Gantt di /todo.';
