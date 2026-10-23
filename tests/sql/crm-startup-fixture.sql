create role authenticated;
create role anon;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table contacts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null,
 contact_scope text, hidden boolean, is_partner boolean, source text, status text,
 list_name text, event_tag text, email text, email_draft_note text,
 next_followup_at timestamptz, email_unsubscribed_at timestamptz,
 responsible text, assigned_agent text
);
alter table contacts enable row level security;
create policy workspace on contacts for select to authenticated using (
 user_id = (select auth.uid()) or (user_id = '11111111-1111-4111-8111-111111111111' and
 (select auth.uid()) = '22222222-2222-4222-8222-222222222222' and
 (lower(trim(responsible)) = 'collaboratore' or lower(trim(assigned_agent)) = 'collaboratore'))
);
grant usage on schema auth to authenticated;
grant select on contacts to authenticated;
