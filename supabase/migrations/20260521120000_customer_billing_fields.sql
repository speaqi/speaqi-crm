alter table public.contacts
  add column if not exists billing_tax_id text,
  add column if not exists billing_pec text,
  add column if not exists billing_sdi text;

alter table public.quotes
  add column if not exists customer_pec text,
  add column if not exists customer_sdi text;

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
    coalesce(q.customer_name, c.name),
    coalesce(q.customer_email, c.email),
    coalesce(q.customer_company, c.company),
    coalesce(q.customer_tax_id, c.billing_tax_id),
    coalesce(q.customer_pec, c.billing_pec),
    coalesce(q.customer_sdi, c.billing_sdi),
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
  left join public.contacts c
    on c.id = q.contact_id
   and c.user_id = q.user_id
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and q.status <> 'cancelled'
  limit 1;
$$;

grant execute on function public.get_public_quote(text) to anon, authenticated;
