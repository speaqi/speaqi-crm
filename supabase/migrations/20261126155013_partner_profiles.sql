-- Profilo commerciale dei partner di Tourism Intelligence (agente Distribuzione).
--
-- Una riga per ente: cosa fa, a chi vende, dove lavora, cosa proporgli, quanto vale e il
-- passo dopo. Lo calcola il codice dai dati del catalogo (`src/lib/office/partner-profile.ts`),
-- senza leggere il sito; il sito si legge solo per gli enti segnati `find_email`/`read_site`,
-- e quello che si trova (frasi copiate dalla pagina, casella d'ufficio) resta qui, senza
-- toccare la scheda dell'ente. Solo aggiunte.

create table if not exists public.partner_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.tourism_entities(id) on delete cascade,
  activities text[] not null default '{}',
  audience text not null default 'unknown' check (audience in ('foreign','domestic','corporate','unknown')),
  places jsonb not null default '[]'::jsonb check (jsonb_typeof(places) = 'array'),
  guide_slugs text[] not null default '{}',
  national boolean not null default false,
  offers text[] not null default '{}',
  value int not null default 0 check (value between 0 and 100),
  next text not null check (next in ('write','find_email','read_site','guide_needed','destination_body','no_contact','skip')),
  why text[] not null default '{}',
  thin boolean not null default false,
  computed_at timestamptz not null default now(),
  -- Lettura del sito (solo per chi la vale).
  site_read_at timestamptz,
  site_quotes jsonb check (site_quotes is null or jsonb_typeof(site_quotes) = 'array'),
  site_email text check (site_email is null or site_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  site_error text check (site_error is null or char_length(site_error) <= 500),
  primary key (user_id, entity_id)
);
create index if not exists partner_profiles_next_idx on public.partner_profiles(user_id, next, value desc);

alter table public.partner_profiles enable row level security;
drop policy if exists partner_profiles_read on public.partner_profiles;
create policy partner_profiles_read on public.partner_profiles for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.partner_profiles from anon, authenticated;

-- I promemoria devono parlare delle stesse guide della prima email.
alter table public.distribution_outreach add column if not exists guides text[] not null default '{}';
alter table public.distribution_outreach add column if not exists national boolean not null default false;
