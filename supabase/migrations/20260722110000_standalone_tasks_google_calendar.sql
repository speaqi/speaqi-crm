alter table public.tasks
  add column if not exists calendar_event_id text,
  add column if not exists calendar_event_link text,
  add column if not exists calendar_synced_at timestamptz;

create index if not exists tasks_calendar_event_idx
  on public.tasks(user_id, calendar_event_id)
  where calendar_event_id is not null;
