-- Fatturazione elettronica (Finance): fatture emesse dal CRM e inviate allo
-- SDI tramite Aruba.
--
-- Prima un preventivo pagato o un rinnovo Stripe creavano solo il promemoria
-- «Emettere fattura elettronica» e la fattura si faceva a mano sul pannello
-- Aruba: il CRM non sapeva se e quando era stata emessa. Ora la fattura nasce
-- qui (in bozza), si controlla e si invia con un clic; lo stato SDI torna qui.
--
-- Tre regole che il database tiene da solo:
--  * il numero si assegna all'invio, non alla bozza, e una volta assegnato
--    non cambia e la fattura non si cancella (la numerazione non ha buchi);
--  * un preventivo ha al massimo una fattura «da preventivo» e un incasso
--    Stripe una sola fattura: webhook ripetuti e doppi clic non ne fanno due;
--  * tutto e' del proprietario del workspace: i collaboratori non vedono le
--    fatture, come non vedono /incassi.

create table if not exists public.invoice_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  denominazione text not null default '',
  partita_iva text not null default '',
  codice_fiscale text,
  regime_fiscale text not null default 'RF01',
  indirizzo text not null default '',
  cap text not null default '',
  comune text not null default '',
  provincia text,
  nazione text not null default 'IT',
  iban text,
  -- Natura per le righe senza IVA (es. N2.2 nel forfettario). Null = nessuna riga a 0.
  natura_esente text,
  bollo_virtuale boolean not null default false,
  -- Testo fisso in coda alla causale (es. la dicitura del regime forfettario).
  causale_extra text,
  -- Come si scrive il numero: {n} numero, {yyyy} anno, {yy} anno corto. Es. "{n}/{yyyy}".
  numero_formato text not null default '{n}',
  updated_at timestamptz not null default now()
);

alter table public.invoice_settings enable row level security;
drop policy if exists "invoice_settings_owner" on public.invoice_settings;
create policy "invoice_settings_owner" on public.invoice_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Ultimo numero usato per anno. Si parte dal numero gia' emesso su Aruba
-- quest'anno (si imposta dai Dati fiscali), cosi' la serie continua.
create table if not exists public.invoice_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  last_number integer not null default 0 check (last_number >= 0),
  primary key (user_id, year)
);

alter table public.invoice_counters enable row level security;
drop policy if exists "invoice_counters_owner" on public.invoice_counters;
create policy "invoice_counters_owner" on public.invoice_counters
  for select using (user_id = auth.uid());

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  source text not null default 'manual' check (source in ('quote', 'stripe_renewal', 'manual')),
  stripe_invoice_id text,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'delivered', 'not_delivered', 'accepted', 'refused', 'rejected', 'error')),
  year integer,
  number integer,
  numero text,
  issue_date date not null default current_date,
  customer jsonb not null default '{}'::jsonb,
  lines jsonb not null default '[]'::jsonb,
  payment_method text not null default 'MP05' check (payment_method in ('MP05', 'MP08')),
  causale text,
  imponibile numeric(12, 2) not null default 0,
  imposta numeric(12, 2) not null default 0,
  totale numeric(12, 2) not null default 0,
  warnings text[] not null default '{}',
  xml text,
  send_attempts integer not null default 0,
  aruba_env text,
  aruba_filename text,
  sdi_status text,
  sdi_detail text,
  last_error text,
  sent_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_pair check ((number is null) = (year is null))
);

create unique index if not exists invoices_number_unique on public.invoices (user_id, year, number) where number is not null;
create unique index if not exists invoices_one_per_quote on public.invoices (quote_id) where source = 'quote' and quote_id is not null;
create unique index if not exists invoices_one_per_stripe_invoice on public.invoices (stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists invoices_user_idx on public.invoices (user_id, created_at desc);
create index if not exists invoices_sync_idx on public.invoices (status, sent_at) where aruba_filename is not null;

alter table public.invoices enable row level security;
drop policy if exists "invoices_owner" on public.invoices;
create policy "invoices_owner" on public.invoices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Una fattura numerata e' un documento fiscale: il numero non cambia e la riga non si cancella.
create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.number is not null then
      raise exception 'Una fattura numerata non si cancella (numero %/%).', old.number, old.year;
    end if;
    return old;
  end if;
  if old.number is not null and (new.number is distinct from old.number or new.year is distinct from old.year) then
    raise exception 'Il numero di una fattura gia'' emessa non cambia.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before update or delete on public.invoices
  for each row execute function public.invoices_guard();

-- Prossimo numero dell'anno, atomico. Solo il service role: il numero lo
-- assegna il server al momento dell'invio, mai il browser.
create or replace function public.reserve_invoice_number(p_user_id uuid, p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  insert into public.invoice_counters as c (user_id, year, last_number)
  values (p_user_id, p_year, 1)
  on conflict (user_id, year) do update set last_number = c.last_number + 1
  returning c.last_number into next_number;
  return next_number;
end;
$$;

revoke all on function public.reserve_invoice_number(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_invoice_number(uuid, integer) to service_role;

comment on table public.invoices is
  'Fatture elettroniche emesse dal CRM e inviate allo SDI tramite Aruba. Il numero si assegna all''invio e non cambia.';
comment on table public.invoice_settings is
  'Dati fiscali di chi emette le fatture (cedente/prestatore), uno per proprietario del workspace.';
comment on table public.invoice_counters is
  'Ultimo numero di fattura usato per anno: la serie continua da quella del pannello Aruba.';
