-- Agenda persistente degli ordini: un solo ordine per turno, anche fra worker concorrenti.
create table public.office_recurring_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 4000),
  every_days integer not null check (every_days in (1, 2, 7)),
  local_time time without time zone not null,
  next_local_date date not null,
  next_due_at timestamptz not null,
  enabled boolean not null default true,
  revision integer not null default 1,
  last_order_id uuid references public.office_director_orders(id),
  last_scheduled_at timestamptz,
  last_skipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id)
);
create index office_recurring_due on public.office_recurring_orders(user_id,next_due_at) where enabled;
alter table public.office_recurring_orders enable row level security;
create policy office_recurring_owner_read on public.office_recurring_orders for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.office_recurring_orders from anon, authenticated;
grant select on public.office_recurring_orders to authenticated;
grant all on public.office_recurring_orders to service_role;

create table public.office_recurring_runs (
  schedule_id uuid not null,
  user_id uuid not null,
  scheduled_for date not null,
  order_id uuid not null references public.office_director_orders(id),
  created_at timestamptz not null default now(),
  primary key (schedule_id,scheduled_for),
  foreign key(schedule_id,user_id) references public.office_recurring_orders(id,user_id) on delete cascade
);
alter table public.office_recurring_runs enable row level security;
create policy office_recurring_runs_owner_read on public.office_recurring_runs for select to authenticated using ((select auth.uid()) = user_id);
create index office_recurring_runs_order on public.office_recurring_runs(user_id,order_id);
revoke all on public.office_recurring_runs from anon, authenticated;
grant select on public.office_recurring_runs to authenticated;
grant all on public.office_recurring_runs to service_role;

-- Solo il server autorizzato può scrivere; il fuso viene calcolato in Postgres.
create function public.office_recurring_create(p_user_id uuid,p_title text,p_instruction text,p_every_days integer,p_local_time time,p_first_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.office_recurring_orders;
begin
  if p_user_id is null or p_first_day is null or p_local_time is null or p_every_days not in (1,2,7)
    or char_length(btrim(coalesce(p_title,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_instruction,''))) not between 1 and 4000 then raise exception 'Incarico non valido'; end if;
  insert into public.office_recurring_orders(user_id,title,instruction,every_days,local_time,next_local_date,next_due_at)
    values(p_user_id,btrim(p_title),btrim(p_instruction),p_every_days,p_local_time,p_first_day,
      (p_first_day+p_local_time) at time zone 'Europe/Rome') returning * into s;
  return to_jsonb(s);
end $$;
revoke all on function public.office_recurring_create(uuid,text,text,integer,time,date) from public, anon, authenticated;
grant execute on function public.office_recurring_create(uuid,text,text,integer,time,date) to service_role;

create function public.office_recurring_update(p_user_id uuid,p_id uuid,p_revision integer,p_title text,p_instruction text,
  p_every_days integer,p_local_time time,p_next_day date,p_enabled boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.office_recurring_orders;
begin
  if p_user_id is null or p_id is null or p_revision is null or p_every_days not in (1,2,7) or p_local_time is null or p_next_day is null or p_enabled is null
    or char_length(btrim(coalesce(p_title,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_instruction,''))) not between 1 and 4000 then raise exception 'Incarico non valido'; end if;
  update public.office_recurring_orders set title=btrim(p_title),instruction=btrim(p_instruction),every_days=p_every_days,
    local_time=p_local_time,next_local_date=p_next_day,next_due_at=(p_next_day+p_local_time) at time zone 'Europe/Rome',
    enabled=p_enabled,updated_at=now(),revision=revision+1
    where id=p_id and user_id=p_user_id and revision=p_revision
      and (not p_enabled or last_scheduled_at is null or p_next_day > (last_scheduled_at at time zone 'Europe/Rome')::date) returning * into s;
  return case when s.id is null then null else to_jsonb(s) end;
end $$;
revoke all on function public.office_recurring_update(uuid,uuid,integer,text,text,integer,time,date,boolean) from public, anon, authenticated;
grant execute on function public.office_recurring_update(uuid,uuid,integer,text,text,integer,time,date,boolean) to service_role;

-- Adotta un solo turno arretrato, il più recente: non scatena la coda di tutti i giorni persi.
-- Inserimento dell'ordine, del lavoro e avanzamento dell'agenda sono un'unica transazione.
create function public.office_recurring_materialize(p_user_id uuid, p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.office_recurring_orders; local_now timestamp; selected_day date; next_day date;
  steps integer; oid uuid; n integer := 0; skipped integer := 0;
begin
  if p_user_id is null or p_limit is null or p_limit < 1 or p_limit > 10 then raise exception 'Parametri agenda non validi'; end if;
  if not exists (select 1 from public.office_agents where id='director' and user_id=p_user_id and enabled) then
    return jsonb_build_object('created',0,'reason','director_disabled');
  end if;
  local_now := now() at time zone 'Europe/Rome';
  for s in select * from public.office_recurring_orders where user_id=p_user_id and enabled and next_due_at<=now()
    order by next_due_at,id limit p_limit for update skip locked loop
    steps := greatest(0, (local_now::date - s.next_local_date) / s.every_days);
    selected_day := s.next_local_date + (steps * s.every_days);
    if selected_day + s.local_time > local_now then selected_day := selected_day - s.every_days; end if;
    if selected_day < s.next_local_date then continue; end if;
    next_day := selected_day + s.every_days;
    -- Un incarico ancora aperto non deve generare copie ogni giorno.
    if s.last_order_id is not null and exists(select 1 from public.office_director_orders o where o.id=s.last_order_id
      and o.user_id=p_user_id and o.status in ('received','working','waiting','blocked','waiting_you')) then
      update public.office_recurring_orders set next_local_date=next_day,
        next_due_at=(next_day+local_time) at time zone 'Europe/Rome',last_skipped_at=now(),updated_at=now(),revision=revision+1 where id=s.id;
      skipped:=skipped+1; continue;
    end if;
    insert into public.office_director_orders(user_id,source,text,status) values(p_user_id,'web',s.instruction,'working') returning id into oid;
    insert into public.office_recurring_runs(schedule_id,user_id,scheduled_for,order_id) values(s.id,p_user_id,selected_day,oid);
    perform public.office_work_enqueue(p_user_id,jsonb_build_object('order_id',oid,'agent_id','director','action','interpret_order',
      'origin','schedule','source_key','recurring:'||s.id::text||':'||selected_day::text,
      'payload',jsonb_build_object('order_id',oid),'priority',80));
    update public.office_recurring_orders set next_local_date=next_day,
      next_due_at=(next_day+local_time) at time zone 'Europe/Rome',last_order_id=oid,
      last_scheduled_at=(selected_day+local_time) at time zone 'Europe/Rome',last_skipped_at=null,updated_at=now(),revision=revision+1 where id=s.id;
    n:=n+1;
  end loop;
  return jsonb_build_object('created',n,'previous_open',skipped);
end $$;
revoke all on function public.office_recurring_materialize(uuid,integer) from public, anon, authenticated;
grant execute on function public.office_recurring_materialize(uuid,integer) to service_role;

-- La cadenza del riepilogo è indipendente da quella degli incarichi.
create table public.office_report_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  every_days integer not null check (every_days in (1,2,7)),
  local_time time without time zone not null,
  next_local_date date not null,
  next_due_at timestamptz not null,
  enabled boolean not null default true,
  last_report_at timestamptz,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.office_report_config enable row level security;
create policy office_report_config_owner_read on public.office_report_config for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.office_report_config from anon,authenticated;
grant select on public.office_report_config to authenticated;
grant all on public.office_report_config to service_role;
create unique index office_periodic_report_key on public.office_agent_outputs(user_id,output_key)
  where agent_id='director' and output_key like 'office:periodic-report:%';
create index office_work_report_updated on public.office_work_items(user_id,updated_at desc);
create index office_ledger_report_created on public.office_budget_ledger(user_id,created_at desc);

create function public.office_report_configure(p_user_id uuid,p_every_days integer,p_local_time time,p_next_day date,p_enabled boolean,p_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.office_report_config;
begin
  if p_user_id is null or p_every_days not in (1,2,7) or p_local_time is null or p_next_day is null or p_enabled is null then raise exception 'Impostazioni report non valide'; end if;
  if p_revision is null then
    insert into public.office_report_config(user_id,every_days,local_time,next_local_date,next_due_at,enabled)
      values(p_user_id,p_every_days,p_local_time,p_next_day,(p_next_day+p_local_time) at time zone 'Europe/Rome',p_enabled)
      on conflict(user_id) do nothing returning * into c;
  else
    update public.office_report_config set every_days=p_every_days,local_time=p_local_time,next_local_date=p_next_day,
      next_due_at=(p_next_day+p_local_time) at time zone 'Europe/Rome',enabled=p_enabled,revision=revision+1,updated_at=now()
      where user_id=p_user_id and revision=p_revision returning * into c;
  end if;
  return case when c.user_id is null then null else to_jsonb(c) end;
end $$;
revoke all on function public.office_report_configure(uuid,integer,time,date,boolean,integer) from public,anon,authenticated;
grant execute on function public.office_report_configure(uuid,integer,time,date,boolean,integer) to service_role;

-- Un solo riepilogo per data prevista; nessun modello e nessuna consegna esterna.
create function public.office_report_materialize(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.office_report_config; local_now timestamp; selected_day date; next_day date;
  period_start timestamptz; details jsonb; attention jsonb; totals jsonb; open_now jsonb; spending jsonb; output_id uuid; steps integer; report_key text;
begin
  select * into c from public.office_report_config where user_id=p_user_id and enabled and next_due_at<=now() for update skip locked;
  if not found then return jsonb_build_object('created',false); end if;
  if not exists(select 1 from public.office_agents where id='director' and user_id=p_user_id) then return jsonb_build_object('created',false,'reason','director_missing'); end if;
  local_now:=now() at time zone 'Europe/Rome';
  steps:=greatest(0,(local_now::date-c.next_local_date)/c.every_days);
  selected_day:=c.next_local_date+(steps*c.every_days);
  if selected_day+c.local_time>local_now then selected_day:=selected_day-c.every_days; end if;
  if selected_day<c.next_local_date then return jsonb_build_object('created',false); end if;
  next_day:=selected_day+c.every_days;
  -- La prima corsa dopo uno stop prolungato resta limitata e dichiara il periodo reale.
  period_start:=greatest(coalesce(c.last_report_at,now()-(c.every_days * interval '1 day')),now()-interval '30 days');
  select coalesce(jsonb_agg(to_jsonb(w) order by w.updated_at desc),'[]'::jsonb) into details from (
    select i.id,i.order_id,i.agent_id,i.action,i.status,left(coalesce(i.result_summary,i.reason,''),500) as summary,i.updated_at,
      s.title as schedule_title,left(o.text,160) as instruction,
      jsonb_strip_nulls(jsonb_build_object('deck_id',i.result->>'deck_id','invoice_id',i.result->>'invoice_id')) as result
    from public.office_work_items i
    left join public.office_director_orders o on o.id=i.order_id and o.user_id=p_user_id
    left join public.office_recurring_runs r on r.order_id=i.order_id and r.user_id=p_user_id
    left join public.office_recurring_orders s on s.id=r.schedule_id and s.user_id=p_user_id
    where i.user_id=p_user_id and i.updated_at>=period_start and i.updated_at<=now()
    order by i.updated_at desc,i.id limit 30
  ) w;
  select jsonb_build_object('aggiornati',count(*),'riusciti',count(*) filter(where status='succeeded'),
    'in_corso',count(*) filter(where status in ('ready','running','waiting')),
    'bloccati',count(*) filter(where status in ('blocked','failed')),
    'lavori_in_attesa_di_decisione',count(*) filter(where status='waiting_owner')) into totals
    from public.office_work_items where user_id=p_user_id and updated_at>=period_start and updated_at<=now();
  select jsonb_build_object('in_corso',count(*) filter(where status in ('ready','running','waiting')),
    'bloccati_o_falliti',count(*) filter(where status in ('blocked','failed')),
    'attesa_decisione',count(*) filter(where status='waiting_owner')) into open_now
    from public.office_work_items where user_id=p_user_id and status in ('ready','running','waiting','blocked','failed','waiting_owner');
  select coalesce(jsonb_agg(to_jsonb(w) order by w.updated_at desc),'[]'::jsonb) into attention from (
    select agent_id,action,status,left(coalesce(reason,result_summary,''),500) as summary,updated_at
    from public.office_work_items where user_id=p_user_id and status in ('blocked','failed','waiting_owner')
    order by updated_at desc,id limit 10
  ) w;
  select jsonb_build_object('spesi_centesimi',coalesce(sum(actual_cents),0),
    'prenotati_centesimi',coalesce(sum(reserved_cents) filter(where actual_cents is null),0)) into spending
    from public.office_budget_ledger where user_id=p_user_id and created_at>=period_start and created_at<=now();
  report_key:='office:periodic-report:'||selected_day::text;
  insert into public.office_agent_outputs(user_id,agent_id,kind,title,body,status,output_key)
    values(p_user_id,'director','report','Riepilogo ufficio — '||selected_day::text,
      jsonb_build_object('tipo','periodic_office_report','dal',period_start,'al',now(),'aggiornati_nel_periodo',totals,'situazione_attuale',open_now,'costi',spending,'lavori',details,'attenzione',attention,
        'nota','Sono mostrati al massimo 30 lavori aggiornati nel periodo. Il riepilogo è conservato nel CRM.'),'pending',report_key)
    on conflict(user_id,output_key) where agent_id='director' and output_key like 'office:periodic-report:%' do nothing returning id into output_id;
  update public.office_report_config set next_local_date=next_day,next_due_at=(next_day+local_time) at time zone 'Europe/Rome',
    last_report_at=case when output_id is not null then now() else last_report_at end,updated_at=now(),revision=revision+1 where user_id=p_user_id;
  return jsonb_build_object('created',output_id is not null,'output_id',output_id);
end $$;
revoke all on function public.office_report_materialize(uuid) from public,anon,authenticated;
grant execute on function public.office_report_materialize(uuid) to service_role;
