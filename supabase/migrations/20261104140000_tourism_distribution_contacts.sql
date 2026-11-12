-- Speaqi Guides — Distribution Opportunities: i referenti.
--
-- Un prospect senza una persona da chiamare non e' attivabile. Qui stanno i decisori
-- trovati (LeadOcean o a mano): nome, ruolo, profilo professionale e, se rivelata,
-- l'email di lavoro con il suo stato di verifica. Una riga per persona e azienda.
-- Nessuna email parte da qui; passando il prospect in pipeline, il CRM usa la persona
-- migliore al posto dell'indirizzo generico dell'azienda.

create table if not exists public.tourism_distribution_contacts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.tourism_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  job_title text check (job_title is null or char_length(job_title) <= 200),
  linkedin_url text check (linkedin_url is null or linkedin_url ~ '^https://[^[:space:]]+$'),
  email text check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_status text check (email_status is null or email_status in ('verified','catch_all_valid','catch_all','risky','unknown')),
  decision_maker boolean not null default false,
  source text not null default 'leadocean' check (char_length(btrim(source)) between 1 and 80),
  noted_at timestamptz not null default now(),
  unique (entity_id, linkedin_url)
);
create index if not exists tourism_distribution_contacts_entity_idx on public.tourism_distribution_contacts(user_id, entity_id);

alter table public.tourism_distribution_contacts enable row level security;
drop policy if exists tourism_distribution_contacts_owner on public.tourism_distribution_contacts;
create policy tourism_distribution_contacts_owner on public.tourism_distribution_contacts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
