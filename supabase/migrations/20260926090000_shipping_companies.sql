-- Compagnie di navigazione passeggeri (/navigazione): crociere, expedition,
-- fluviali e traghetti, con sede, riferimenti e scali a Napoli e Civitavecchia.
--
-- Per Speaqi Maps sono clienti possibili come aziende, non come contatti di
-- una lista: vendere un pacchetto "Napoli" o "Roma" a una compagnia vuol dire
-- sapere se le sue navi ci arrivano. Per questo la scheda della compagnia vive
-- qui (dati di catalogo, scali) e il lavoro commerciale sul contatto collegato
-- (`contact_id`), che ha gia' attivita', task, preventivi e trattative.
--
-- Il catalogo lo scrive `npm run shipping:import` (scripts/data/shipping-companies.json).
-- Un rilancio aggiorna i dati di catalogo ma non tocca gli scali corretti a mano
-- dalla pagina (`ports_manual`): chi ha verificato un calendario ne sa piu' del file.
create table if not exists public.shipping_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  kind text not null default 'cruise' check (kind in ('cruise', 'expedition', 'river', 'ferry')),
  segment text check (segment in ('mass', 'premium', 'luxury', 'expedition', 'river', 'ferry')),
  parent_group text,
  hq_city text,
  hq_country text,
  hq_address text,
  website text,
  phone text,
  email text,
  -- Ufficio / GSA in Italia: {city, address, phone, email}. E' il primo numero
  -- da chiamare quando la sede e' a Miami o ad Amburgo.
  italy_office jsonb,
  -- Riferimenti pubblici utili per una proposta B2B: [{label, value, source}].
  contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  fleet_size integer check (fleet_size is null or fleet_size >= 0),
  ships text[] not null default '{}',
  -- Null = non verificato. Non e' la stessa cosa di "non ci arriva".
  calls_naples boolean,
  calls_civitavecchia boolean,
  ports_note text,
  ports_manual boolean not null default false,
  active boolean not null default true,
  sources text[] not null default '{}',
  contact_id uuid references public.contacts(id) on delete set null,
  checked_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists shipping_companies_ports_idx
  on public.shipping_companies (user_id, calls_naples, calls_civitavecchia);

alter table public.shipping_companies enable row level security;

drop policy if exists "shipping_companies_owner" on public.shipping_companies;
create policy "shipping_companies_owner" on public.shipping_companies
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.shipping_companies is
  'Compagnie di navigazione passeggeri (/navigazione): sede, riferimenti, scali a Napoli e Civitavecchia. Il lavoro commerciale sta sul contatto collegato.';

comment on column public.shipping_companies.calls_naples is
  'La compagnia fa scalo (o ha linee) a Napoli. Null = non verificato.';

comment on column public.shipping_companies.calls_civitavecchia is
  'La compagnia fa scalo (o ha linee) a Civitavecchia, il porto di Roma. Null = non verificato.';

comment on column public.shipping_companies.ports_manual is
  'Gli scali sono stati corretti a mano dalla pagina: lo script di import non li sovrascrive.';
