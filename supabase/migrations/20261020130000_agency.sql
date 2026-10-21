-- Speaqi Agency: proposte commerciali per servizi su misura (siti, branding, SEO/GEO,
-- marketing, software, AI...). Non è un secondo CRM: il cliente è un contatto
-- (contacts), la trattativa resta in deals, il prezzo resta nel preventivo (quotes).
-- Qui stanno solo ciò che manca: l'opportunità Agency con brief e materiali, le
-- presentazioni generate e lo storico delle loro versioni.
--
-- Nessun importo vive in queste tabelle: la slide "investimento" di una presentazione
-- legge il preventivo collegato quando si mostra, così presentazione e preventivo non
-- possono dire due cifre diverse.
--
-- Riservato al proprietario del workspace (come Tourism Intelligence): la vista
-- pubblica passa dal service role con il token, mai da una policy aperta.
-- File e PDF stanno nel bucket privato "agency-assets", creato dall'API alla prima richiesta.

create table public.agency_service_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 400),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

-- Identità dell'agenzia (nome, firma, contatto, presentazione) e stile di partenza.
create table public.agency_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  content jsonb not null default '{}' check (jsonb_typeof(content) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.agency_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Il cliente è un contatto del CRM. Se il contatto viene cancellato la proposta resta,
  -- con il nome scritto alla creazione.
  contact_id uuid references public.contacts(id) on delete set null,
  client_name text not null check (length(btrim(client_name)) between 1 and 200),
  deal_id uuid references public.deals(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  -- Slug delle categorie: restano veri anche se una categoria viene rinominata.
  services text[] not null default '{}' check (cardinality(services) <= 20),
  stage text not null default 'brief' check (stage in ('brief','proposal','negotiation','won','lost','on_hold')),
  brief text not null default '' check (length(brief) <= 40000),
  website_url text check (website_url is null or length(website_url) <= 2000),
  -- Marchio del cliente: nome, colore e logo (id di un asset), da usare nelle slide.
  client_brand jsonb not null default '{}' check (jsonb_typeof(client_brand) = 'object'),
  assets jsonb not null default '[]' check (jsonb_typeof(assets) = 'array'),
  -- Ultima analisi dell'AI: fatti verificati, ipotesi, dati mancanti, strategia.
  analysis jsonb not null default '{}' check (jsonb_typeof(analysis) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agency_projects_owner_idx on public.agency_projects(user_id, updated_at desc);
create index agency_projects_contact_idx on public.agency_projects(contact_id) where contact_id is not null;

create table public.agency_presentations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.agency_projects(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  slides jsonb not null default '[]' check (jsonb_typeof(slides) = 'array'),
  theme jsonb not null default '{}' check (jsonb_typeof(theme) = 'object'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  -- Il preventivo mostrato nella slide "investimento". Un preventivo cancellato non
  -- cancella la presentazione: la slide torna da completare.
  quote_id uuid references public.quotes(id) on delete set null,
  instruction text not null default '' check (length(instruction) <= 4000),
  -- Cosa ha fatto l'ultima revisione dell'AI, in una o due frasi.
  last_change text not null default '' check (length(last_change) <= 1500),
  status text not null default 'draft' check (status in ('draft','generating','ready','approved','failed')),
  error text check (error is null or length(error) <= 1000),
  public_token text not null unique default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  generated_at timestamptz,
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_at is not null))
);
create index agency_presentations_project_idx on public.agency_presentations(project_id, updated_at desc);
create index agency_presentations_owner_idx on public.agency_presentations(user_id, updated_at desc);
create index agency_presentations_quote_idx on public.agency_presentations(quote_id) where quote_id is not null;

-- Una riga per ogni versione salvata: generazione, revisione con l'AI, modifica a mano,
-- ripristino. Si legge, si ripristina, non si riscrive.
create table public.agency_presentation_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid not null references public.agency_presentations(id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null,
  slides jsonb not null check (jsonb_typeof(slides) = 'array'),
  theme jsonb not null default '{}' check (jsonb_typeof(theme) = 'object'),
  reason text not null default '' check (length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (presentation_id, version)
);

create or replace function public.agency_versions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Immutable: una versione salvata non si modifica';
end $$;
create trigger agency_versions_no_update before update on public.agency_presentation_versions
for each row execute function public.agency_versions_immutable();

-- Il preventivo sa a quale opportunità Agency appartiene.
alter table public.quotes
  add column if not exists agency_project_id uuid references public.agency_projects(id) on delete set null;
create index if not exists quotes_agency_project_idx on public.quotes(agency_project_id) where agency_project_id is not null;

-- Una foreign key non guarda la RLS: senza questi controlli si potrebbe agganciare la
-- propria presentazione al progetto (o al preventivo) di un altro proprietario.
create or replace function public.agency_same_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'agency_presentations' then
    if not exists (select 1 from public.agency_projects p where p.id = new.project_id and p.user_id = new.user_id) then
      raise exception 'agency project not found for this owner';
    end if;
    if new.quote_id is not null and not exists (select 1 from public.quotes q where q.id = new.quote_id and q.user_id = new.user_id) then
      raise exception 'quote not found for this owner';
    end if;
  elsif tg_table_name = 'agency_projects' then
    if new.contact_id is not null and not exists (select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id) then
      raise exception 'contact not found for this owner';
    end if;
    if new.deal_id is not null and not exists (select 1 from public.deals d where d.id = new.deal_id and d.user_id = new.user_id) then
      raise exception 'deal not found for this owner';
    end if;
  elsif tg_table_name = 'agency_presentation_versions' then
    if not exists (select 1 from public.agency_presentations p where p.id = new.presentation_id and p.user_id = new.user_id) then
      raise exception 'presentation not found for this owner';
    end if;
  elsif tg_table_name = 'quotes' then
    if new.agency_project_id is not null and not exists (select 1 from public.agency_projects p where p.id = new.agency_project_id and p.user_id = new.user_id) then
      raise exception 'agency project not found for this owner';
    end if;
  end if;
  return new;
end $$;
create trigger agency_presentations_same_owner before insert or update of project_id, quote_id, user_id on public.agency_presentations
for each row execute function public.agency_same_owner();
create trigger agency_projects_same_owner before insert or update of contact_id, deal_id, user_id on public.agency_projects
for each row execute function public.agency_same_owner();
create trigger agency_versions_same_owner before insert on public.agency_presentation_versions
for each row execute function public.agency_same_owner();
create trigger quotes_agency_same_owner before insert or update of agency_project_id on public.quotes
for each row when (new.agency_project_id is not null) execute function public.agency_same_owner();

alter table public.agency_settings enable row level security;
create policy agency_owner on public.agency_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.agency_service_categories enable row level security;
alter table public.agency_projects enable row level security;
alter table public.agency_presentations enable row level security;
alter table public.agency_presentation_versions enable row level security;
create policy agency_owner on public.agency_service_categories for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agency_owner on public.agency_projects for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agency_owner on public.agency_presentations for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agency_owner on public.agency_presentation_versions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
