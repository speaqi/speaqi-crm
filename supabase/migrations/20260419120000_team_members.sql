create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, name)
);

create index if not exists team_members_user_idx on public.team_members(user_id, name);

drop trigger if exists team_members_set_updated_at on public.team_members;
create trigger team_members_set_updated_at
before update on public.team_members
for each row execute function public.set_updated_at();

alter table public.team_members enable row level security;

drop policy if exists "team_members_owner" on public.team_members;
create policy "team_members_owner"
on public.team_members
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
