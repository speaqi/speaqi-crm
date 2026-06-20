create table if not exists public.acumbamail_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null,
  name text not null,
  list_name text not null,
  min_opens integer not null default 5 check (min_opens > 0),
  responsible text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, campaign_key)
);

create table if not exists public.acumbamail_campaign_engagements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null,
  email text not null,
  name text,
  open_count integer not null default 0 check (open_count >= 0),
  click_count integer not null default 0 check (click_count >= 0),
  last_open_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, campaign_key, email)
);

create index if not exists acumbamail_engagement_campaign_idx
  on public.acumbamail_campaign_engagements(user_id, campaign_key, open_count desc);

alter table public.acumbamail_campaigns enable row level security;
alter table public.acumbamail_campaign_engagements enable row level security;

create policy "acumbamail_campaigns_owner"
on public.acumbamail_campaigns for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "acumbamail_engagements_owner"
on public.acumbamail_campaign_engagements for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.record_acumbamail_campaign_open(
  p_user_id uuid,
  p_campaign_key text,
  p_email text,
  p_name text default null,
  p_occurred_at timestamptz default now()
)
returns public.acumbamail_campaign_engagements
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.acumbamail_campaign_engagements;
begin
  insert into public.acumbamail_campaign_engagements (
    user_id, campaign_key, email, name, open_count, last_open_at
  ) values (
    p_user_id, p_campaign_key, lower(btrim(p_email)), nullif(btrim(p_name), ''), 1, p_occurred_at
  )
  on conflict (user_id, campaign_key, email) do update set
    open_count = public.acumbamail_campaign_engagements.open_count + 1,
    name = coalesce(public.acumbamail_campaign_engagements.name, excluded.name),
    last_open_at = greatest(public.acumbamail_campaign_engagements.last_open_at, excluded.last_open_at),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.record_acumbamail_campaign_open(uuid, text, text, text, timestamptz) from public;
grant execute on function public.record_acumbamail_campaign_open(uuid, text, text, text, timestamptz) to service_role;
