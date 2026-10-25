-- Lavori durevoli dell'ufficio. Nessun agente acceso e nessuna coda eseguita dalla migration.
alter table public.office_director_orders add column if not exists planning_closed_at timestamptz;
alter table public.office_director_orders drop constraint if exists office_director_orders_status_check;
alter table public.office_director_orders add constraint office_director_orders_status_check
  check (status in ('received','working','waiting','blocked','done','waiting_you','failed','cancelled'));

alter table public.automation_job_runs add column if not exists outcome text
  check (outcome in ('succeeded','skipped','blocked','failed'));
alter table public.automation_job_runs add column if not exists reason text;

create table public.office_work_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.office_director_orders(id) on delete restrict,
  deal_id uuid references public.deals(id) on delete set null,
  agent_id text not null, action text not null,
  origin text not null default 'order' check (origin in ('order','approval','director_plan','schedule','manual','legacy')),
  source_key text not null check (length(source_key) between 1 and 200),
  source_output_id uuid references public.office_agent_outputs(id) on delete set null,
  payload jsonb not null default '{}' check (jsonb_typeof(payload)='object' and octet_length(payload::text)<=20000),
  payload_version integer not null default 1 check(payload_version>0), payload_hash text not null,
  status text not null default 'ready' check(status in ('waiting','ready','running','blocked','waiting_owner','succeeded','failed','cancelled')),
  priority integer not null default 50 check(priority between 0 and 100),
  available_at timestamptz not null default now(), due_at timestamptz,
  phase text not null default 'ready' check(length(phase)<=100),
  checkpoint jsonb not null default '{}' check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=200000),
  result jsonb not null default '{}' check(jsonb_typeof(result)='object' and octet_length(result::text)<=200000),
  result_summary text not null default '' check(length(result_summary)<=4000),
  reason_code text, reason text, required_action text, responsible text, next_check_at timestamptz,
  lease_token uuid, lease_until timestamptz, heartbeat_at timestamptz,
  attempt_count integer not null default 0 check(attempt_count>=0), max_attempts integer not null default 5 check(max_attempts between 1 and 20),
  last_run_id uuid references public.office_agent_runs(id) on delete set null,
  approval_output_id uuid references public.office_agent_outputs(id) on delete set null,
  last_error text, revision integer not null default 1 check(revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade,
  unique(user_id,source_key), unique(id,user_id),
  check((status='running')=(lease_token is not null and lease_until is not null))
);
create index office_work_ready on public.office_work_items(user_id,status,available_at,priority desc,created_at);
create index office_work_order on public.office_work_items(order_id,created_at) where order_id is not null;
create unique index office_work_one_running_agent on public.office_work_items(agent_id) where status='running';

create table public.office_work_dependencies (
  work_id uuid not null, depends_on_work_id uuid not null, user_id uuid not null,
  condition text not null default 'succeeded' check(condition in ('succeeded','approved_output')),
  output_id uuid references public.office_agent_outputs(id) on delete restrict,
  primary key(work_id,depends_on_work_id), check(work_id<>depends_on_work_id),
  foreign key(work_id,user_id) references public.office_work_items(id,user_id) on delete cascade,
  foreign key(depends_on_work_id,user_id) references public.office_work_items(id,user_id) on delete restrict
);
create table public.office_work_attempts (
  id uuid primary key default gen_random_uuid(), work_id uuid not null, user_id uuid not null,
  attempt integer not null check(attempt>0), payload_version integer not null,
  lease_token uuid not null unique, run_id uuid references public.office_agent_runs(id) on delete set null,
  phase text not null default 'ready', checkpoint jsonb not null default '{}',
  status text not null default 'running', error text, started_at timestamptz not null default now(), created_at timestamptz not null default now(), finished_at timestamptz,
  foreign key(work_id,user_id) references public.office_work_items(id,user_id) on delete cascade,
  unique(work_id,attempt)
);
create table public.office_work_outputs (
  work_id uuid not null, output_id uuid not null references public.office_agent_outputs(id) on delete restrict,
  user_id uuid not null, payload_version integer not null, attempt_id uuid references public.office_work_attempts(id) on delete set null,
  created_at timestamptz not null default now(), primary key(work_id,output_id),
  foreign key(work_id,user_id) references public.office_work_items(id,user_id) on delete cascade
);
create table public.office_work_revisions (
  id uuid primary key default gen_random_uuid(), work_id uuid not null,user_id uuid not null,
  payload_version integer not null,payload jsonb not null,reason text not null,created_at timestamptz not null default now(),
  foreign key(work_id,user_id) references public.office_work_items(id,user_id) on delete cascade,
  unique(work_id,payload_version)
);
create table public.office_work_events (
  id uuid primary key default gen_random_uuid(),user_id uuid not null,work_id uuid not null,
  event_key text not null,body jsonb not null,telegram_chat_id text,
  status text not null default 'pending' check(status in ('pending','sending','sent','uncertain','failed')),
  lease_token uuid,lease_until timestamptz,error text,created_at timestamptz not null default now(),sent_at timestamptz,
  foreign key(work_id,user_id) references public.office_work_items(id,user_id) on delete cascade,
  unique(user_id,event_key)
);
create index office_work_event_delivery on public.office_work_events(user_id,status,created_at);
create table public.office_work_imports (
  user_id uuid not null references auth.users(id) on delete cascade,agent_id text not null,source_key text not null,
  work_id uuid references public.office_work_items(id) on delete set null, imported_at timestamptz not null default now(),
  primary key(user_id,agent_id,source_key)
);

create function public.office_work_action_allowed(p_agent text,p_action text) returns boolean
language sql immutable set search_path='' as $$
  select (p_agent='director' and p_action in ('interpret_order','director_status','list_events','record_task','create_contact','plan'))
    or (p_agent='mymaps_builder' and p_action='import_mymaps')
    or (p_agent='maps_quality' and p_action='check_map')
    or (p_agent='languages_voice' and p_action in ('complete_languages','refresh_outdated'))
    or (p_agent='entity_enricher' and p_action='verify_tourism_entity')
    or (p_agent='presentations' and p_action='prepare_presentation')
    or (p_action='agent_run' and p_agent in ('director','mymaps_builder','maps_quality','languages_voice','entity_enricher','presentations',
      'sales_followup','finance','events_scout','news_watch','social','db_cleaner'))
$$;

create function public.office_work_check_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='office_work_items' then
    if not public.office_work_action_allowed(new.agent_id,new.action) then raise exception 'Azione o destinatario non ammessi'; end if;
    if new.order_id is not null and not exists(select 1 from public.office_director_orders where id=new.order_id and user_id=new.user_id)
      then raise exception 'Ordine di un altro workspace'; end if;
    if new.deal_id is not null and not exists(select 1 from public.deals where id=new.deal_id and user_id=new.user_id)
      then raise exception 'Opportunità di un altro workspace'; end if;
    if new.last_run_id is not null and not exists(select 1 from public.office_agent_runs where id=new.last_run_id and user_id=new.user_id and agent_id=new.agent_id)
      then raise exception 'Corsa di un altro agente o workspace'; end if;
    if new.approval_output_id is not null and not exists(select 1 from public.office_agent_outputs o where o.id=new.approval_output_id and o.user_id=new.user_id
      and (o.agent_id=new.agent_id or (o.agent_id='director' and o.kind='proposal' and new.source_output_id=o.id
        and o.body->>'recipient_agent_id'=new.agent_id and new.action=case o.body->>'action'
          when 'build_map' then 'import_mymaps' when 'publication_review' then 'check_map' when 'complete_languages' then 'complete_languages' end)))
      then raise exception 'Proposta di un altro agente o workspace'; end if;
    if new.source_output_id is not null and not exists(select 1 from public.office_agent_outputs where id=new.source_output_id and user_id=new.user_id)
      then raise exception 'Uscita sorgente di un altro workspace'; end if;
    if new.agent_id in ('mymaps_builder','maps_quality','languages_voice') and
      lower(coalesce(new.payload->>'slug','')||' '||coalesce(new.payload->>'map_slug','')||' '||coalesce(new.payload->>'city','')) ~ '(napoli|naples)'
      then raise exception 'Napoli esclusa dal lavoro degli agenti'; end if;
    new.updated_at:=now();
  elsif tg_table_name='office_work_outputs' then
    if not exists(select 1 from public.office_agent_outputs o join public.office_work_items w on w.id=new.work_id
      where o.id=new.output_id and o.user_id=new.user_id and (o.agent_id=w.agent_id or
        (o.agent_id='director' and o.kind='proposal' and w.source_output_id=o.id and w.approval_output_id=o.id
          and o.body->>'recipient_agent_id'=w.agent_id and w.action=case o.body->>'action'
            when 'build_map' then 'import_mymaps' when 'publication_review' then 'check_map' when 'complete_languages' then 'complete_languages' end)))
      then raise exception 'Uscita di un altro agente o workspace'; end if;
  elsif tg_table_name='office_work_attempts' and new.run_id is not null then
    if not exists(select 1 from public.office_agent_runs r join public.office_work_items w on w.id=new.work_id
      where r.id=new.run_id and r.user_id=new.user_id and r.agent_id=w.agent_id) then raise exception 'Corsa di un altro agente o workspace'; end if;
  end if;
  return new;
end $$;
create trigger office_work_owner before insert or update on public.office_work_items for each row execute function public.office_work_check_owner();
create trigger office_work_output_owner before insert or update on public.office_work_outputs for each row execute function public.office_work_check_owner();
create trigger office_work_attempt_owner before insert or update on public.office_work_attempts for each row execute function public.office_work_check_owner();

create function public.office_work_refresh_order(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.office_director_orders; s text; summary text;
begin
  if p_order_id is null then return; end if;
  select * into o from public.office_director_orders where id=p_order_id for update;
  if not found then return; end if;
  select case
    when bool_or(status='failed') then 'failed'
    when bool_or(status='cancelled') then 'cancelled'
    when bool_or(status='waiting_owner') then 'waiting_you'
    when bool_or(status='blocked') then 'blocked'
    when bool_or(status='running') then 'working'
    when bool_and(status='succeeded') and o.planning_closed_at is not null then 'done'
    else 'waiting' end into s from public.office_work_items where order_id=o.id and user_id=o.user_id;
  select coalesce(nullif(result_summary,''),nullif(reason,''),'Lavoro in attesa del prossimo passo.') into summary
    from public.office_work_items where order_id=o.id and user_id=o.user_id
    order by case status when 'failed' then 0 when 'cancelled' then 1 when 'waiting_owner' then 2 when 'blocked' then 3 when 'running' then 4 when 'waiting' then 5 else 6 end,
      updated_at desc limit 1;
  update public.office_director_orders set status=coalesce(s,'received'),reply=coalesce(summary,reply),updated_at=now() where id=o.id;
end $$;

create function public.office_work_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare chat text; label text; summary text;
begin
  perform public.office_work_refresh_order(new.order_id);
  if tg_op='UPDATE' and new.status=old.status and new.reason is not distinct from old.reason and new.result_summary=old.result_summary then return new; end if;
  select telegram_chat_id into chat from public.office_director_orders where id=new.order_id and user_id=new.user_id;
  label:=case new.status when 'waiting' then 'In attesa' when 'ready' then 'Pronto' when 'running' then 'In esecuzione'
    when 'blocked' then 'Bloccato' when 'waiting_owner' then 'Aspetta te' when 'succeeded' then 'Riuscito' when 'failed' then 'Fallito' else 'Annullato' end;
  summary:=coalesce(nullif(new.result_summary,''),nullif(new.reason,''),label);
  insert into public.office_work_events(user_id,work_id,event_key,body,telegram_chat_id)
    values(new.user_id,new.id,new.id::text||':'||new.revision::text||':'||new.status,
      jsonb_build_object('status',new.status,'summary',summary,'order_id',new.order_id,'notify',new.order_id is not null,
        'message',label||': '||summary||case when new.required_action is not null then E'\nProssima azione: '||new.required_action else '' end
          ||case when new.responsible is not null then E'\nResponsabile: '||new.responsible else '' end
          ||case when new.next_check_at is not null then E'\nRicontrollo: '||to_char(new.next_check_at at time zone 'Europe/Rome','DD/MM HH24:MI')||' (Roma)' else '' end),chat)
    on conflict(user_id,event_key) do nothing;
  return new;
end $$;
create trigger office_work_changed after insert or update on public.office_work_items for each row execute function public.office_work_changed();

create function public.office_work_add_dependencies(p_work_id uuid,p_user_id uuid,p_dependencies jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v jsonb; parent uuid; cond text; out_id uuid;
begin
  if p_dependencies is null then return; end if;
  if jsonb_typeof(p_dependencies)<>'array' or jsonb_array_length(p_dependencies)>32 then raise exception 'Dipendenze non valide'; end if;
  for v in select value from jsonb_array_elements(p_dependencies) loop
    if jsonb_typeof(v)='string' then parent:=(v#>>'{}')::uuid; cond:='succeeded'; out_id:=null;
    else parent:=(v->>'work_id')::uuid; cond:=coalesce(v->>'condition','succeeded');out_id:=nullif(v->>'output_id','')::uuid; end if;
    if parent=p_work_id or not exists(select 1 from public.office_work_items where id=parent and user_id=p_user_id) then raise exception 'Dipendenza estranea o ciclica'; end if;
    if exists(with recursive ancestors(id) as (
      select parent union select d.depends_on_work_id from public.office_work_dependencies d join ancestors a on d.work_id=a.id
    ) select 1 from ancestors where id=p_work_id) then raise exception 'Dipendenza ciclica'; end if;
    if out_id is not null and not exists(select 1 from public.office_agent_outputs where id=out_id and user_id=p_user_id) then raise exception 'Proposta di un altro workspace'; end if;
    insert into public.office_work_dependencies(work_id,depends_on_work_id,user_id,condition,output_id)
      values(p_work_id,parent,p_user_id,cond,out_id) on conflict do nothing;
  end loop;
end $$;

create function public.office_work_enqueue(p_user_id uuid,p_spec jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; merged jsonb; k text; requested_id uuid; changed boolean;
begin
  if p_spec is null or jsonb_typeof(p_spec)<>'object' then raise exception 'Incarico non valido'; end if;
  k:=nullif(btrim(p_spec->>'source_key'),''); if k is null then raise exception 'Chiave incarico mancante'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||k,0));
  select * into w from public.office_work_items where user_id=p_user_id and source_key=k for update;
  if found then
    if w.agent_id is distinct from p_spec->>'agent_id' or w.action is distinct from p_spec->>'action' then raise exception 'Chiave incarico con azione diversa'; end if;
    merged:=w.payload||jsonb_strip_nulls(coalesce(p_spec->'payload','{}'));
    changed:=merged<>w.payload;
    if changed then
      if w.status in ('running','waiting_owner','succeeded','cancelled') or w.reason_code='reconciliation_required' then raise exception 'Incarico non modificabile'; end if;
      insert into public.office_work_revisions(work_id,user_id,payload_version,payload,reason)
        values(w.id,w.user_id,w.payload_version,w.payload,'Dati integrati prima della ripresa');
      update public.office_work_items set payload=merged,payload_hash=md5(merged::text),payload_version=payload_version+1,
        revision=revision+1,status='ready',phase='ready',checkpoint='{}',result='{}',result_summary='',approval_output_id=null,
        reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,available_at=now(),finished_at=null
        where id=w.id returning * into w;
    end if;
    return to_jsonb(w);
  end if;
  requested_id:=coalesce(nullif(p_spec->>'id','')::uuid,gen_random_uuid());
  insert into public.office_work_items(id,user_id,order_id,deal_id,agent_id,action,origin,source_key,source_output_id,payload,payload_hash,
    status,priority,available_at,due_at,max_attempts,reason_code,reason,required_action,responsible,next_check_at,approval_output_id,result,result_summary)
    values(requested_id,p_user_id,nullif(p_spec->>'order_id','')::uuid,nullif(p_spec->>'deal_id','')::uuid,p_spec->>'agent_id',p_spec->>'action',
      coalesce(p_spec->>'origin','order'),k,nullif(p_spec->>'source_output_id','')::uuid,coalesce(p_spec->'payload','{}'),md5(coalesce(p_spec->'payload','{}')::text),
      coalesce(p_spec->>'status','ready'),coalesce((p_spec->>'priority')::integer,50),coalesce((p_spec->>'available_at')::timestamptz,now()),
      (p_spec->>'due_at')::timestamptz,coalesce((p_spec->>'max_attempts')::integer,5),p_spec->>'reason_code',p_spec->>'reason',p_spec->>'required_action',p_spec->>'responsible',
      (p_spec->>'next_check_at')::timestamptz,nullif(p_spec->>'approval_output_id','')::uuid,coalesce(p_spec->'result','{}'),coalesce(p_spec->>'result_summary','')) returning * into w;
  perform public.office_work_add_dependencies(w.id,p_user_id,p_spec->'depends_on');
  if exists(select 1 from public.office_work_dependencies where work_id=w.id) and w.status='ready' then
    update public.office_work_items set status='waiting',reason_code='dependency',reason='In attesa del completamento dei prerequisiti.',
      required_action='Completare il lavoro precedente.',responsible='Ufficio',next_check_at=now()+interval '1 minute',revision=revision+1 where id=w.id returning * into w;
  end if;
  if w.approval_output_id is not null then
    insert into public.office_work_outputs(work_id,output_id,user_id,payload_version) values(w.id,w.approval_output_id,w.user_id,w.payload_version);
  end if;
  return to_jsonb(w);
end $$;

create function public.office_work_refresh_dependencies(p_user_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; cancelled boolean; broken boolean; ready boolean; n integer:=0;
begin
  for w in select * from public.office_work_items where user_id=p_user_id and status not in ('running','succeeded','failed','cancelled','waiting_owner') order by id for update skip locked loop
    if not exists(select 1 from public.office_work_dependencies where work_id=w.id) then continue; end if;
    select bool_or(p.status='cancelled'),bool_or(p.status='failed'),bool_and(p.status='succeeded' and
      (d.condition='succeeded' or exists(select 1 from public.office_agent_outputs o where o.id=d.output_id and o.user_id=p_user_id and o.status='approved')))
      into cancelled,broken,ready from public.office_work_dependencies d join public.office_work_items p on p.id=d.depends_on_work_id where d.work_id=w.id;
    if cancelled then
      update public.office_work_items set status='cancelled',reason_code='dependency_cancelled',reason='Il prerequisito è stato rifiutato o annullato.',
        required_action='Nessuna operazione dipendente sarà eseguita.',responsible='Titolare',finished_at=now(),revision=revision+1 where id=w.id;n:=n+1;
    elsif broken and w.reason_code is distinct from 'dependency_failed' then
      update public.office_work_items set status='blocked',reason_code='dependency_failed',reason='Il lavoro precedente è fallito.',
        required_action='Verificare e riprendere il prerequisito.',responsible='Ufficio',revision=revision+1 where id=w.id;n:=n+1;
    elsif ready and ((w.status='waiting' and w.reason_code='dependency') or (w.status='blocked' and w.reason_code='dependency_failed')) then
      update public.office_work_items set status='ready',reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,available_at=now(),revision=revision+1 where id=w.id;n:=n+1;
    elsif not ready and not broken and w.status='ready' then
      update public.office_work_items set status='waiting',reason_code='dependency',reason='In attesa del completamento dei prerequisiti.',
        required_action='Completare il lavoro precedente.',responsible='Ufficio',next_check_at=now()+interval '1 minute',revision=revision+1 where id=w.id;n:=n+1;
    end if;
  end loop;
  return n;
end $$;

create function public.office_work_assert_active(p_work_id uuid,p_token uuid) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from public.office_work_items where id=p_work_id and status='running' and lease_token=p_token and lease_until>clock_timestamp())
$$;
create function public.office_work_heartbeat(p_work_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.office_work_items set heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
    where id=p_work_id and status='running' and lease_token=p_token and lease_until>clock_timestamp();
  return found;
end $$;

create function public.office_work_link_run(p_work_id uuid,p_token uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items;
begin
  select * into w from public.office_work_items where id=p_work_id for update;
  if not found or not public.office_work_assert_active(p_work_id,p_token) then raise exception 'Presa in carico scaduta'; end if;
  update public.office_work_items set last_run_id=p_run_id where id=w.id returning * into w;
  update public.office_work_attempts set run_id=p_run_id where work_id=w.id and lease_token=p_token;
  return to_jsonb(w);
end $$;

create function public.office_work_transition(p_work_id uuid,p_token uuid,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; s text; child jsonb; output_id uuid; a_id uuid;
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Avanzamento non valido'; end if;
  select * into w from public.office_work_items where id=p_work_id for update;
  if not found or not public.office_work_assert_active(p_work_id,p_token) then raise exception 'Presa in carico scaduta'; end if;
  if p_patch ? 'children' then
    if jsonb_typeof(p_patch->'children')<>'array' or jsonb_array_length(p_patch->'children')>32 then raise exception 'Piano non valido'; end if;
    for child in select value from jsonb_array_elements(p_patch->'children') loop
      perform public.office_work_enqueue(w.user_id,child||jsonb_build_object('order_id',w.order_id));
    end loop;
  end if;
  select id into a_id from public.office_work_attempts where work_id=w.id and lease_token=p_token;
  if p_patch ? 'output_ids' then
    if jsonb_typeof(p_patch->'output_ids')<>'array' then raise exception 'Uscite non valide'; end if;
    for output_id in select jsonb_array_elements_text(p_patch->'output_ids')::uuid loop
      insert into public.office_work_outputs(work_id,output_id,user_id,payload_version,attempt_id)
        values(w.id,output_id,w.user_id,w.payload_version,a_id) on conflict do nothing;
    end loop;
  end if;
  s:=coalesce(p_patch->>'status',w.status);
  if s='ready' or (w.status<>'running') then raise exception 'Transizione non ammessa'; end if;
  if s='succeeded' and coalesce(p_patch->'result',w.result)='{}'::jsonb then raise exception 'Risultato verificabile mancante'; end if;
  update public.office_work_items set status=s,phase=coalesce(p_patch->>'phase',phase),checkpoint=coalesce(p_patch->'checkpoint',checkpoint),
    result=coalesce(p_patch->'result',result),result_summary=coalesce(p_patch->>'result_summary',result_summary),
    reason_code=case when p_patch?'reason_code' then p_patch->>'reason_code' when s in ('succeeded','running') then null else reason_code end,
    reason=case when p_patch?'reason' then p_patch->>'reason' when s='succeeded' then null else reason end,
    required_action=case when p_patch?'required_action' then p_patch->>'required_action' when s='succeeded' then null else required_action end,
    responsible=case when p_patch?'responsible' then p_patch->>'responsible' when s='succeeded' then null else responsible end,
    next_check_at=case when p_patch?'next_check_at' then (p_patch->>'next_check_at')::timestamptz else next_check_at end,
    available_at=coalesce((p_patch->>'available_at')::timestamptz,available_at),last_error=coalesce(p_patch->>'last_error',p_patch->>'error',last_error),
    approval_output_id=case when p_patch?'approval_output_id' then (p_patch->>'approval_output_id')::uuid else approval_output_id end,
    lease_token=case when s='running' then lease_token else null end,lease_until=case when s='running' then lease_until else null end,
    finished_at=case when s in ('succeeded','failed','cancelled') then now() else null end,revision=revision+1 where id=w.id returning * into w;
  if w.approval_output_id is not null then
    insert into public.office_work_outputs(work_id,output_id,user_id,payload_version,attempt_id)
      values(w.id,w.approval_output_id,w.user_id,w.payload_version,a_id) on conflict do nothing;
  end if;
  update public.office_work_attempts set phase=w.phase,checkpoint=w.checkpoint,status=w.status,
    error=w.last_error,finished_at=case when w.status='running' then null else now() end where id=a_id;
  if coalesce((p_patch->>'close_plan')::boolean,false) then
    if w.action<>'interpret_order' then raise exception 'Solo il Direttore può chiudere il piano'; end if;
    update public.office_director_orders set planning_closed_at=now() where id=w.order_id and user_id=w.user_id;
  end if;
  perform public.office_work_refresh_dependencies(w.user_id);
  perform public.office_work_refresh_order(w.order_id);
  return to_jsonb(w);
end $$;

create function public.office_work_recover(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; uncertain boolean; n integer:=0; b integer:=0;
begin
  for w in select * from public.office_work_items where user_id=p_user_id and status='running' and lease_until<=clock_timestamp() for update skip locked loop
    uncertain:=w.phase='effect_started' or exists(select 1 from public.office_budget_ledger where run_id=w.last_run_id and actual_cents is null)
      or (w.checkpoint='{}'::jsonb and exists(select 1 from public.office_budget_ledger where run_id=w.last_run_id and coalesce(actual_cents,reserved_cents)>0));
    if w.last_run_id is not null then
      update public.office_agent_runs set status='failed',finished_at=now(),error='Presa in carico scaduta; verifica del lavoro richiesta.',summary='Corsa interrotta; stato conservato nel lavoro.'
        where id=w.last_run_id and status='running';
    end if;
    update public.office_work_attempts set status=case when uncertain then 'blocked' else 'waiting' end,
      error='Presa in carico scaduta',finished_at=now() where work_id=w.id and lease_token=w.lease_token;
    update public.office_work_items set status=case when uncertain then 'blocked' when attempt_count>=max_attempts then 'failed' else 'waiting' end,
      reason_code=case when uncertain then 'reconciliation_required' when attempt_count>=max_attempts then 'attempts_exhausted' else 'worker_restarted' end,
      reason=case when uncertain then 'Operazione o spesa dall’esito incerto: nessun nuovo tentativo automatico.' else 'Esecuzione interrotta; ripresa dal checkpoint al prossimo turno.' end,
      required_action=case when uncertain then 'Verificare ricevuta e consumi prima di autorizzare una ripresa.' else 'Attendere la ripresa del worker.' end,
      responsible=case when uncertain then 'Titolare' else agent_id end,next_check_at=case when uncertain then null else now() end,
      available_at=now(),lease_token=null,lease_until=null,revision=revision+1 where id=w.id;
    n:=n+1;if uncertain then b:=b+1;end if;
  end loop;
  update public.office_work_items set status='waiting',reason_code='budget_retry',available_at=now(),revision=revision+1
    where user_id=p_user_id and status='blocked' and reason_code='budget_exhausted' and next_check_at<=now();
  update public.office_work_events set status='uncertain',error='Consegna interrotta: verificare prima di riprovare.',lease_token=null,lease_until=null
    where user_id=p_user_id and status='sending' and lease_until<=clock_timestamp();
  perform public.office_work_refresh_dependencies(p_user_id);
  return jsonb_build_object('recovered',n,'blocked',b);
end $$;

create function public.office_work_claim(p_user_id uuid,p_limit integer default 4) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; token uuid; answer jsonb:='[]'; a public.office_agents; claimed integer:=0;
begin
  if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'Limite non valido'; end if;
  perform public.office_work_recover(p_user_id);
  for w in select * from public.office_work_items where user_id=p_user_id and status in ('ready','waiting')
    and available_at<=now() and (next_check_at is null or next_check_at<=now()) order by priority desc,created_at,id for update skip locked loop
    exit when claimed>=p_limit;
    if exists(select 1 from public.office_work_dependencies d join public.office_work_items p on p.id=d.depends_on_work_id
      where d.work_id=w.id and (p.status<>'succeeded' or (d.condition='approved_output' and not exists(select 1 from public.office_agent_outputs where id=d.output_id and status='approved')))) then continue; end if;
    select * into a from public.office_agents where id=w.agent_id and user_id=p_user_id for update skip locked;
    if not found then continue; end if;
    if not a.enabled then
      update public.office_work_items set status='waiting',reason_code='agent_disabled',reason='Agente spento: il lavoro resta conservato.',required_action='Accendere l’agente quando autorizzato.',
        responsible='Titolare',next_check_at=now()+interval '1 minute',revision=revision+case when reason_code='agent_disabled' then 0 else 1 end where id=w.id;continue;
    end if;
    if exists(select 1 from public.office_work_items where agent_id=w.agent_id and status='running') or
      exists(select 1 from public.office_agent_runs where agent_id=w.agent_id and status='running' and started_at>now()-interval '30 minutes') then
      update public.office_work_items set status='waiting',reason_code='agent_busy',reason='Agente occupato: il lavoro attende il suo turno.',required_action='Attendere il completamento della corsa in corso.',
        responsible=w.agent_id,next_check_at=now()+interval '30 seconds',revision=revision+case when reason_code='agent_busy' then 0 else 1 end where id=w.id;continue;
    end if;
    if w.attempt_count>=w.max_attempts then
      update public.office_work_items set status='failed',reason_code='attempts_exhausted',reason='Tentativi sicuri esauriti.',required_action='Verificare la causa prima di riprendere.',responsible='Titolare',revision=revision+1,finished_at=now() where id=w.id;continue;
    end if;
    token:=gen_random_uuid();
    update public.office_work_items set status='running',lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',heartbeat_at=clock_timestamp(),
      attempt_count=attempt_count+1,reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,revision=revision+1 where id=w.id returning * into w;
    insert into public.office_work_attempts(work_id,user_id,attempt,payload_version,lease_token,phase,checkpoint)
      values(w.id,w.user_id,w.attempt_count,w.payload_version,token,w.phase,w.checkpoint);
    answer:=answer||jsonb_build_array(to_jsonb(w));claimed:=claimed+1;
  end loop;
  return answer;
end $$;

create function public.office_work_seed_orders(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.office_director_orders;n integer:=0;
begin
  for o in select * from public.office_director_orders where user_id=p_user_id and status='received' and planning_closed_at is null order by created_at for update skip locked loop
    if not exists(select 1 from public.office_agents where id='director' and user_id=p_user_id) then continue;end if;
    perform public.office_work_enqueue(p_user_id,jsonb_build_object('order_id',o.id,'agent_id','director','action','interpret_order','origin','order',
      'source_key','order:'||o.id::text||':interpret','payload',jsonb_build_object('order_id',o.id),'priority',80));n:=n+1;
  end loop;
  for o in select * from public.office_director_orders where user_id=p_user_id and status='working'
    and interpretation->>'intake'='attachments' and updated_at<now()-interval '10 minutes' for update skip locked loop
    if not exists(select 1 from public.office_agents where id='director' and user_id=p_user_id) then continue;end if;
    perform public.office_work_enqueue(p_user_id,jsonb_build_object('order_id',o.id,'agent_id','director','action','interpret_order','origin','order',
      'source_key','order:'||o.id::text||':interpret','payload',jsonb_build_object('order_id',o.id),'priority',80,'status','blocked',
      'reason_code','upload_interrupted','reason','Il caricamento degli allegati è stato interrotto.',
      'required_action','Completa i dati nel lavoro salvato o verifica gli allegati; non serve un nuovo ordine.','responsible','Titolare'));
    n:=n+1;
  end loop;
  return jsonb_build_object('seeded',n);
end $$;

create function public.office_work_owner_action(p_user_id uuid,p_work_id uuid,p_action text,p_patch jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items; merged jsonb; k text;
begin
  select * into w from public.office_work_items where id=p_work_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('work',null,'reason','not_found');end if;
  if p_patch?'expected_revision' and (p_patch->>'expected_revision')::integer<>w.revision then return jsonb_build_object('work',null,'reason','revision_conflict');end if;
  if w.status='running' then return jsonb_build_object('work',null,'reason','busy');end if;
  if w.reason_code='reconciliation_required' or w.phase='effect_started' then return jsonb_build_object('work',null,'reason','reconciliation_required');end if;
  if w.status in ('succeeded','cancelled') then return jsonb_build_object('work',null,'reason','already_terminal');end if;
  if w.status='waiting_owner' and p_action in ('resume','update_payload') then return jsonb_build_object('work',null,'reason','approval_required');end if;
  if w.attempt_count>=20 and p_action in ('resume','update_payload') then return jsonb_build_object('work',null,'reason','attempts_exhausted');end if;
  if p_action='cancel' then
    update public.office_work_items set status='cancelled',reason_code='owner_cancelled',reason='Annullato dal titolare.',required_action='Nessuna esecuzione ulteriore.',responsible='Titolare',
      next_check_at=null,finished_at=now(),revision=revision+1 where id=w.id returning * into w;
  elsif p_action in ('resume','update_payload') then
    if p_action='resume' and w.status='waiting_owner' then return jsonb_build_object('work',null,'reason','approval_required');end if;
    merged:=w.payload;
    if p_action='update_payload' then
      if not(p_patch?'expected_revision') or jsonb_typeof(p_patch->'payload')<>'object' then raise exception 'Revisione e dati richiesti';end if;
      for k in select jsonb_object_keys(p_patch->'payload') loop
        if k not in ('source','city','slug','website','entity_id','destination_id','target','brief','text') then raise exception 'Campo non modificabile: %',k;end if;
      end loop;
      merged:=w.payload||jsonb_strip_nulls(p_patch->'payload');
      insert into public.office_work_revisions(work_id,user_id,payload_version,payload,reason)
        values(w.id,w.user_id,w.payload_version,w.payload,'Correzione del titolare') on conflict do nothing;
    end if;
    update public.office_work_items set payload=merged,payload_hash=md5(merged::text),payload_version=payload_version+case when merged<>payload then 1 else 0 end,
      status='ready',phase=case when p_action='update_payload' then 'ready' else phase end,checkpoint=case when p_action='update_payload' then '{}'::jsonb else checkpoint end,
      result='{}',result_summary='',reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,available_at=now(),finished_at=null,
      approval_output_id=case when p_action='update_payload' then null else approval_output_id end,
      max_attempts=case when status='failed' then greatest(max_attempts,attempt_count+1) else max_attempts end,revision=revision+1
      where id=w.id returning * into w;
  else raise exception 'Azione del titolare non ammessa';end if;
  perform public.office_work_refresh_dependencies(w.user_id);
  return jsonb_build_object('work',to_jsonb(w));
end $$;

create function public.office_work_decide_output(p_user_id uuid,p_output_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items;o public.office_agent_outputs; decision jsonb;site text;src text; host text;src_host text;recorded boolean;
begin
  if p_status not in ('approved','rejected') then raise exception 'Decisione non valida';end if;
  select * into o from public.office_agent_outputs where id=p_output_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('output',null,'reason','not_found');end if;
  select i.* into w from public.office_work_items i join public.office_work_outputs x on x.work_id=i.id
    where x.output_id=o.id and i.user_id=p_user_id
    order by (i.status='waiting_owner' and i.approval_output_id=o.id and x.payload_version=i.payload_version) desc,
      i.created_at,i.id limit 1 for update of i;
  recorded:=found;
  if recorded and (w.status<>'waiting_owner' or w.approval_output_id is distinct from o.id or
    not exists(select 1 from public.office_work_outputs where work_id=w.id and output_id=o.id and payload_version=w.payload_version)) then
    return jsonb_build_object('output',null,'reason','stale_work_proposal');end if;
  if recorded and o.agent_id='director' and o.body->>'action'='create_contact' and p_status='approved' then
    return jsonb_build_object('output',null,'reason','contact_requires_pipeline');end if;
  begin
    if recorded and p_status='approved' and w.action='verify_tourism_entity' then
      site:=nullif(btrim(o.body->>'website'),'');
      if site is not null then
        src:=o.body->'evidence'->'identity'->>'source_url';
        if site !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+\.[A-Za-z]{2,}([/:][^[:space:]]*)?$' or site ~ '[@\\]' then raise exception 'Sito candidato non pubblico o non valido';end if;
        host:=lower(split_part(split_part(site,'://',2),'/',1));src_host:=lower(split_part(split_part(coalesce(src,''),'://',2),'/',1));
        if regexp_replace(host,'^www\.','')<>regexp_replace(src_host,'^www\.','') then raise exception 'Il sito non corrisponde alla prova di identità';end if;
        update public.tourism_entities set website=site where id=(o.body->>'entity_id')::uuid and user_id=p_user_id and nullif(btrim(website),'') is null;
      end if;
    end if;
    decision:=public.decide_office_output(p_output_id,p_user_id,p_status);
    if decision->'output' is null or decision->'output'='null'::jsonb then raise exception sqlstate 'P0002' using message='Decisione non applicata';end if;
  exception when others then
    if sqlstate='P0002' and decision is not null then return decision;end if;
    return jsonb_build_object('output',null,'reason','enrich_failed','error',sqlerrm);
  end;
  if recorded and exists(select 1 from public.office_work_items where id=w.id and status='waiting_owner') then
    update public.office_work_items set status=case when p_status='approved' then 'succeeded' else 'cancelled' end,
      result=case when p_status='approved' then coalesce(decision->'output'->'body'->'result','{}')||jsonb_build_object('output_id',o.id,'approved',true)
        else jsonb_build_object('output_id',o.id,'approved',false) end,
      result_summary=case when p_status='approved' then 'Verifica approvata dal titolare; il lavoro successivo può partire.' else 'Il titolare ha rifiutato la proposta.' end,
      reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,finished_at=now(),revision=revision+1 where id=w.id;
    perform public.office_work_refresh_dependencies(p_user_id);
    perform public.office_work_refresh_order(w.order_id);
  end if;
  return decision;
end $$;

-- Il percorso di creazione del contatto applica i propri servizi prima di
-- office_director_contact_done. La decisione persistita conclude il lavoro,
-- anche se il processo web termina prima di aggiornare l'interfaccia.
create function public.office_work_output_decided() returns trigger
language plpgsql security definer set search_path='' as $$
declare w public.office_work_items;final_result jsonb;
begin
  if new.status not in ('approved','rejected') or old.status is not distinct from new.status then return new;end if;
  for w in select i.* from public.office_work_items i join public.office_work_outputs x on x.work_id=i.id
    where x.output_id=new.id and i.user_id=new.user_id and i.status='waiting_owner'
      and i.approval_output_id=new.id and x.payload_version=i.payload_version for update of i loop
    if new.status='approved' and new.agent_id='director' and new.body->>'action'='create_contact' then
      if not exists(select 1 from public.contacts where id=nullif(new.body->>'contact_id','')::uuid and user_id=w.user_id) then
        raise exception 'Contatto approvato privo di risultato del workspace';end if;
      final_result:=jsonb_build_object('contact_id',new.body->>'contact_id','output_id',new.id,'approved',true);
    elsif new.status='approved' and w.action='verify_tourism_entity' then
      final_result:=new.body->'result';
      if final_result is null or nullif(final_result->>'entity_id','') is null or nullif(final_result->>'place_id','') is null then
        raise exception 'Verifica approvata priva di risultato persistente';end if;
    else final_result:=jsonb_build_object('output_id',new.id,'approved',new.status='approved');end if;
    update public.office_work_items set status=case when new.status='rejected' then 'cancelled'
        when w.action='verify_tourism_entity' or new.body->>'action'='create_contact' then 'succeeded' else 'ready' end,
      result=case when new.status='approved' then final_result else jsonb_build_object('output_id',new.id,'approved',false) end,
      result_summary=case when new.status='rejected' then 'Il titolare ha rifiutato la proposta.'
        when new.body->>'action'='create_contact' then 'Contatto inserito nel CRM dopo approvazione.'
        when w.action='verify_tourism_entity' then 'Ente verificato dopo approvazione; la presentazione può partire.' else 'Incarico approvato dal titolare.' end,
      reason_code=null,reason=null,required_action=null,responsible=null,next_check_at=null,available_at=now(),
      finished_at=case when new.status='rejected' or w.action='verify_tourism_entity' or new.body->>'action'='create_contact' then now() else null end,
      revision=revision+1 where id=w.id;
    perform public.office_work_refresh_dependencies(w.user_id);
    perform public.office_work_refresh_order(w.order_id);
  end loop;
  return new;
end $$;
create trigger office_work_output_decided after update of status on public.office_agent_outputs
  for each row execute function public.office_work_output_decided();

-- Le ricevute della vecchia coda sono adottate; le voci senza autorizzazione
-- ricostruibile richiedono una verifica. Non si cancellano le liste salvate.
create function public.office_work_import_queue(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.office_agents;q jsonb;entry jsonb;k text;act text;v_output_id uuid;o public.office_agent_outputs;
  w jsonb;source text;state text;result jsonb;receipt jsonb;reason text;code text;imported integer:=0;adopted integer:=0;blocked integer:=0;
begin
  for a in select * from public.office_agents where user_id=p_user_id and id in ('mymaps_builder','maps_quality','presentations','languages_voice') for update loop
    if jsonb_typeof(a.settings->'queue') is distinct from 'array' then continue;end if;
    for q in select value from jsonb_array_elements(a.settings->'queue') loop
      if jsonb_typeof(q)='string' then
        entry:=case when a.id='presentations' then jsonb_build_object('entity_id',q#>>'{}')
          when a.id='languages_voice' then jsonb_build_object('map_id',q#>>'{}')
          else jsonb_build_object('slug',q#>>'{}','city',q#>>'{}') end;
      elsif jsonb_typeof(q)='object' then entry:=q;else continue;end if;
      -- Le mappe senza ordine/proposta restano monitoraggio per le lingue.
      if a.id='languages_voice' and not(entry?'source_output_id') and entry->>'origin' is distinct from 'director_order' then continue;end if;
      k:=coalesce(nullif(entry->>'key',''),nullif(entry->>'entity_id',''),nullif(entry->>'slug',''),nullif(entry->>'map_slug',''),md5(entry::text));
      source:='legacy:'||a.id||':'||k;
      if exists(select 1 from public.office_work_imports where user_id=p_user_id and agent_id=a.id and source_key=k) then continue;end if;
      v_output_id:=nullif(entry->>'source_output_id','')::uuid;
      o:=null;
      if v_output_id is not null then
        select * into o from public.office_agent_outputs where id=v_output_id and user_id=p_user_id;
        if not found or o.status='rejected' then
          insert into public.office_work_imports(user_id,agent_id,source_key) values(p_user_id,a.id,k) on conflict do nothing;continue;end if;
      end if;
      act:=case a.id when 'mymaps_builder' then 'import_mymaps' when 'maps_quality' then 'check_map'
        when 'presentations' then 'prepare_presentation' else 'complete_languages' end;
      -- Una verifica del nuovo flusso ha già il proprio passo dipendente:
      -- l'effetto compatibile della vecchia RPC non crea un secondo incarico.
      w:=null;
      if v_output_id is not null then
        select to_jsonb(i) into w from public.office_work_items i where i.user_id=p_user_id and i.agent_id=a.id and i.action=act
          and i.status<>'cancelled' and (i.source_output_id=v_output_id or exists(
            select 1 from public.office_work_dependencies d join public.office_work_outputs x on x.work_id=d.depends_on_work_id
              where d.work_id=i.id and x.output_id=v_output_id and x.user_id=p_user_id))
          order by i.created_at limit 1;
        if w is not null then
          insert into public.office_work_imports(user_id,agent_id,source_key,work_id) values(p_user_id,a.id,k,(w->>'id')::uuid);
          imported:=imported+1;continue;
        end if;
      end if;
      state:='ready';result:='{}';reason:=null;receipt:=null;code:=null;
      if v_output_id is null and entry->>'origin' is distinct from 'director_order' then
        state:='blocked';code:='legacy_review';reason:='Voce precedente da verificare prima di eseguirla nel nuovo motore.';
      elsif v_output_id is not null and o.status='pending' then state:='waiting_owner';reason:='Il titolare deve approvare la proposta precedente.';end if;
      if a.id='presentations' and to_regclass('public.office_presentation_tasks') is not null then
        execute 'select to_jsonb(t) from public.office_presentation_tasks t where user_id=$1 and entity_id=$2 and ($3::uuid is null or destination_id=$3::uuid) order by created_at desc limit 1'
          into receipt using p_user_id,nullif(entry->>'entity_id','')::uuid,nullif(entry->>'destination_id','');
        if receipt is not null then
          if receipt->>'state'='ready' and receipt->>'deck_id' is not null then
            state:='succeeded';result:=jsonb_build_object('deck_id',receipt->>'deck_id','entity_id',receipt->>'entity_id','place_id',receipt->>'destination_id','adopted',true);adopted:=adopted+1;
          else state:='blocked';code:='reconciliation_required';reason:='Tentativo di presentazione precedente da riconciliare; nessuna nuova generazione.';end if;
        end if;
      elsif a.id='mymaps_builder' then
        select to_jsonb(x) into receipt from public.office_agent_outputs x where x.user_id=p_user_id and x.agent_id=a.id and x.kind='report'
          and x.target_id=coalesce(entry->>'slug',entry->>'map_slug') and x.body?'created' and x.body->>'cost_cents'='0' order by x.created_at desc limit 1;
        if receipt is not null then
          if nullif(entry->>'source','') is not null and receipt->'body'->>'source'=entry->>'source' then
            state:='succeeded';result:=jsonb_build_object('output_id',receipt->>'id','receipt',receipt->'body','adopted',true);adopted:=adopted+1;
          else state:='blocked';code:='reconciliation_required';reason:='La ricevuta precedente non dimostra la stessa fonte richiesta: verificare prima di adottarla.';end if;
        end if;
      end if;
      if state<>'succeeded' and exists(select 1 from public.office_budget_ledger where user_id=p_user_id and agent_id=a.id and actual_cents is null and reserved_cents>0) then
        state:='blocked';code:='reconciliation_required';reason:='Spesa precedente dall’esito incerto: riconciliare prima di eseguire.';end if;
      w:=public.office_work_enqueue(p_user_id,jsonb_build_object('agent_id',a.id,'action',act,'origin','legacy','source_key',source,
        'source_output_id',v_output_id,'approval_output_id',case when state='waiting_owner' then v_output_id else null end,
        'payload',entry-'queued_at'-'updated_at'-'revisions'-'origin'-'status'-'key','status',state,'result',result,
        'result_summary',case when state='succeeded' then 'Risultato precedente adottato senza ripetere il lavoro.' else '' end,
        'reason_code',case when state='blocked' then code when state='waiting_owner' then 'approval_required' else null end,
        'reason',reason,'required_action',case when state in ('blocked','waiting_owner') then 'Verificare la voce e la ricevuta precedente nel pannello Lavori.' else null end,
        'responsible',case when state in ('blocked','waiting_owner') then 'Titolare' else null end));
      insert into public.office_work_imports(user_id,agent_id,source_key,work_id) values(p_user_id,a.id,k,(w->>'id')::uuid);
      imported:=imported+1;if state='blocked' then blocked:=blocked+1;end if;
    end loop;
  end loop;
  return jsonb_build_object('imported',imported,'adopted',adopted,'blocked',blocked);
end $$;

-- Una corsa originata da un lavoro non può spendere o aggiungere uscite se
-- la presa è scaduta, anche quando un processo precedente è ancora vivo.
create function public.office_work_fence_run() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.run_id is not null and exists(select 1 from public.office_work_attempts where run_id=new.run_id)
    and not exists(select 1 from public.office_work_attempts a join public.office_work_items w on w.id=a.work_id
      where a.run_id=new.run_id and w.status='running' and w.lease_token=a.lease_token and w.lease_until>clock_timestamp()) then
    raise exception 'Presa in carico del lavoro scaduta: spesa o uscita rifiutata';end if;
  return new;
end $$;
create trigger office_work_fence_ledger before insert on public.office_budget_ledger for each row execute function public.office_work_fence_run();
create trigger office_work_fence_output before insert on public.office_agent_outputs for each row execute function public.office_work_fence_run();

create function public.office_work_claim_events(p_user_id uuid,p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.office_work_events;token uuid;result jsonb:='[]';
begin
  if p_limit<1 or p_limit>50 then raise exception 'Limite non valido';end if;
  update public.office_work_events set status='uncertain',error='Consegna interrotta: verificare prima di riprovare.',lease_token=null,lease_until=null
    where user_id=p_user_id and status='sending' and lease_until<=clock_timestamp();
  for e in select * from public.office_work_events where user_id=p_user_id and status='pending' and coalesce((body->>'notify')::boolean,false)
    order by created_at,id limit p_limit for update skip locked loop
    token:=gen_random_uuid();
    update public.office_work_events set status='sending',lease_token=token,lease_until=clock_timestamp()+interval '90 seconds' where id=e.id returning * into e;
    result:=result||jsonb_build_array(to_jsonb(e));
  end loop;
  return result;
end $$;
create function public.office_work_finish_event(p_event_id uuid,p_token uuid,p_status text,p_error text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.office_work_events;
begin
  if p_status not in ('sent','uncertain','failed') then raise exception 'Esito consegna non valido';end if;
  update public.office_work_events set status=p_status,error=left(p_error,1000),sent_at=case when p_status='sent' then now() else null end,lease_token=null,lease_until=null
    where id=p_event_id and status='sending' and lease_token=p_token and lease_until>clock_timestamp() returning * into e;
  if not found then raise exception 'Consegna scaduta o già registrata';end if;
  return to_jsonb(e);
end $$;

do $$ declare t text; f regprocedure; begin
  foreach t in array array['office_work_items','office_work_dependencies','office_work_attempts','office_work_outputs','office_work_revisions','office_work_events','office_work_imports'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy work_owner_read on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'office_work_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
