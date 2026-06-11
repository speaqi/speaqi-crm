-- Business goals: obiettivi annuali / trimestrali / mensili per la dashboard finanziaria

create table if not exists public.business_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_type text not null check (period_type in ('annual', 'quarterly', 'monthly')),
  period_start date not null,
  metric text not null default 'revenue' check (metric in ('revenue', 'paid_revenue', 'new_clients', 'quotes_sent')),
  target_amount numeric(14,2) not null check (target_amount >= 0),
  label text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists business_goals_user_period_metric_idx
  on public.business_goals (user_id, period_type, period_start, metric);

create index if not exists business_goals_user_idx
  on public.business_goals (user_id, period_start desc);

drop trigger if exists set_business_goals_updated_at on public.business_goals;
create trigger set_business_goals_updated_at
before update on public.business_goals
for each row execute function public.set_updated_at();

alter table public.business_goals enable row level security;

drop policy if exists "business_goals_workspace" on public.business_goals;
create policy "business_goals_workspace"
on public.business_goals
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    where tm.user_id = business_goals.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    where tm.user_id = business_goals.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);
