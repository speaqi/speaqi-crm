create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  quote_number text not null,
  public_token text not null default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  status text not null default 'sent' check (status in ('draft', 'sent', 'accepted', 'paid', 'cancelled')),
  title text not null default 'Preventivo Speaqi',
  customer_name text not null,
  customer_email text,
  customer_company text,
  customer_tax_id text,
  customer_address text,
  items jsonb not null default '[]'::jsonb,
  currency text not null default 'EUR',
  subtotal_amount numeric(12,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 22 check (tax_rate >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  deposit_percent numeric(5,2) not null default 30 check (deposit_percent >= 0 and deposit_percent <= 100),
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  balance_amount numeric(12,2) not null default 0 check (balance_amount >= 0),
  payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'stripe', 'both')),
  payment_state text not null default 'pending' check (payment_state in ('pending', 'deposit_requested', 'paid', 'waived')),
  bank_transfer_instructions text,
  stripe_checkout_url text,
  stripe_checkout_session_id text,
  stripe_payment_status text,
  contract_auto_accepted boolean not null default true,
  contract_terms text,
  contract_accepted_at timestamptz not null default now(),
  valid_until date,
  public_note text,
  internal_note text,
  sent_at timestamptz,
  accepted_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, quote_number),
  unique(public_token)
);

create index if not exists quotes_user_created_idx on public.quotes(user_id, created_at desc);
create index if not exists quotes_user_status_idx on public.quotes(user_id, status);
create index if not exists quotes_contact_idx on public.quotes(contact_id);
create index if not exists quotes_public_token_idx on public.quotes(public_token);

drop trigger if exists set_quotes_updated_at on public.quotes;
create trigger set_quotes_updated_at
before update on public.quotes
for each row execute function public.set_updated_at();

alter table public.quotes enable row level security;

drop policy if exists "quotes_workspace" on public.quotes;
create policy "quotes_workspace"
on public.quotes
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = quotes.contact_id
     and c.user_id = quotes.user_id
    where tm.user_id = quotes.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        or lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = quotes.contact_id
     and c.user_id = quotes.user_id
    where tm.user_id = quotes.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        or lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

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

create or replace function public.mark_quote_checkout_created(
  p_public_token text,
  p_session_id text,
  p_checkout_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quotes
  set
    stripe_checkout_session_id = nullif(btrim(coalesce(p_session_id, '')), ''),
    stripe_checkout_url = nullif(btrim(coalesce(p_checkout_url, '')), ''),
    payment_state = case when payment_state = 'paid' then payment_state else 'deposit_requested' end,
    status = case when status = 'draft' then 'sent' else status end
  where public_token = btrim(coalesce(p_public_token, ''))
    and status <> 'cancelled';
end;
$$;

grant execute on function public.get_public_quote(text) to anon, authenticated;
grant execute on function public.mark_quote_checkout_created(text, text, text) to anon, authenticated;
