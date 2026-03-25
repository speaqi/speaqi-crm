create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  "order" integer not null,
  color text,
  system_key text,
  created_at timestamptz not null default now(),
  unique(user_id, name),
  unique(user_id, "order")
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  status text not null,
  source text not null default 'manual',
  priority integer not null default 0 check (priority between 0 and 3),
  responsible text,
  value numeric(12,2),
  note text,
  legacy_id text,
  last_activity_summary text,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, legacy_id)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  type text not null,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  type text not null,
  due_date timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done')),
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  "to" text not null,
  subject text,
  type text,
  status text,
  created_at timestamptz not null default now()
);

create index if not exists contacts_user_status_idx on public.contacts(user_id, status);
create index if not exists contacts_user_followup_idx on public.contacts(user_id, next_followup_at);
create index if not exists activities_user_contact_idx on public.activities(user_id, contact_id, created_at desc);
create index if not exists tasks_user_status_due_idx on public.tasks(user_id, status, due_date);

drop trigger if exists set_contacts_updated_at on public.contacts;
create trigger set_contacts_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

alter table public.pipeline_stages enable row level security;
alter table public.contacts enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.email_logs enable row level security;

drop policy if exists "pipeline_stages_owner" on public.pipeline_stages;
create policy "pipeline_stages_owner"
on public.pipeline_stages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "contacts_owner" on public.contacts;
create policy "contacts_owner"
on public.contacts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "activities_owner" on public.activities;
create policy "activities_owner"
on public.activities
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "tasks_owner" on public.tasks;
create policy "tasks_owner"
on public.tasks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "email_logs_owner" on public.email_logs;
create policy "email_logs_owner"
on public.email_logs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
