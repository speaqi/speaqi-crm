-- Base comune dell'ufficio. Nessun agente viene creato o acceso qui.
create table public.office_agents (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  department text not null check (department in ('direzione','mappe','ricerca','commerciale','finanza','marketing','operazioni')),
  description text not null default '',
  enabled boolean not null default false,
  schedule_job text,
  model text not null default 'gpt-5-mini',
  daily_budget_cents integer not null default 0 check (daily_budget_cents >= 0),
  weekly_budget_cents integer not null default 0 check (weekly_budget_cents >= 0),
  monthly_budget_cents integer not null default 0 check (monthly_budget_cents >= 0),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create trigger office_agents_updated before update on public.office_agents
for each row execute function public.set_updated_at();

create table public.office_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','done','partial','failed','skipped_budget','skipped_disabled')),
  summary text not null default '',
  items_created integer not null default 0 check (items_created >= 0),
  cost_cents_reserved integer not null default 0 check (cost_cents_reserved >= 0),
  cost_cents_actual integer not null default 0 check (cost_cents_actual >= 0),
  error text,
  details jsonb not null default '{}',
  foreign key (agent_id, user_id) references public.office_agents(id, user_id) on delete cascade,
  unique (agent_id, idempotency_key),
  unique (id, agent_id, user_id)
);
create index office_runs_recent on public.office_agent_runs(agent_id, started_at desc);
create unique index office_one_running on public.office_agent_runs(agent_id) where status = 'running';

create table public.office_agent_outputs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  run_id uuid references public.office_agent_runs(id) on delete set null,
  user_id uuid not null,
  output_key text not null,
  kind text not null check (kind in ('draft_email','draft_post','task','report','proposal','data_fix','map_job')),
  title text not null check (length(title) between 1 and 500),
  body jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected','done')),
  target_table text,
  target_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (agent_id, user_id) references public.office_agents(id, user_id) on delete cascade,
  unique (run_id, output_key)
);
create index office_outputs_pending on public.office_agent_outputs(user_id, created_at desc) where status = 'pending';

create table public.office_budget_ledger (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  user_id uuid not null,
  run_id uuid references public.office_agent_runs(id) on delete set null,
  day date not null default (now() at time zone 'Europe/Rome')::date,
  reserved_cents integer not null check (reserved_cents >= 0),
  actual_cents integer check (actual_cents >= 0),
  model text,
  tokens_in integer check (tokens_in >= 0),
  tokens_out integer check (tokens_out >= 0),
  tokens_cached integer check (tokens_cached >= 0 and tokens_cached <= tokens_in),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (agent_id, user_id) references public.office_agents(id, user_id) on delete cascade
);
create index office_ledger_period on public.office_budget_ledger(agent_id, day);

-- I legami fra corsa, uscita e movimento devono restare nello stesso workspace.
create function public.office_check_run_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.run_id is not null and not exists (
    select 1 from public.office_agent_runs r
    where r.id = new.run_id and r.agent_id = new.agent_id and r.user_id = new.user_id
  ) then raise exception 'Corsa di un altro agente o workspace'; end if;
  return new;
end;
$$;
create trigger office_output_owner before insert or update on public.office_agent_outputs
for each row execute function public.office_check_run_owner();
create trigger office_ledger_owner before insert or update on public.office_budget_ledger
for each row execute function public.office_check_run_owner();

-- Dal browser si legge solo il proprio registro; tutte le scritture passano
-- dalle API del titolare o dalle RPC riservate al service role.
do $$
declare t text;
begin
  foreach t in array array['office_agents','office_agent_runs','office_agent_outputs','office_budget_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy office_owner on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- Il lock dell'agente serializza sia la presa in carico sia le prenotazioni.
create function public.claim_office_agent_run(p_agent_id text, p_user_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.office_agents; r public.office_agent_runs;
begin
  select * into a from public.office_agents where id = p_agent_id and user_id = p_user_id for update;
  if not found then raise exception 'Agente non trovato'; end if;
  select * into r from public.office_agent_runs where agent_id = a.id and idempotency_key = p_key;
  if found then return jsonb_build_object('claimed', false, 'reason', 'duplicate', 'run', to_jsonb(r)); end if;
  -- Un processo morto non blocca l'agente per sempre. Le sue riserve restano:
  -- senza esito del fornitore non possiamo dichiararle spesa zero.
  update public.office_agent_runs set status = 'failed', finished_at = now(),
    summary = 'Corsa interrotta da oltre 30 minuti', error = 'Tempo massimo della corsa superato'
    where agent_id = a.id and status = 'running' and started_at <= now() - interval '30 minutes';
  select * into r from public.office_agent_runs where agent_id = a.id and status = 'running';
  if found then return jsonb_build_object('claimed', false, 'reason', 'running', 'run', to_jsonb(r)); end if;
  insert into public.office_agent_runs(agent_id, user_id, idempotency_key, status, summary, finished_at)
    values (a.id, a.user_id, p_key, case when a.enabled then 'running' else 'skipped_disabled' end,
      case when a.enabled then 'Corsa in corso' else 'Agente spento: corsa saltata' end,
      case when a.enabled then null else now() end) returning * into r;
  return jsonb_build_object('claimed', a.enabled, 'reason', case when a.enabled then 'started' else 'disabled' end, 'run', to_jsonb(r));
end;
$$;

create function public.reserve_agent_budget(p_agent_id text, p_cents integer, p_run_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.office_agents; d date := (now() at time zone 'Europe/Rome')::date;
  spent_day bigint; spent_week bigint; spent_month bigint; result uuid;
begin
  if p_cents is null or p_cents < 0 then raise exception 'Importo della riserva non valido'; end if;
  select * into a from public.office_agents where id = p_agent_id for update;
  if not found then raise exception 'Agente non trovato'; end if;
  if not a.enabled then raise exception 'Agente spento'; end if;
  if not exists (select 1 from public.office_agent_runs where id = p_run_id and agent_id = a.id
    and user_id = a.user_id and status = 'running' and started_at > now() - interval '30 minutes')
    then raise exception 'Corsa non attiva'; end if;
  select
    coalesce(sum(coalesce(actual_cents, reserved_cents)) filter (where day = d), 0),
    coalesce(sum(coalesce(actual_cents, reserved_cents)) filter (where day >= date_trunc('week', d::timestamp)::date), 0),
    coalesce(sum(coalesce(actual_cents, reserved_cents)) filter (where day >= date_trunc('month', d::timestamp)::date), 0)
    into spent_day, spent_week, spent_month
    from public.office_budget_ledger where agent_id = a.id and day <= d
      and day >= least(date_trunc('week', d::timestamp)::date, date_trunc('month', d::timestamp)::date);
  -- Zero e' un tetto zero, non significa illimitato.
  if spent_day + p_cents > a.daily_budget_cents or spent_week + p_cents > a.weekly_budget_cents
    or spent_month + p_cents > a.monthly_budget_cents then return null; end if;
  insert into public.office_budget_ledger(agent_id, user_id, run_id, day, reserved_cents)
    values (a.id, a.user_id, p_run_id, d, p_cents) returning id into result;
  update public.office_agent_runs set cost_cents_reserved = cost_cents_reserved + p_cents where id = p_run_id;
  return result;
end;
$$;

create function public.settle_agent_budget(p_ledger_id uuid, p_actual_cents integer,
  p_tokens_in integer default null, p_tokens_out integer default null, p_model text default null, p_tokens_cached integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.office_budget_ledger;
begin
  if p_actual_cents is null or p_actual_cents < 0 or p_tokens_in < 0 or p_tokens_out < 0 or p_tokens_cached < 0 or p_tokens_cached > p_tokens_in then
    raise exception 'Costo o token non validi'; end if;
  -- Stesso ordine dei lock della prenotazione: prima agente, poi movimento.
  perform 1 from public.office_agents a where a.id = (select agent_id from public.office_budget_ledger where id = p_ledger_id) for update;
  select * into l from public.office_budget_ledger where id = p_ledger_id for update;
  if not found then raise exception 'Riserva non trovata'; end if;
  if l.settled_at is not null then
    if l.actual_cents = p_actual_cents and l.tokens_in is not distinct from p_tokens_in
      and l.tokens_out is not distinct from p_tokens_out and l.tokens_cached is not distinct from p_tokens_cached and l.model is not distinct from p_model then return; end if;
    raise exception 'Riserva gia saldata con valori diversi';
  end if;
  update public.office_budget_ledger set actual_cents = p_actual_cents, tokens_in = p_tokens_in,
    tokens_out = p_tokens_out, tokens_cached = p_tokens_cached, model = p_model, settled_at = now() where id = l.id;
  update public.office_agent_runs set cost_cents_actual = cost_cents_actual + p_actual_cents where id = l.run_id;
end;
$$;

create function public.add_office_agent_output(p_run_id uuid, p_key text, p_kind text,
  p_title text, p_body jsonb, p_target_table text default null, p_target_id text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.office_agent_runs; result uuid;
begin
  perform 1 from public.office_agents a where a.id = (select agent_id from public.office_agent_runs where id = p_run_id) for update;
  select * into r from public.office_agent_runs where id = p_run_id;
  if not found or r.status <> 'running' or r.started_at <= now() - interval '30 minutes' then raise exception 'Corsa non attiva'; end if;
  insert into public.office_agent_outputs(agent_id, run_id, user_id, output_key, kind, title, body, target_table, target_id)
    values (r.agent_id, r.id, r.user_id, p_key, p_kind, p_title, p_body, p_target_table, p_target_id)
    on conflict (run_id, output_key) do nothing returning id into result;
  if result is null then
    select id into result from public.office_agent_outputs where run_id = r.id and output_key = p_key;
  else
    update public.office_agent_runs set items_created = items_created + 1 where id = r.id;
  end if;
  return result;
end;
$$;

create function public.finish_office_agent_run(p_run_id uuid, p_status text, p_summary text, p_error text, p_details jsonb)
returns public.office_agent_runs language plpgsql security definer set search_path = '' as $$
declare r public.office_agent_runs;
begin
  if p_status not in ('done','partial','failed','skipped_budget') then raise exception 'Esito non valido'; end if;
  perform 1 from public.office_agents a where a.id = (select agent_id from public.office_agent_runs where id = p_run_id) for update;
  update public.office_agent_runs set status = p_status, summary = p_summary,
    error = p_error, details = p_details, finished_at = now()
    where id = p_run_id and status = 'running' returning * into r;
  if not found then select * into r from public.office_agent_runs where id = p_run_id; end if;
  return r;
end;
$$;

-- Aggregati nel database: nessuna troncatura silenziosa a 1000 movimenti.
create function public.office_budget_summary(p_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  with periods as (select (now() at time zone 'Europe/Rome')::date d),
  totals as (
    select a.id agent_id,
      coalesce(sum(coalesce(l.actual_cents, 0)) filter (where l.day = p.d), 0) day_actual,
      coalesce(sum(case when l.actual_cents is null then l.reserved_cents else 0 end) filter (where l.day = p.d), 0) day_reserved,
      coalesce(sum(coalesce(l.actual_cents, 0)) filter (where l.day >= date_trunc('week', p.d::timestamp)::date), 0) week_actual,
      coalesce(sum(case when l.actual_cents is null then l.reserved_cents else 0 end) filter (where l.day >= date_trunc('week', p.d::timestamp)::date), 0) week_reserved,
      coalesce(sum(coalesce(l.actual_cents, 0)) filter (where l.day >= date_trunc('month', p.d::timestamp)::date), 0) month_actual,
      coalesce(sum(case when l.actual_cents is null then l.reserved_cents else 0 end) filter (where l.day >= date_trunc('month', p.d::timestamp)::date), 0) month_reserved
    from public.office_agents a cross join periods p
    left join public.office_budget_ledger l on l.agent_id = a.id and l.day <= p.d
      and l.day >= least(date_trunc('week', p.d::timestamp)::date, date_trunc('month', p.d::timestamp)::date)
    where a.user_id = p_user_id group by a.id
  ) select coalesce(jsonb_agg(to_jsonb(totals)), '[]'::jsonb) from totals;
$$;

create function public.prune_office_agent_runs() returns bigint
language plpgsql security definer set search_path = '' as $$
declare removed bigint;
begin
  delete from public.office_agent_runs where started_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Nessuna RPC privilegiata e' invocabile con un JWT browser o la chiave anon.
do $$
declare f regprocedure;
begin
  for f in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('claim_office_agent_run','reserve_agent_budget','settle_agent_budget',
      'add_office_agent_output','finish_office_agent_run','office_budget_summary','prune_office_agent_runs','office_check_run_owner') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
