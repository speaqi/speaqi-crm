-- Creata con Supabase CLI e riordinata dopo la migration del 08 già in main.
-- Solo database locale nei test. La migration operativa la applica il titolare.
create function public.office_event_deadlines_valid(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; deadline date;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>2 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if coalesce(item->>'kind','') not in ('exhibitor_registration','grant') or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    deadline:=(item->>'date')::date;
    if deadline::text<>item->>'date' then return false; end if;
  end loop;
  return (select count(*)=count(distinct x->>'kind') from jsonb_array_elements(value) x);
exception when others then return false;
end $$;

create table public.office_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null check(length(slug) between 1 and 1000 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check(length(trim(name)) between 1 and 240),
  start_date date not null,
  end_date date,
  city text check(city is null or length(trim(city)) between 1 and 200),
  country_code text check(country_code is null or country_code ~ '^[A-Z]{2}$'),
  organizer text check(organizer is null or length(trim(organizer)) between 1 and 200),
  url text not null check(url ~ '^https?://[^[:space:]]+$' and length(url)<=2000),
  kind text not null check(kind in ('fair','b2b_workshop','grant','conference')),
  deadlines jsonb not null default '[]' check(public.office_event_deadlines_valid(deadlines)),
  score integer not null check(score between 0 and 100),
  source_url text not null check(source_url ~ '^https?://[^[:space:]]+$' and length(source_url)<=2000),
  first_seen_run_id uuid references public.office_agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,slug,start_date),
  check(start_date>=(created_at at time zone 'Europe/Rome')::date and start_date<=((created_at at time zone 'Europe/Rome')::date+interval '6 months')::date),
  check(end_date is null or (end_date>=start_date and end_date<=((created_at at time zone 'Europe/Rome')::date+interval '6 months')::date))
);
create index office_events_upcoming on public.office_events(user_id,start_date);
create index office_event_decisions on public.office_agent_outputs(user_id,target_id)
  where agent_id='events_scout' and kind='task' and target_table='office_events';
create function public.office_event_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if new.first_seen_run_id is not null and not exists(select 1 from public.office_agent_runs where id=new.first_seen_run_id and user_id=new.user_id and agent_id='events_scout') then raise exception 'Corsa eventi di un altro workspace'; end if;
  return new;
end $$;
create trigger office_event_owner before insert or update on public.office_events for each row execute function public.office_event_owner();
create table public.office_event_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null default 'events_scout' check(agent_id='events_scout'),
  run_id uuid references public.office_agent_runs(id) on delete set null,
  day date not null,
  pages jsonb not null check(jsonb_typeof(pages)='array' and jsonb_array_length(pages)<=30),
  status text not null default 'claimed' check(status in ('claimed','done')),
  output_id uuid references public.office_agent_outputs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,day),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade
);
create trigger office_event_batch_owner before insert or update on public.office_event_batches for each row execute function public.office_check_run_owner();
do $$ declare t text; begin
  foreach t in array array['office_events','office_event_batches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy office_event_read on public.%I for select to authenticated using((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated,service_role',t);
  end loop;
end $$;

create function public.claim_office_event_batch(p_run_id uuid,p_pages jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; b public.office_event_batches; page jsonb;
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='events_scout' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa eventi non attiva'; end if;
  if jsonb_typeof(p_pages) is distinct from 'array' or jsonb_array_length(p_pages)>30 then raise exception 'Fonti eventi non valide'; end if;
  for page in select * from jsonb_array_elements(p_pages) loop
    if coalesce(page->>'source_url','') !~ '^https?://' or length(page->>'source_url')>2000
      or jsonb_typeof(page->'text') is distinct from 'string' or length(page->>'text')>60000
      or jsonb_typeof(page->'links') is distinct from 'array' or jsonb_array_length(page->'links')>500
      or jsonb_typeof(page->'dates') is distinct from 'array' or jsonb_array_length(page->'dates')>1000 then raise exception 'Pagina eventi senza prove'; end if;
  end loop;
  insert into public.office_event_batches(user_id,run_id,day,pages)values(r.user_id,r.id,(now() at time zone 'Europe/Rome')::date,p_pages)
    on conflict(user_id,day) do nothing returning * into b;
  if found then return jsonb_build_object('claimed',true,'id',b.id); end if;
  return jsonb_build_object('claimed',false);
end $$;

create function public.finish_office_event_batch(p_run_id uuid,p_batch_id uuid,p_events jsonb,p_report jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; b public.office_event_batches; item jsonb; page jsonb; deadline jsonb;
  e public.office_events; report uuid; decision_date date; n integer:=0; tasks_count integer:=0; found_events jsonb:='[]';
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='events_scout' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa eventi non attiva'; end if;
  select * into b from public.office_event_batches where id=p_batch_id and user_id=r.user_id and run_id=r.id for update;
  if not found then raise exception 'Ricerca eventi di un altro workspace o corsa'; end if;
  if b.status='done' then return jsonb_build_object('created',0,'tasks',0,'report_id',b.output_id,'replay',true); end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>200 or jsonb_typeof(p_report) is distinct from 'object' then raise exception 'Elenco eventi non valido'; end if;
  for item in select * from jsonb_array_elements(p_events) loop
    select value into page from jsonb_array_elements(b.pages) where value->>'source_url'=item->>'source_url';
    if not found or not coalesce(page->'links' ? (item->>'url'),false)
      or not coalesce(page->'dates' ? (item->>'start_date'),false)
      or (item->>'end_date' is not null and not coalesce(page->'dates' ? (item->>'end_date'),false))
      or nullif(trim(item->>'name'),'') is null or strpos(lower(page->>'text'),lower(item->>'name'))=0 then raise exception 'Evento senza riscontro nella pagina'; end if;
    if not public.office_event_deadlines_valid(item->'deadlines') then raise exception 'Scadenze eventi non valide'; end if;
    for deadline in select * from jsonb_array_elements(item->'deadlines') loop
      if not (page->'dates' ? (deadline->>'date')) then raise exception 'Scadenza non presente nella pagina'; end if;
    end loop;
    insert into public.office_events(user_id,slug,name,start_date,end_date,city,country_code,organizer,url,kind,deadlines,score,source_url,first_seen_run_id)
      values(r.user_id,item->>'slug',item->>'name',(item->>'start_date')::date,(item->>'end_date')::date,item->>'city',item->>'country_code',item->>'organizer',item->>'url',item->>'kind',item->'deadlines',(item->>'score')::integer,item->>'source_url',r.id)
      on conflict(user_id,slug,start_date) do nothing returning * into e;
    if not found then continue; end if;
    n:=n+1; found_events:=found_events||jsonb_build_array(to_jsonb(e));
  end loop;
  -- Anche un evento già noto può entrare oggi nella finestra dei trenta giorni.
  -- Una proposta rifiutata o già approvata non viene riproposta.
  for e in select ev.* from public.office_events ev where ev.user_id=r.user_id and ev.start_date>=(now() at time zone 'Europe/Rome')::date
    and not exists(select 1 from public.office_agent_outputs o where o.user_id=r.user_id and o.agent_id='events_scout'
      and o.kind='task' and o.target_table='office_events' and o.target_id=ev.id::text)
    and exists(select 1 from jsonb_array_elements(ev.deadlines) d where (d->>'date')::date between (now() at time zone 'Europe/Rome')::date and (now() at time zone 'Europe/Rome')::date+30)
    order by ev.start_date,ev.id loop
    select min((value->>'date')::date) into decision_date from jsonb_array_elements(e.deadlines)
      where (value->>'date')::date between (now() at time zone 'Europe/Rome')::date and (now() at time zone 'Europe/Rome')::date+30;
    if decision_date is not null then
      perform public.add_office_agent_output(r.id,'event:decision:'||e.id::text,'task','Decidere se partecipare a '||e.name,
        jsonb_build_object('event_id',e.id,'deadline',decision_date,'url',e.url,'source_url',e.source_url,'action','decide_event_participation'),'office_events',e.id::text);
      tasks_count:=tasks_count+1;
    end if;
  end loop;
  select coalesce(jsonb_agg(value order by coalesce((select min(x->>'date') from jsonb_array_elements(value->'deadlines') x),value->>'start_date'),(value->>'score')::integer desc,value->>'slug'),'[]') into found_events from jsonb_array_elements(found_events);
  report:=public.add_office_agent_output(r.id,'events:'||b.day::text,'report','Eventi e bandi',p_report||jsonb_build_object('day',b.day,'events',found_events,'created',n,'tasks',tasks_count),null,null);
  update public.office_event_batches set status='done',output_id=report where id=b.id;
  return jsonb_build_object('created',n,'tasks',tasks_count,'report_id',report);
end $$;
revoke all on function public.office_event_deadlines_valid(jsonb),public.office_event_owner(),public.claim_office_event_batch(uuid,jsonb),public.finish_office_event_batch(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
-- La funzione immutabile serve al CHECK anche per gli inserimenti delle RPC.
grant execute on function public.claim_office_event_batch(uuid,jsonb),public.finish_office_event_batch(uuid,uuid,jsonb,jsonb) to service_role;

-- Copia della decisione corrente (05 e ramo 08), con un solo ramo aggiunto per il 06.
create or replace function public.decide_office_output(p_output_id uuid,p_user_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.office_agent_outputs; recipient public.office_agents; expected text; entry jsonb;
  g jsonb; merged jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; result jsonb;
  event_row public.office_events; event_deadline date; todo_id uuid;
begin
  if p_status not in ('approved','rejected') or p_status is null then raise exception 'Decisione non valida'; end if;
  select * into o from public.office_agent_outputs where id=p_output_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('output',null,'reason','not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('output',null,'reason','already_decided'); end if;
  if o.agent_id='director' and o.kind='proposal' and p_status='approved' then
    expected := case o.body->>'action' when 'build_map' then 'mymaps_builder'
      when 'publication_review' then 'maps_quality' when 'complete_languages' then 'languages_voice' else null end;
    if expected is null or expected is distinct from o.body->>'recipient_agent_id'
      or nullif(o.body->>'action_key','') is null or nullif(o.target_id,'') is null or o.target_table is null
      or nullif(trim(o.body->>'city'),'') is null
      or (o.body->>'action'='build_map' and o.target_table not in ('tourism_destinations','tourism_hubs'))
      or (o.body->>'action'='publication_review' and o.target_table is distinct from 'studiomap_maps')
      or (o.body->>'action'='complete_languages' and o.target_table is distinct from 'speaqi_maps') then
      raise exception 'Proposta del Direttore non valida';
    end if;
    if lower(coalesce(o.body->>'city','') || ' ' || coalesce(o.body->>'map_slug','') || ' ' || o.target_id)
      ~ '(napoli|naples)' then raise exception 'Napoli non modificabile'; end if;
    select * into recipient from public.office_agents where id=expected and user_id=p_user_id for update;
    if not found then return jsonb_build_object('output',null,'reason','agent_missing'); end if;
    if jsonb_typeof(coalesce(recipient.settings->'queue','[]'::jsonb)) <> 'array' then
      raise exception 'La coda del destinatario non e una lista';
    end if;
    entry := jsonb_build_object('key',o.body->>'action_key','action',o.body->>'action','city',o.body->>'city',
      'map_slug',o.body->'map_slug','target_table',o.target_table,'target_id',o.target_id,
      'source_output_id',o.id,'queued_at',now(),'status','pending');
    if not exists(select 1 from jsonb_array_elements(coalesce(recipient.settings->'queue','[]'::jsonb)) q
      where q->>'key'=o.body->>'action_key') then
      update public.office_agents set settings=jsonb_set(settings,'{queue}',coalesce(settings->'queue','[]'::jsonb) || jsonb_build_array(entry))
        where id=recipient.id and user_id=p_user_id;
    end if;
  end if;
  if o.agent_id='db_cleaner' and o.kind='data_fix' and o.body->>'action'='merge_contacts' and p_status='approved' then
    if jsonb_typeof(o.body->'groups') <> 'array' or jsonb_array_length(o.body->'groups') not between 1 and 20 then
      raise exception 'Proposta di unione non valida';
    end if;
    for g in select value from jsonb_array_elements(o.body->'groups') loop
      begin
        result := public.office_merge_contacts(p_user_id, (g->>'keep')::uuid,
          array(select jsonb_array_elements_text(g->'drop')::uuid), o.body->>'reason');
        merged := merged || jsonb_build_array(result);
      exception when others then
        skipped := skipped || jsonb_build_array(jsonb_build_object('keep', g->>'keep', 'error', sqlerrm));
      end;
    end loop;
    if jsonb_array_length(merged) = 0 then
      return jsonb_build_object('output',null,'reason','merge_failed','skipped',skipped);
    end if;
    update public.office_agent_outputs set body = body || jsonb_build_object('result', jsonb_build_object(
      'merged', merged, 'skipped', skipped, 'decided_at', now())) where id=o.id;
  end if;
  if o.agent_id='entity_enricher' and o.kind='proposal' and o.body->>'action'='enrich_entity' and p_status='approved' then
    begin
      result := public.office_enrich_entity(p_user_id, o.id);
    exception when others then
      -- Niente di fatto: la proposta resta da decidere, con il motivo.
      return jsonb_build_object('output',null,'reason','enrich_failed','error',sqlerrm);
    end;
    update public.office_agent_outputs set body = body || jsonb_build_object('result', result || jsonb_build_object('decided_at', now())) where id=o.id;
  end if;
  -- BEGIN EVENTS_SCOUT: Direttore, 05 e 08 restano invariati.
  if o.agent_id='events_scout' and o.kind='task' and p_status='approved' then
    if o.target_table is distinct from 'office_events' or o.target_id is distinct from o.body->>'event_id'
      or o.body->>'action' is distinct from 'decide_event_participation' then raise exception 'Decisione eventi non valida'; end if;
    select * into event_row from public.office_events where id=o.target_id::uuid and user_id=p_user_id for update;
    if not found then raise exception 'Evento di un altro workspace o mancante'; end if;
    if coalesce(o.body->>'deadline','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Scadenza decisione non valida'; end if;
    event_deadline:=(o.body->>'deadline')::date;
    if not exists(select 1 from jsonb_array_elements(event_row.deadlines) d where d->>'date'=event_deadline::text) then raise exception 'Scadenza senza fonte'; end if;
    if event_deadline<(now() at time zone 'Europe/Rome')::date then return jsonb_build_object('output',null,'reason','deadline_passed'); end if;
    if event_deadline>(now() at time zone 'Europe/Rome')::date+30 then raise exception 'Scadenza oltre trenta giorni'; end if;
    insert into public.tasks(user_id,contact_id,type,area,title,status,due_date,idempotency_key,note)
      values(p_user_id,null,'todo','speaqi','Decidere se partecipare a '||event_row.name,'pending',
        event_deadline::timestamp at time zone 'Europe/Rome','office-event:'||event_row.id::text,
        'Evento: '||event_row.url||E'\nFonte: '||event_row.source_url)
      on conflict(user_id,idempotency_key) where idempotency_key is not null do nothing returning id into todo_id;
    if todo_id is null then select id into todo_id from public.tasks where user_id=p_user_id and idempotency_key='office-event:'||event_row.id::text; end if;
    update public.office_agent_outputs set body=body||jsonb_build_object('result',jsonb_build_object('task_id',todo_id,'decided_at',now())) where id=o.id;
  end if;
  -- END EVENTS_SCOUT
  update public.office_agent_outputs set status=p_status,decided_at=now() where id=o.id returning * into o;
  return jsonb_build_object('output',to_jsonb(o));
end;
$$;
revoke all on function public.decide_office_output(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_office_output(uuid,uuid,text) to service_role;
