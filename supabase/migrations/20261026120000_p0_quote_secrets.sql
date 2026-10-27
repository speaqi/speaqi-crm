-- P0: il token di accettazione esce da `quotes`.
--
-- La riga del preventivo è leggibile dai collaboratori assegnati al contatto.
-- Se il token di firma resta su quella riga, chiunque possa leggere il
-- preventivo può firmare al posto del cliente. Il token vive quindi in una
-- tabella separata, leggibile solo dal proprietario del workspace (e dal
-- service role usato dalle RPC pubbliche).

create table if not exists public.quote_secrets (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  acceptance_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quote_secrets_token_idx
  on public.quote_secrets(acceptance_token);

alter table public.quote_secrets enable row level security;

drop policy if exists "quote_secrets_owner" on public.quote_secrets;
create policy "quote_secrets_owner"
on public.quote_secrets
for all to authenticated
using (
  exists (
    select 1 from public.quotes q
    where q.id = quote_secrets.quote_id
      and q.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.quotes q
    where q.id = quote_secrets.quote_id
      and q.user_id = auth.uid()
  )
);

revoke all on public.quote_secrets from anon;
grant select, insert, update, delete on public.quote_secrets to authenticated;

-- Backfill dei token già emessi. La colonna vecchia resta per il tempo del
-- deploy e viene azzerata nella migration successiva.
insert into public.quote_secrets (quote_id, acceptance_token)
select q.id, q.quote_acceptance_token
from public.quotes q
where q.quote_acceptance_token is not null
  and btrim(q.quote_acceptance_token) <> ''
on conflict (quote_id) do update
set acceptance_token = excluded.acceptance_token,
    updated_at = now();

drop trigger if exists set_quote_secrets_updated_at on public.quote_secrets;
create trigger set_quote_secrets_updated_at
before update on public.quote_secrets
for each row execute function public.set_updated_at();

-- ── Accettazione pubblica ─────────────────────────────────────────────────
-- Stessa funzione della migration 20260522100000, ma il token si cerca in
-- quote_secrets invece che sulla riga del preventivo.

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
  left join public.quote_secrets s on s.quote_id = q.id
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and (
      s.acceptance_token = btrim(coalesce(p_acceptance_token, ''))
      or q.quote_acceptance_token = btrim(coalesce(p_acceptance_token, ''))
    )
    and q.status <> 'cancelled'
  limit 1
  for update of q;

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

-- ── Firma disegnata ───────────────────────────────────────────────────────
-- Stessa funzione della migration 20260923101000, con il token letto da
-- quote_secrets.

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
  left join public.quote_secrets s on s.quote_id = q.id
  where q.public_token = btrim(coalesce(p_public_token, ''))
    and (
      s.acceptance_token = btrim(coalesce(p_acceptance_token, ''))
      or q.quote_acceptance_token = btrim(coalesce(p_acceptance_token, ''))
    )
    and q.status <> 'cancelled'
  limit 1
  for update of q;

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
