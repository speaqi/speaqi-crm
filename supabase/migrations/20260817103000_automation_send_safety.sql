-- Safe autonomous sending: durable attempts, atomic draft claims and daily quota.

alter table public.email_drafts drop constraint if exists email_drafts_status_check;
alter table public.email_drafts
  add constraint email_drafts_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'unknown', 'dismissed'));

alter table public.email_drafts
  add column if not exists send_attempt_id uuid,
  add column if not exists sending_at timestamptz,
  add column if not exists send_attempts integer not null default 0,
  add column if not exists last_send_error text,
  add column if not exists provider_message_id text;

create index if not exists email_drafts_automation_queue_idx
  on public.email_drafts (user_id, status, created_at, id)
  where source = 'auto';
create unique index if not exists email_drafts_send_attempt_unique
  on public.email_drafts (send_attempt_id) where send_attempt_id is not null;
create unique index if not exists email_drafts_provider_message_unique
  on public.email_drafts (provider_message_id) where provider_message_id is not null;

create table if not exists public.automation_send_attempts (
  id uuid primary key,
  workspace_user_id uuid not null references auth.users(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null check (status in (
    'claimed', 'provider_accepted', 'sent', 'failed_pre_send', 'failed', 'unknown', 'reconciled'
  )),
  recipient_email text not null,
  message_id_header text not null unique,
  provider_message_id text unique,
  quota_day date not null,
  error_code text,
  error_detail text,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists automation_send_attempts_active_draft_unique
  on public.automation_send_attempts (draft_id)
  where status in ('claimed', 'provider_accepted', 'unknown');
create index if not exists automation_send_attempts_reconcile_idx
  on public.automation_send_attempts (status, claimed_at)
  where status in ('claimed', 'provider_accepted', 'unknown');

create table if not exists public.automation_send_daily_counters (
  workspace_user_id uuid not null references auth.users(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  local_day date not null,
  reserved_count integer not null default 0 check (reserved_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_user_id, sender_user_id, local_day)
);

alter table public.automation_send_attempts enable row level security;
alter table public.automation_send_daily_counters enable row level security;

create or replace function public.claim_automation_draft(
  p_draft_id uuid,
  p_workspace_user_id uuid,
  p_sender_user_id uuid,
  p_attempt_id uuid,
  p_local_day date,
  p_daily_cap integer,
  p_message_id_header text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id uuid;
  v_email text;
  v_reserved boolean := false;
begin
  if p_daily_cap < 1 or p_message_id_header is null or length(trim(p_message_id_header)) = 0 then
    return false;
  end if;

  select d.contact_id, lower(trim(c.email))
    into v_contact_id, v_email
  from public.email_drafts d
  join public.contacts c on c.id = d.contact_id
  where d.id = p_draft_id
    and d.user_id = p_workspace_user_id
    and c.user_id = p_workspace_user_id
    and d.status = 'pending'
    and d.source = 'auto'
    and c.contact_scope = 'holding'
  for update of d;

  if v_contact_id is null or v_email is null then return false; end if;

  if not exists (
    select 1 from public.gmail_accounts
    where user_id = p_sender_user_id and user_id = p_workspace_user_id
  ) then return false; end if;

  insert into public.automation_send_daily_counters (
    workspace_user_id, sender_user_id, local_day
  ) values (p_workspace_user_id, p_sender_user_id, p_local_day)
  on conflict do nothing;

  update public.automation_send_daily_counters
  set reserved_count = reserved_count + 1, updated_at = now()
  where workspace_user_id = p_workspace_user_id
    and sender_user_id = p_sender_user_id
    and local_day = p_local_day
    and reserved_count + sent_count < p_daily_cap
  returning true into v_reserved;

  if not coalesce(v_reserved, false) then return false; end if;

  insert into public.automation_send_attempts (
    id, workspace_user_id, sender_user_id, draft_id, contact_id, status,
    recipient_email, message_id_header, quota_day
  ) values (
    p_attempt_id, p_workspace_user_id, p_sender_user_id, p_draft_id,
    v_contact_id, 'claimed', v_email, p_message_id_header, p_local_day
  );

  update public.email_drafts
  set status = 'sending', send_attempt_id = p_attempt_id, sending_at = now(),
      send_attempts = send_attempts + 1, last_send_error = null
  where id = p_draft_id and status = 'pending';

  if not found then raise exception 'draft_claim_lost'; end if;
  return true;
end;
$$;

create or replace function public.finish_automation_send(
  p_attempt_id uuid,
  p_provider_message_id text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_attempt public.automation_send_attempts%rowtype;
begin
  select * into v_attempt from public.automation_send_attempts
  where id = p_attempt_id for update;
  if not found then return false; end if;
  if v_attempt.status in ('sent', 'reconciled') then return true; end if;
  if v_attempt.status not in ('claimed', 'provider_accepted', 'unknown') then return false; end if;

  update public.automation_send_attempts
    set status = 'sent', provider_message_id = p_provider_message_id,
        completed_at = now(), updated_at = now()
    where id = p_attempt_id;
  update public.email_drafts
    set status = 'sent', sent_at = now(), provider_message_id = p_provider_message_id,
        last_send_error = null
    where id = v_attempt.draft_id and send_attempt_id = p_attempt_id;
  update public.automation_send_daily_counters
    set reserved_count = greatest(0, reserved_count - 1), sent_count = sent_count + 1,
        updated_at = now()
    where workspace_user_id = v_attempt.workspace_user_id
      and sender_user_id = v_attempt.sender_user_id and local_day = v_attempt.quota_day;
  return true;
end;
$$;

create or replace function public.fail_automation_send_pre_provider(
  p_attempt_id uuid,
  p_error_code text,
  p_error_detail text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_attempt public.automation_send_attempts%rowtype;
begin
  select * into v_attempt from public.automation_send_attempts
  where id = p_attempt_id and status = 'claimed' for update;
  if not found then return false; end if;
  update public.automation_send_attempts
    set status = 'failed_pre_send', error_code = p_error_code,
        error_detail = left(p_error_detail, 1000), completed_at = now(), updated_at = now()
    where id = p_attempt_id;
  update public.email_drafts
    set status = 'failed', last_send_error = left(p_error_detail, 1000)
    where id = v_attempt.draft_id and send_attempt_id = p_attempt_id;
  update public.automation_send_daily_counters
    set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where workspace_user_id = v_attempt.workspace_user_id
      and sender_user_id = v_attempt.sender_user_id and local_day = v_attempt.quota_day;
  return true;
end;
$$;

create or replace function public.mark_automation_send_unknown(
  p_attempt_id uuid,
  p_error_detail text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_draft_id uuid;
begin
  update public.automation_send_attempts
    set status = 'unknown', error_code = 'provider_outcome_unknown',
        error_detail = left(p_error_detail, 1000), updated_at = now()
    where id = p_attempt_id and status in ('claimed', 'provider_accepted')
    returning draft_id into v_draft_id;
  if v_draft_id is null then return false; end if;
  update public.email_drafts set status = 'unknown', last_send_error = left(p_error_detail, 1000)
    where id = v_draft_id and send_attempt_id = p_attempt_id;
  return true;
end;
$$;

create or replace function public.fail_reconciled_automation_send(
  p_attempt_id uuid,
  p_error_detail text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_attempt public.automation_send_attempts%rowtype;
begin
  select * into v_attempt from public.automation_send_attempts
    where id = p_attempt_id and status in ('claimed', 'provider_accepted', 'unknown') for update;
  if not found then return false; end if;
  update public.automation_send_attempts set status = 'failed', error_code = 'provider_not_found',
    error_detail = left(p_error_detail, 1000), completed_at = now(), updated_at = now()
    where id = p_attempt_id;
  update public.email_drafts set status = 'failed', last_send_error = left(p_error_detail, 1000)
    where id = v_attempt.draft_id and send_attempt_id = p_attempt_id;
  update public.automation_send_daily_counters
    set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where workspace_user_id = v_attempt.workspace_user_id
      and sender_user_id = v_attempt.sender_user_id and local_day = v_attempt.quota_day;
  return true;
end;
$$;

revoke all on function public.claim_automation_draft(uuid, uuid, uuid, uuid, date, integer, text) from public, anon, authenticated;
revoke all on function public.finish_automation_send(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_automation_send_pre_provider(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_automation_send_unknown(uuid, text) from public, anon, authenticated;
revoke all on function public.fail_reconciled_automation_send(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_automation_draft(uuid, uuid, uuid, uuid, date, integer, text) to service_role;
grant execute on function public.finish_automation_send(uuid, text) to service_role;
grant execute on function public.fail_automation_send_pre_provider(uuid, text, text) to service_role;
grant execute on function public.mark_automation_send_unknown(uuid, text) to service_role;
grant execute on function public.fail_reconciled_automation_send(uuid, text) to service_role;
