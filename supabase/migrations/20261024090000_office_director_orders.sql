-- Ordini al Direttore: quello che il titolare scrive, fotografa o detta
-- (dal CRM o da Telegram). L'ordine si salva prima di qualunque lavoro;
-- il Direttore lo capisce, prepara le proposte e accoda il lavoro agli agenti.
-- Nessuna scrittura sul CRM prima del clic del titolare, salvo le attivita' To Do.

create table if not exists public.office_director_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'web' check (source in ('web','telegram')),
  text text not null default '' check (char_length(text) <= 4000),
  -- Percorsi nel bucket privato office-director: mai un URL pubblico.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'received'
    check (status in ('received','working','done','waiting_you','failed')),
  intent text check (intent in ('new_contact','build_map','check_map','presentation','status','task','unknown')),
  interpretation jsonb,
  reply text,
  output_ids uuid[] not null default '{}',
  queued jsonb not null default '[]'::jsonb check (jsonb_typeof(queued) = 'array'),
  telegram_chat_id text,
  run_id uuid references public.office_agent_runs(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_director_orders_recent on public.office_director_orders(user_id, created_at desc);

create trigger office_director_orders_updated before update on public.office_director_orders
  for each row execute function public.set_updated_at();

alter table public.office_director_orders enable row level security;
create policy office_owner on public.office_director_orders for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.office_director_orders from anon, authenticated;
grant select on public.office_director_orders to authenticated;
grant all on public.office_director_orders to service_role;

-- Accoda un lavoro a un agente dell'elenco chiuso. Una voce con la stessa
-- chiave non si ripete; l'agente resta acceso o spento com'e'.
create or replace function public.office_director_queue(p_user_id uuid, p_agent_id text, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.office_agents; k text;
begin
  if p_agent_id is null or p_agent_id not in ('mymaps_builder','maps_quality','presentations','agency') then
    raise exception 'Destinatario non ammesso';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or length(p_entry::text) > 4000 then
    raise exception 'Voce di coda non valida';
  end if;
  k := nullif(trim(p_entry->>'key'), '');
  if k is null then raise exception 'Voce di coda senza chiave'; end if;
  if p_agent_id in ('mymaps_builder','maps_quality')
    and lower(coalesce(p_entry->>'slug','') || ' ' || coalesce(p_entry->>'city','')) ~ '(napoli|naples)' then
    raise exception 'Napoli non modificabile';
  end if;
  select * into a from public.office_agents where id = p_agent_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('queued', false, 'reason', 'agent_missing'); end if;
  if jsonb_typeof(coalesce(a.settings->'queue', '[]'::jsonb)) <> 'array' then
    raise exception 'La coda del destinatario non e una lista';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(a.settings->'queue', '[]'::jsonb)) q where q->>'key' = k) then
    return jsonb_build_object('queued', false, 'reason', 'already_queued', 'enabled', a.enabled);
  end if;
  update public.office_agents
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{queue}',
      coalesce(settings->'queue', '[]'::jsonb) || jsonb_build_array(p_entry || jsonb_build_object('queued_at', now(), 'origin', 'director_order')))
    where id = a.id and user_id = p_user_id;
  return jsonb_build_object('queued', true, 'enabled', a.enabled);
end $$;

-- Il clic su "Inserisci il contatto": una sola richiesta alla volta lavora la
-- proposta. Il contatto nasce con legacy_id office-director:<id>, unico per
-- workspace, quindi anche un secondo tentativo dopo un guasto non lo duplica.
create or replace function public.office_director_contact_claim(p_output_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.office_agent_outputs;
begin
  select * into o from public.office_agent_outputs where id = p_output_id and user_id = p_user_id for update;
  if not found or o.agent_id <> 'director' or o.kind <> 'proposal' or o.body->>'action' is distinct from 'create_contact' then
    return jsonb_build_object('state', 'not_found');
  end if;
  if o.status <> 'pending' then
    return jsonb_build_object('state', 'already_decided', 'contact_id', o.body->>'contact_id');
  end if;
  if nullif(o.body->>'claimed_at', '') is not null
    and (o.body->>'claimed_at')::timestamptz > now() - interval '5 minutes' then
    return jsonb_build_object('state', 'busy');
  end if;
  update public.office_agent_outputs set body = body || jsonb_build_object('claimed_at', now()) where id = o.id;
  return jsonb_build_object('state', 'go', 'body', o.body);
end $$;

create or replace function public.office_director_contact_done(p_output_id uuid, p_user_id uuid, p_contact_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.office_agent_outputs;
begin
  select * into o from public.office_agent_outputs where id = p_output_id and user_id = p_user_id for update;
  if not found or o.agent_id <> 'director' or o.kind <> 'proposal' or o.body->>'action' is distinct from 'create_contact' then
    raise exception 'Proposta del Direttore non valida';
  end if;
  if o.status <> 'pending' then return jsonb_build_object('output', null, 'reason', 'already_decided'); end if;
  if not exists (select 1 from public.contacts where id = p_contact_id and user_id = p_user_id) then
    raise exception 'Contatto non del workspace';
  end if;
  update public.office_agent_outputs
    set status = 'approved', decided_at = now(),
      body = (body - 'claimed_at') || jsonb_build_object('contact_id', p_contact_id, 'result', coalesce(p_result, '{}'::jsonb))
    where id = o.id returning * into o;
  return jsonb_build_object('output', to_jsonb(o));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public.office_director_queue(uuid,text,jsonb)',
    'public.office_director_contact_claim(uuid,uuid)',
    'public.office_director_contact_done(uuid,uuid,uuid,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
