alter table public.tasks
  add column if not exists started_at timestamptz,
  add column if not exists rescheduled_at timestamptz,
  add column if not exists reschedule_count integer not null default 0;

create index if not exists tasks_user_standalone_due_idx
  on public.tasks(user_id, contact_id, status, due_date);
