alter table public.team_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists team_members_auth_user_unique
on public.team_members(auth_user_id)
where auth_user_id is not null;

-- Backfill where email uniquely maps to one auth user.
with unique_emails as (
  select lower(email) as email_lc
  from public.team_members
  where email is not null and btrim(email) <> ''
  group by lower(email)
  having count(*) = 1
)
update public.team_members tm
set auth_user_id = au.id
from auth.users au
join unique_emails ue on lower(au.email) = ue.email_lc
where lower(tm.email) = ue.email_lc
  and tm.auth_user_id is null;
