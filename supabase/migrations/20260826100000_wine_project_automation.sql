-- Configurazione e pianificazione della sequenza commerciale Wine Project.
-- Gli eventi non inviano email da soli: portano il contatto nella coda CRM,
-- dove le automazioni esistenti possono creare la bozza e dove risposta,
-- disiscrizione e chiusura bloccano ogni passaggio successivo.

create table if not exists public.wine_project_automation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  campaign_name text not null default 'Wine Project — Vinitaly',
  acumbamail_list_id text,
  acumbamail_campaign_id text,
  first_followup_days integer not null default 1 check (first_followup_days between 1 and 14),
  second_followup_days integer not null default 5 check (second_followup_days between 2 and 30),
  third_followup_days integer not null default 12 check (third_followup_days between 3 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (second_followup_days > first_followup_days),
  check (third_followup_days > second_followup_days)
);

drop trigger if exists set_wine_project_automation_settings_updated_at on public.wine_project_automation_settings;
create trigger set_wine_project_automation_settings_updated_at
before update on public.wine_project_automation_settings
for each row execute function public.set_updated_at();

create table if not exists public.wine_project_followup_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 3),
  due_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'queued', 'skipped')),
  queued_at timestamptz,
  skipped_at timestamptz,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contact_id, sequence)
);

drop trigger if exists set_wine_project_followup_events_updated_at on public.wine_project_followup_events;
create trigger set_wine_project_followup_events_updated_at
before update on public.wine_project_followup_events
for each row execute function public.set_updated_at();

create index if not exists wine_project_followup_events_due_idx
  on public.wine_project_followup_events(user_id, status, due_at);

alter table public.wine_project_automation_settings enable row level security;
alter table public.wine_project_followup_events enable row level security;

create policy "wine_project_automation_settings_owner" on public.wine_project_automation_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "wine_project_followup_events_owner" on public.wine_project_followup_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
