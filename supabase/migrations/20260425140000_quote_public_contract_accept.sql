-- Public contract acceptance: customer must confirm on preventivo page; optional signer email stored.

alter table public.quotes
  add column if not exists contract_signer_email text;

alter table public.quotes
  alter column contract_accepted_at drop not null;

alter table public.quotes
  alter column contract_accepted_at drop default;

-- New preventivi start without acceptance until the customer confirms (app sets null on insert).

create or replace function public.accept_public_quote_contract(
  p_public_token text,
  p_signer_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_quote_number text;
  v_customer_name text;
  v_title text;
  v_email text;
  v_accepted_at timestamptz;
  v_existing_signer text;
begin
  v_email := lower(btrim(coalesce(p_signer_email, '')));

  if length(v_email) < 5
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;

  select
    q.id,
    q.quote_number,
    q.customer_name,
    q.title,
    q.contract_accepted_at,
    q.contract_signer_email
  into
    v_id,
    v_quote_number,
    v_customer_name,
    v_title,
    v_accepted_at,
    v_existing_signer
  from public.quotes q
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.status <> 'cancelled'
  limit 1
  for update;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_accepted_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'quote_number', v_quote_number,
      'customer_name', v_customer_name,
      'title', coalesce(v_title, ''),
      'signer_email', v_existing_signer
    );
  end if;

  update public.quotes
  set
    contract_accepted_at = now(),
    contract_signer_email = v_email,
    contract_auto_accepted = false,
    updated_at = now()
  where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'quote_number', v_quote_number,
    'customer_name', v_customer_name,
    'title', coalesce(v_title, ''),
    'signer_email', v_email
  );
end;
$$;

grant execute on function public.accept_public_quote_contract(text, text) to anon, authenticated;

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
  customer_address text,
  items jsonb,
  currency text,
  subtotal_amount numeric,
  discount_amount numeric,
  tax_rate numeric,
  tax_amount numeric,
  total_amount numeric,
  deposit_percent numeric,
  deposit_amount numeric,
  balance_amount numeric,
  payment_method text,
  payment_state text,
  bank_transfer_instructions text,
  stripe_checkout_url text,
  contract_auto_accepted boolean,
  contract_terms text,
  contract_accepted_at timestamptz,
  contract_signer_email text,
  valid_until date,
  public_note text,
  sent_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz
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
    q.customer_name,
    q.customer_email,
    q.customer_company,
    q.customer_tax_id,
    q.customer_address,
    q.items,
    q.currency,
    q.subtotal_amount,
    q.discount_amount,
    q.tax_rate,
    q.tax_amount,
    q.total_amount,
    q.deposit_percent,
    q.deposit_amount,
    q.balance_amount,
    q.payment_method,
    q.payment_state,
    q.bank_transfer_instructions,
    q.stripe_checkout_url,
    q.contract_auto_accepted,
    q.contract_terms,
    q.contract_accepted_at,
    q.contract_signer_email,
    q.valid_until,
    q.public_note,
    q.sent_at,
    q.accepted_at,
    q.paid_at,
    q.created_at
  from public.quotes q
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.status <> 'cancelled'
  limit 1;
$$;
