-- Generic, vertical-aware commercial outreach engine. Hospitality is seeded in
-- a paused state: imports and dry-runs are safe before legal approval.

alter table public.contacts
  add column if not exists marketing_eligibility text not null default 'review'
    check (marketing_eligibility in ('eligible', 'review', 'excluded', 'suppressed')),
  add column if not exists marketing_reason text,
  add column if not exists marketing_legal_basis text,
  add column if not exists marketing_source_acquired_at timestamptz,
  add column if not exists normalized_website text,
  add column if not exists alternative_emails text[] not null default '{}',
  add column if not exists source_place_id text,
  add column if not exists source_google_id text,
  add column if not exists hospitality_filter_decision text
    check (hospitality_filter_decision is null or hospitality_filter_decision in ('include', 'review', 'exclude')),
  add column if not exists import_batch_id uuid;

create unique index if not exists contacts_user_source_place_unique
  on public.contacts(user_id, source_place_id)
  where source_place_id is not null and length(trim(source_place_id)) > 0;
create index if not exists contacts_hospitality_marketing_idx
  on public.contacts(user_id, event_tag, marketing_eligibility, hospitality_filter_decision);

create table if not exists public.commercial_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vertical text not null,
  list_name text not null,
  event_tag text not null,
  source text not null,
  source_file text not null,
  checksum_sha256 text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  dry_run boolean not null default true,
  cursor_row integer not null default 0,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  updated_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  eligible_rows integer not null default 0,
  review_rows integer not null default 0,
  excluded_rows integer not null default 0,
  error_rows integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, vertical, checksum_sha256)
);

create table if not exists public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vertical text not null,
  name text not null,
  list_name text not null,
  event_tag text not null,
  status text not null default 'paused' check (status in ('paused', 'active', 'completed')),
  approval_status text not null default 'analysis'
    check (approval_status in ('analysis', 'pending_legal', 'approved', 'rejected')),
  approval_note text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  daily_cap integer not null default 100 check (daily_cap between 1 and 10000),
  sender_name text not null default 'Massimo Morgante',
  sender_email text not null default 'info@speaqi.com',
  reply_to text,
  acumbamail_list_id text,
  cadence_days integer[] not null default '{1,4,9,16,28}',
  stop_on_open boolean not null default false,
  stop_on_click boolean not null default false,
  automatic_pause_bounce_rate numeric(6,3) not null default 5,
  automatic_pause_complaint_rate numeric(6,3) not null default 0.1,
  pilot_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, vertical, name)
);

create table if not exists public.commercial_campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  step_number integer not null check (step_number between 1 and 20),
  day_offset integer not null check (day_offset >= 0),
  subject_template text not null,
  body_text_template text not null,
  body_html_template text not null,
  only_without_engagement boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, step_number)
);

create table if not exists public.commercial_enrollments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  structure_key text not null,
  primary_email text not null,
  active_email text not null,
  alternative_email_used boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'stopped', 'completed')),
  current_step integer not null default 0,
  next_step_at timestamptz,
  stop_reason text,
  stopped_at timestamptz,
  replied_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  hard_bounced_at timestamptz,
  unsubscribed_at timestamptz,
  complained_at timestamptz,
  last_reply_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, contact_id),
  unique(campaign_id, structure_key)
);

create table if not exists public.commercial_messages (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.commercial_enrollments(id) on delete cascade,
  step_number integer not null,
  attempt_number integer not null default 1 check (attempt_number between 1 and 5),
  recipient_email text not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  acumbamail_campaign_id text,
  acumbamail_message_id text,
  provider_response jsonb,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id, step_number, attempt_number)
);

create table if not exists public.commercial_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  structure_key text not null,
  email text,
  reason text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique(user_id, structure_key)
);

-- Keep the migration safe if a previous attempt created the tables before all
-- columns and constraints below were introduced.
alter table public.commercial_enrollments
  add column if not exists last_reply_checked_at timestamptz;
alter table public.commercial_messages
  add column if not exists provider_response jsonb;
create unique index if not exists commercial_enrollments_campaign_structure_unique
  on public.commercial_enrollments(campaign_id, structure_key);

create index if not exists commercial_messages_due_idx
  on public.commercial_messages(status, scheduled_at);
create index if not exists commercial_enrollments_active_idx
  on public.commercial_enrollments(campaign_id, status, next_step_at);

alter table public.commercial_import_batches enable row level security;
alter table public.commercial_campaigns enable row level security;
alter table public.commercial_campaign_steps enable row level security;
alter table public.commercial_enrollments enable row level security;
alter table public.commercial_messages enable row level security;
alter table public.commercial_suppressions enable row level security;

create policy "commercial_import_batches_owner" on public.commercial_import_batches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "commercial_campaigns_owner" on public.commercial_campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "commercial_campaign_steps_owner" on public.commercial_campaign_steps
  for all using (exists (select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "commercial_enrollments_owner" on public.commercial_enrollments
  for all using (exists (select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()));
create policy "commercial_messages_owner" on public.commercial_messages
  for all using (exists (
    select 1 from public.commercial_enrollments e join public.commercial_campaigns c on c.id = e.campaign_id
    where e.id = enrollment_id and c.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.commercial_enrollments e join public.commercial_campaigns c on c.id = e.campaign_id
    where e.id = enrollment_id and c.user_id = auth.uid()
  ));
create policy "commercial_suppressions_owner" on public.commercial_suppressions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists set_commercial_import_batches_updated_at on public.commercial_import_batches;
create trigger set_commercial_import_batches_updated_at before update on public.commercial_import_batches
  for each row execute function public.set_updated_at();
drop trigger if exists set_commercial_campaigns_updated_at on public.commercial_campaigns;
create trigger set_commercial_campaigns_updated_at before update on public.commercial_campaigns
  for each row execute function public.set_updated_at();
drop trigger if exists set_commercial_campaign_steps_updated_at on public.commercial_campaign_steps;
create trigger set_commercial_campaign_steps_updated_at before update on public.commercial_campaign_steps
  for each row execute function public.set_updated_at();
drop trigger if exists set_commercial_enrollments_updated_at on public.commercial_enrollments;
create trigger set_commercial_enrollments_updated_at before update on public.commercial_enrollments
  for each row execute function public.set_updated_at();
drop trigger if exists set_commercial_messages_updated_at on public.commercial_messages;
create trigger set_commercial_messages_updated_at before update on public.commercial_messages
  for each row execute function public.set_updated_at();

-- Concurrency-safe reservation. Legal approval and active status are checked
-- in the same transaction as the daily cap.
create or replace function public.claim_commercial_messages(
  p_campaign_id uuid,
  p_limit integer default 20,
  p_dry_run boolean default true
) returns setof public.commercial_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.commercial_campaigns%rowtype;
  v_remaining integer;
begin
  select * into v_campaign from public.commercial_campaigns where id = p_campaign_id for update;
  if not found then return; end if;
  if not p_dry_run and (v_campaign.status <> 'active' or v_campaign.approval_status <> 'approved') then
    raise exception 'campaign_not_active_or_approved';
  end if;
  select greatest(0, v_campaign.daily_cap - count(*)) into v_remaining
  from public.commercial_messages m
  join public.commercial_enrollments e on e.id = m.enrollment_id
  where e.campaign_id = p_campaign_id
    and (m.status = 'sending' or (m.status = 'sent' and m.sent_at >= date_trunc('day', now())));
  return query
    with due as (
      select m.id from public.commercial_messages m
      join public.commercial_enrollments e on e.id = m.enrollment_id
      left join public.commercial_suppressions s on s.user_id = v_campaign.user_id and s.structure_key = e.structure_key
      where e.campaign_id = p_campaign_id and e.status in ('pending', 'active')
        and m.status = 'scheduled' and m.scheduled_at <= now() and s.id is null
      order by m.scheduled_at, m.id
      for update of m skip locked
      limit least(greatest(p_limit, 1), v_remaining)
    ), claimed as (
      update public.commercial_messages m set status = case when p_dry_run then m.status else 'sending' end
      from due where m.id = due.id returning m.*
    ) select * from claimed;
end;
$$;

revoke all on function public.claim_commercial_messages(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_commercial_messages(uuid, integer, boolean) to service_role;
