alter table public.contacts
  add column if not exists company text,
  add column if not exists country text,
  add column if not exists language text,
  add column if not exists score integer not null default 0 check (score between 0 and 100),
  add column if not exists assigned_agent text,
  add column if not exists next_action_at timestamptz;

alter table public.activities
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tasks
  add column if not exists action text,
  add column if not exists priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  add column if not exists idempotency_key text;

create unique index if not exists tasks_user_idempotency_key_idx
on public.tasks(user_id, idempotency_key)
where idempotency_key is not null;

create table if not exists public.lead_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.contacts(id) on delete cascade,
  summary text,
  last_intent text,
  tone text,
  language_detected text,
  last_updated timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, lead_id)
);

create table if not exists public.ai_decision_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.contacts(id) on delete cascade,
  kind text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists contacts_user_next_action_idx on public.contacts(user_id, next_action_at);
create index if not exists activities_user_type_idx on public.activities(user_id, type, created_at desc);
create index if not exists tasks_user_action_due_idx on public.tasks(user_id, action, status, due_date);
create index if not exists lead_memories_user_lead_idx on public.lead_memories(user_id, lead_id);
create index if not exists ai_decision_logs_user_kind_idx on public.ai_decision_logs(user_id, kind, created_at desc);

create or replace function public.set_last_updated()
returns trigger
language plpgsql
as $$
begin
  new.last_updated = now();
  return new;
end;
$$;

drop trigger if exists set_lead_memories_last_updated on public.lead_memories;
create trigger set_lead_memories_last_updated
before update on public.lead_memories
for each row execute function public.set_last_updated();

alter table public.lead_memories enable row level security;
alter table public.ai_decision_logs enable row level security;

drop policy if exists "lead_memories_owner" on public.lead_memories;
create policy "lead_memories_owner"
on public.lead_memories
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "ai_decision_logs_owner" on public.ai_decision_logs;
create policy "ai_decision_logs_owner"
on public.ai_decision_logs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
