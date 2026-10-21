create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'pw'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)::json->>'sub'), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
create table contacts(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), name text not null, company text, country text, email text, phone text, status text, source text, contact_scope text, marketing_eligibility text, legacy_id text, note text);
create table activities(id uuid primary key default gen_random_uuid(), user_id uuid not null, contact_id uuid references contacts(id), type text, content text);
grant select, insert, update, delete on contacts, activities to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
