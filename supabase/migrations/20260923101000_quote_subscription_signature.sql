-- Preventivi in abbonamento annuale (Video nella mappa), firma disegnata e
-- webhook Stripe.
--
-- - billing_interval = 'year': il preventivo si paga solo con carta e Stripe
--   lo rinnova ogni anno. 'one_time' (default) lascia tutto com'era.
-- - quote_signatures: la firma disegnata, con le prove (IP, user-agent, copia
--   di termini e importi). Tabella separata perche' GET /api/quotes fa
--   select('*') e un PNG da 100 KB per riga appesantirebbe ogni lista.
-- - stripe_webhook_events: idempotenza del webhook (Stripe riconsegna).

alter table public.quotes
  add column if not exists billing_interval text not null default 'one_time',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists sales_team_member_id uuid references public.team_members(id) on delete set null,
  add column if not exists contract_signer_name text;

alter table public.quotes drop constraint if exists quotes_billing_interval_check;
alter table public.quotes
  add constraint quotes_billing_interval_check check (billing_interval in ('one_time', 'year'));

create unique index if not exists quotes_stripe_subscription_idx
  on public.quotes(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists quotes_sales_member_created_idx
  on public.quotes(sales_team_member_id, created_at desc)
  where sales_team_member_id is not null;

-- ── Firme ──────────────────────────────────────────────────────────────────

create table if not exists public.quote_signatures (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.quotes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signer_name text not null check (char_length(btrim(signer_name)) between 3 and 200),
  signer_email text,
  signature_png text not null check (
    signature_png like 'data:image/png;base64,%'
    and octet_length(signature_png) <= 280000
  ),
  ip text,
  user_agent text,
  channel text not null check (channel in ('email', 'in_person')),
  terms_snapshot jsonb not null,
  amounts_snapshot jsonb not null,
  signed_at timestamptz not null default now()
);

create index if not exists quote_signatures_user_idx on public.quote_signatures(user_id);

alter table public.quote_signatures enable row level security;

-- Lettura ereditata da quotes: la subquery gira con i permessi di chi legge,
-- quindi vale la policy quotes_workspace. Nessuna policy di scrittura: si
-- scrive solo dalla RPC sign_public_quote_contract.
drop policy if exists "quote_signatures_read" on public.quote_signatures;
create policy "quote_signatures_read"
on public.quote_signatures
for select to authenticated
using (exists (select 1 from public.quotes q where q.id = quote_signatures.quote_id));

-- Una firma e' una prova: non si riscrive.
create or replace function public.quote_signatures_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quote_signature_immutable';
end;
$$;

drop trigger if exists quote_signatures_no_update on public.quote_signatures;
create trigger quote_signatures_no_update
before update on public.quote_signatures
for each row execute function public.quote_signatures_immutable();

-- ── Webhook Stripe ────────────────────────────────────────────────────────

create table if not exists public.stripe_webhook_events (
  id text primary key,
  type text not null,
  quote_id uuid references public.quotes(id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- Nessuna policy: solo service role.
alter table public.stripe_webhook_events enable row level security;

-- ── Firma pubblica ────────────────────────────────────────────────────────

-- Stessa porta di accept_public_quote_contract: servono token pubblico E
-- token di accettazione. Eseguibile solo da service_role, perche' IP e
-- user-agent arrivano dalla rotta server: esposta ad anon, chiunque potrebbe
-- scriverli a piacere.
create or replace function public.sign_public_quote_contract(
  p_public_token text,
  p_acceptance_token text,
  p_signer_name text,
  p_signature_png text,
  p_ip text,
  p_user_agent text,
  p_terms_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_acceptance_email text;
begin
  select q.*
  into v_quote
  from public.quotes q
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.quote_acceptance_token = btrim(coalesce(p_acceptance_token, ''))
    and q.quote_acceptance_token is not null
    and btrim(q.quote_acceptance_token) <> ''
    and q.status <> 'cancelled'
  limit 1
  for update;

  if v_quote.id is null then
    if exists (
      select 1
      from public.quotes q
      where q.public_token = btrim(coalesce(p_public_token, ''))
        and q.status <> 'cancelled'
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_acceptance_token');
    end if;

    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_acceptance_email := lower(btrim(coalesce(v_quote.quote_acceptance_email, v_quote.customer_email, '')));

  if exists (select 1 from public.quote_signatures s where s.quote_id = v_quote.id) then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'quote_number', v_quote.quote_number,
      'customer_name', v_quote.customer_name,
      'title', coalesce(v_quote.title, ''),
      'signer_email', coalesce(v_quote.contract_signer_email, v_acceptance_email)
    );
  end if;

  insert into public.quote_signatures (
    quote_id,
    user_id,
    signer_name,
    signer_email,
    signature_png,
    ip,
    user_agent,
    channel,
    terms_snapshot,
    amounts_snapshot
  ) values (
    v_quote.id,
    v_quote.user_id,
    btrim(p_signer_name),
    nullif(v_acceptance_email, ''),
    p_signature_png,
    nullif(btrim(coalesce(p_ip, '')), ''),
    nullif(left(btrim(coalesce(p_user_agent, '')), 500), ''),
    case when v_quote.sales_team_member_id is not null then 'in_person' else 'email' end,
    coalesce(p_terms_meta, '{}'::jsonb) || jsonb_build_object('contract_terms', v_quote.contract_terms),
    jsonb_build_object(
      'items', v_quote.items,
      'subtotal', v_quote.subtotal_amount,
      'discount', v_quote.discount_amount,
      'tax_rate', v_quote.tax_rate,
      'tax', v_quote.tax_amount,
      'total', v_quote.total_amount,
      'currency', v_quote.currency,
      'billing_interval', v_quote.billing_interval
    )
  );

  update public.quotes
  set
    contract_accepted_at = coalesce(contract_accepted_at, now()),
    contract_signer_email = coalesce(nullif(v_acceptance_email, ''), contract_signer_email),
    contract_signer_name = btrim(p_signer_name),
    contract_auto_accepted = false,
    status = case when status in ('draft', 'sent') then 'accepted' else status end,
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where id = v_quote.id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'quote_number', v_quote.quote_number,
    'customer_name', v_quote.customer_name,
    'title', coalesce(v_quote.title, ''),
    'signer_email', v_acceptance_email
  );
end;
$$;

revoke all on function public.sign_public_quote_contract(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.sign_public_quote_contract(text, text, text, text, text, text, jsonb)
  to service_role;

-- ── get_public_quote ──────────────────────────────────────────────────────
-- Stesse 43 colonne della versione 20260522100000 piu' i campi di
-- abbonamento e firma. Mai il PNG, mai gli id Stripe, mai il commerciale.

drop function if exists public.get_public_quote(text);

create or replace function public.get_public_quote(p_public_token text)
returns table (
  id uuid,
  quote_number text,
  public_token text,
  status text,
  title text,
  customer_name text,
  customer_email text,
  customer_company text,
  customer_tax_id text,
  customer_pec text,
  customer_sdi text,
  customer_address text,
  customer_zip text,
  customer_city text,
  items jsonb,
  currency text,
  subtotal_amount numeric,
  discount_amount numeric,
  tax_rate numeric,
  tax_amount numeric,
  total_amount numeric,
  payment_terms_mode text,
  deposit_percent numeric,
  deposit_manual_amount numeric,
  deposit_amount numeric,
  balance_amount numeric,
  payment_method text,
  payment_state text,
  payment_terms_note text,
  bank_transfer_instructions text,
  stripe_checkout_url text,
  contract_auto_accepted boolean,
  contract_terms text,
  contract_accepted_at timestamptz,
  contract_signer_email text,
  quote_acceptance_email text,
  quote_acceptance_sent_at timestamptz,
  valid_until date,
  public_note text,
  sent_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz,
  billing_interval text,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  contract_signer_name text,
  has_signature boolean,
  contract_signed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    q.id,
    q.quote_number,
    q.public_token,
    q.status,
    q.title,
    coalesce(q.customer_name, c.name),
    coalesce(q.customer_email, c.email),
    coalesce(q.customer_company, c.company),
    coalesce(q.customer_tax_id, c.billing_tax_id),
    coalesce(q.customer_pec, c.billing_pec),
    coalesce(q.customer_sdi, c.billing_sdi),
    coalesce(q.customer_address, c.billing_address),
    coalesce(q.customer_zip, c.billing_zip),
    coalesce(q.customer_city, c.billing_city),
    q.items,
    q.currency,
    q.subtotal_amount,
    q.discount_amount,
    q.tax_rate,
    q.tax_amount,
    q.total_amount,
    q.payment_terms_mode,
    q.deposit_percent,
    q.deposit_manual_amount,
    q.deposit_amount,
    q.balance_amount,
    q.payment_method,
    q.payment_state,
    q.payment_terms_note,
    q.bank_transfer_instructions,
    q.stripe_checkout_url,
    q.contract_auto_accepted,
    q.contract_terms,
    q.contract_accepted_at,
    q.contract_signer_email,
    q.quote_acceptance_email,
    q.quote_acceptance_sent_at,
    q.valid_until,
    q.public_note,
    q.sent_at,
    q.accepted_at,
    q.paid_at,
    q.created_at,
    q.billing_interval,
    q.subscription_status,
    q.current_period_end,
    q.cancel_at_period_end,
    q.contract_signer_name,
    s.id is not null,
    s.signed_at
  from public.quotes q
  left join public.contacts c
    on c.id = q.contact_id
   and c.user_id = q.user_id
  left join public.quote_signatures s
    on s.quote_id = q.id
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.status <> 'cancelled'
  limit 1;
$$;

grant execute on function public.get_public_quote(text) to anon, authenticated;
