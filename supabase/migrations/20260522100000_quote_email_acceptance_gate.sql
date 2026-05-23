alter table public.quotes
  add column if not exists quote_acceptance_email text,
  add column if not exists quote_acceptance_token text,
  add column if not exists quote_acceptance_sent_at timestamptz;

create index if not exists quotes_acceptance_token_idx
  on public.quotes(quote_acceptance_token)
  where quote_acceptance_token is not null;

drop function if exists public.accept_public_quote_contract(text, text);

create or replace function public.accept_public_quote_contract(
  p_public_token text,
  p_acceptance_token text
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
  v_accepted_at timestamptz;
  v_existing_signer text;
  v_acceptance_email text;
begin
  select
    q.id,
    q.quote_number,
    q.customer_name,
    q.title,
    q.contract_accepted_at,
    q.contract_signer_email,
    lower(btrim(coalesce(q.quote_acceptance_email, q.customer_email, '')))
  into
    v_id,
    v_quote_number,
    v_customer_name,
    v_title,
    v_accepted_at,
    v_existing_signer,
    v_acceptance_email
  from public.quotes q
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.quote_acceptance_token = btrim(coalesce(p_acceptance_token, ''))
    and q.quote_acceptance_token is not null
    and btrim(q.quote_acceptance_token) <> ''
    and q.status <> 'cancelled'
  limit 1
  for update;

  if v_id is null then
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

  if v_accepted_at is not null then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'quote_number', v_quote_number,
      'customer_name', v_customer_name,
      'title', coalesce(v_title, ''),
      'signer_email', coalesce(v_existing_signer, v_acceptance_email)
    );
  end if;

  update public.quotes
  set
    contract_accepted_at = now(),
    contract_signer_email = v_acceptance_email,
    contract_auto_accepted = false,
    status = case when status in ('draft', 'sent') then 'accepted' else status end,
    accepted_at = now(),
    updated_at = now()
  where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'quote_number', v_quote_number,
    'customer_name', v_customer_name,
    'title', coalesce(v_title, ''),
    'signer_email', v_acceptance_email
  );
end;
$$;

grant execute on function public.accept_public_quote_contract(text, text) to anon, authenticated;

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
    q.created_at
  from public.quotes q
  left join public.contacts c
    on c.id = q.contact_id
   and c.user_id = q.user_id
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.status <> 'cancelled'
  limit 1;
$$;

grant execute on function public.get_public_quote(text) to anon, authenticated;
