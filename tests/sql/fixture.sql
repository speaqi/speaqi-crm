-- Impalcatura minima per replicare in locale il pezzo di schema Supabase su cui
-- gira il motore campagne: ruoli, auth.users, contacts e il trigger updated_at.
-- Serve ai test di integrazione, non alla produzione.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  company text,
  country text,
  status text not null default 'New',
  source text not null default 'manual',
  priority integer not null default 0,
  contact_scope text not null default 'crm',
  event_tag text,
  list_name text,
  score integer not null default 0,
  engagement_count integer not null default 0,
  email_unsubscribed_at timestamptz,
  email_unsubscribe_source text,
  marketing_eligibility text not null default 'review',
  marketing_reason text,
  marketing_legal_basis text,
  marketing_source_acquired_at timestamptz,
  normalized_website text,
  alternative_emails text[] not null default '{}',
  source_place_id text,
  source_google_id text,
  hospitality_filter_decision text,
  import_batch_id uuid,
  hidden boolean default false,
  is_partner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nota: in produzione NON esiste un unico su (user_id, email). La deduplica dei
-- contatti e responsabilita del codice di arruolamento, e i test devono poterla
-- verificare sullo stesso terreno.
create index if not exists contacts_user_email_idx on public.contacts(user_id, email);
