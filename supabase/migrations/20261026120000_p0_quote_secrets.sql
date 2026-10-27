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
grant all on public.quote_secrets to service_role;

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

-- Compatibilità durante il deploy: anche i token emessi dal codice vecchio
-- dopo il backfill devono arrivare nella nuova tabella. Il trigger e il
-- backfill diventano visibili nello stesso commit della migration.
create or replace function public.sync_legacy_quote_acceptance_token()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if nullif(btrim(new.quote_acceptance_token), '') is not null then
    insert into public.quote_secrets (quote_id, acceptance_token)
    values (new.id, new.quote_acceptance_token)
    on conflict (quote_id) do update
      set acceptance_token = excluded.acceptance_token, updated_at = now();
  end if;
  return new;
end;
$$;
revoke all on function public.sync_legacy_quote_acceptance_token() from public, anon, authenticated;
drop trigger if exists sync_legacy_quote_acceptance_token on public.quotes;
create trigger sync_legacy_quote_acceptance_token
after insert or update of quote_acceptance_token on public.quotes
for each row execute function public.sync_legacy_quote_acceptance_token();

-- Rinnovo atomico: destinatario, nuovo secret e revoca del token legacy.
-- Invoker + controllo owner esplicito, anche prima della stretta RLS finale.
create or replace function public.rotate_quote_acceptance_token(
  p_quote_id uuid, p_acceptance_token text, p_recipient text
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or nullif(btrim(p_acceptance_token), '') is null then
    return false;
  end if;
  perform 1 from public.quotes
    where id = p_quote_id and user_id = auth.uid()
      and status <> 'cancelled' and contract_accepted_at is null
    for update;
  if not found then return false; end if;
  update public.quotes set customer_email = p_recipient,
    quote_acceptance_email = p_recipient, quote_acceptance_token = null
    where id = p_quote_id;
  insert into public.quote_secrets (quote_id, acceptance_token)
    values (p_quote_id, p_acceptance_token)
    on conflict (quote_id) do update
      set acceptance_token = excluded.acceptance_token, updated_at = now();
  return true;
end;
$$;
revoke all on function public.rotate_quote_acceptance_token(uuid, text, text) from public, anon;
grant execute on function public.rotate_quote_acceptance_token(uuid, text, text) to authenticated;

-- L'invariante si verifica sul record bloccato dall'UPDATE: protegge anche
-- una firma arrivata fra la lettura HTTP e il salvataggio, e i client diretti.
create or replace function public.guard_signed_quote_economics()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_old_items jsonb; v_new_items jsonb;
begin
  if old.contract_accepted_at is null then return new; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(item - 'id')), '[]'::jsonb)
    into v_old_items from jsonb_array_elements(old.items) item;
  select coalesce(jsonb_agg(jsonb_strip_nulls(item - 'id')), '[]'::jsonb)
    into v_new_items from jsonb_array_elements(new.items) item;
  if v_old_items is distinct from v_new_items or
    row(new.contract_accepted_at, new.contract_terms, new.subtotal_amount,
      new.discount_amount, new.tax_rate, new.tax_amount, new.total_amount,
      new.currency, new.billing_interval, new.payment_method,
      new.payment_terms_mode, new.deposit_percent, new.deposit_manual_amount,
      new.deposit_amount, new.balance_amount, new.valid_until)
    is distinct from
    row(old.contract_accepted_at, old.contract_terms, old.subtotal_amount,
      old.discount_amount, old.tax_rate, old.tax_amount, old.total_amount,
      old.currency, old.billing_interval, old.payment_method,
      old.payment_terms_mode, old.deposit_percent, old.deposit_manual_amount,
      old.deposit_amount, old.balance_amount, old.valid_until) then
    raise exception using errcode = '23514', message = 'signed_quote_immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_signed_quote_economics() from public, anon, authenticated;
drop trigger if exists guard_signed_quote_economics on public.quotes;
create trigger guard_signed_quote_economics before update on public.quotes
for each row execute function public.guard_signed_quote_economics();

-- Un tentativo persistente per preventivo; la chiave e i parametri Stripe
-- restano identici anche su retry, concorrenza e cambio dell'ora.
create table if not exists public.quote_checkout_attempts (
  quote_id uuid primary key references public.quotes(id) on delete cascade,
  attempt_id uuid not null unique default gen_random_uuid(),
  params jsonb not null,
  stripe_session_id text,
  created_at timestamptz not null default now()
);
alter table public.quote_checkout_attempts enable row level security;
revoke all on public.quote_checkout_attempts from public, anon, authenticated;
grant all on public.quote_checkout_attempts to service_role;

create or replace function public.claim_quote_checkout_attempt(
  p_quote_id uuid, p_params jsonb, p_replaces_attempt uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_attempt public.quote_checkout_attempts%rowtype;
begin
  perform 1 from public.quotes
    where id = p_quote_id and billing_interval = 'year'
      and contract_accepted_at is not null and status not in ('cancelled', 'paid')
      and coalesce(subscription_status, '') not in ('active', 'trialing', 'past_due', 'incomplete')
    for update;
  if not found then raise exception 'quote_checkout_not_available'; end if;
  insert into public.quote_checkout_attempts(quote_id, params)
    values (p_quote_id, p_params) on conflict (quote_id) do nothing;
  -- Si sostituisce solo un tentativo di cui il server ha verificato la
  -- sessione scaduta. Due richieste sul vecchio id condividono il nuovo.
  update public.quote_checkout_attempts
    set attempt_id = gen_random_uuid(), params = p_params,
      stripe_session_id = null, created_at = now()
    where quote_id = p_quote_id and attempt_id = p_replaces_attempt;
  select * into v_attempt from public.quote_checkout_attempts where quote_id = p_quote_id;
  return to_jsonb(v_attempt);
end;
$$;
revoke all on function public.claim_quote_checkout_attempt(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.claim_quote_checkout_attempt(uuid, jsonb, uuid) to service_role;
