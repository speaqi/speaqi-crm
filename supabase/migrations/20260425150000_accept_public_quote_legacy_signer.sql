-- Fix: legacy quotes had contract_accepted_at set at creation but no contract_signer_email.
-- The public page now treats "done" as signer present; this RPC backfills signer for those rows
-- and returns already=false so a confirmation email is still sent.

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

  -- Completata (già c’è un firmatario)
  if v_accepted_at is not null
     and v_existing_signer is not null
     and btrim(v_existing_signer) <> ''
  then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'quote_number', v_quote_number,
      'customer_name', v_customer_name,
      'title', coalesce(v_title, ''),
      'signer_email', btrim(v_existing_signer)
    );
  end if;

  -- Legacy: data presente (vecchio default) ma senza email firmatario → aggiorniamo e inviare email
  if v_accepted_at is not null
     and (v_existing_signer is null or btrim(v_existing_signer) = '')
  then
    update public.quotes
    set
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
  end if;

  -- Nuovo flusso: nessuna accettazione in precedenza
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
