-- Osservatorio: prenotazione del tentativo, rassegna e visti persistenti.
-- File da consegnare a Claude: nessuna applicazione a database operativi.
create table public.office_news_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null default 'news_watch' check(agent_id='news_watch'),
  run_id uuid references public.office_agent_runs(id) on delete set null,
  day date not null,
  sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=24),
  status text not null default 'claimed' check(status in ('claimed','done')),
  output_id uuid references public.office_agent_outputs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,day),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade
);
create trigger office_news_batch_owner before insert or update on public.office_news_batches
for each row execute function public.office_check_run_owner();
create table public.office_news_seen (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null check(length(url) between 1 and 2000),
  title text not null,
  published_at timestamptz not null,
  seen_at timestamptz not null default now(),
  batch_id uuid not null references public.office_news_batches(id) on delete cascade,
  unique(user_id,url)
);
create index office_news_seen_recent on public.office_news_seen(user_id,seen_at desc);
create table public.office_news_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  output_id uuid not null unique references public.office_agent_outputs(id) on delete cascade,
  status text not null default 'claimed' check(status in ('claimed','sent','uncertain')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
do $$ declare t text; begin
  foreach t in array array['office_news_batches','office_news_seen','office_news_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy office_news_owner on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.claim_office_news_batch(p_run_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; b public.office_news_batches; item jsonb;
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='news_watch' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa notizie non attiva'; end if;
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources)>24 then raise exception 'Fonti non valide'; end if;
  for item in select value from jsonb_array_elements(p_sources) loop
    if nullif(item->>'url','') is null or nullif(item->>'title','') is null or (item->>'url') !~ '^https?://' or length(item->>'url')>2000
      or (item->>'published_at') is null or (item->>'published_at')::timestamptz<now()-interval '48 hours'
      or (item->>'published_at')::timestamptz>now() then raise exception 'Articolo senza fonte o fuori finestra'; end if;
  end loop;
  insert into public.office_news_batches(user_id,run_id,day,sources)
    values(r.user_id,r.id,(now() at time zone 'Europe/Rome')::date,p_sources)
    on conflict(user_id,day) do nothing returning * into b;
  if found then return jsonb_build_object('claimed',true,'id',b.id); end if;
  return jsonb_build_object('claimed',false);
end $$;

create function public.finish_office_news_batch(p_batch_id uuid,p_run_id uuid,p_body jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.office_news_batches; r public.office_agent_runs; item jsonb; source jsonb; output uuid;
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='news_watch' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa notizie non attiva'; end if;
  select * into b from public.office_news_batches where id=p_batch_id and user_id=r.user_id and run_id=r.id for update;
  if not found then raise exception 'Rassegna di un altro workspace o corsa'; end if;
  if b.status='done' then return b.output_id; end if;
  if jsonb_typeof(p_body->'articles') is distinct from 'array' or jsonb_array_length(p_body->'articles')>8 then raise exception 'Rassegna non valida'; end if;
  for item in select value from jsonb_array_elements(p_body->'articles') loop
    select value into source from jsonb_array_elements(b.sources) where value->>'url'=item->>'url';
    if not found or item->>'title' is distinct from source->>'title' or nullif(trim(item->>'summary'),'') is null
      or nullif(trim(item->>'why'),'') is null then raise exception 'Notizia senza riscontro nelle fonti lette'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_body->'articles'))<>(select count(distinct value->>'url') from jsonb_array_elements(p_body->'articles')) then raise exception 'Notizie duplicate'; end if;
  output:=public.add_office_agent_output(r.id,'news:'||b.day::text,'report','Novità di oggi',p_body,null,null);
  for item in select value from jsonb_array_elements(p_body->'articles') loop
    select value into source from jsonb_array_elements(b.sources) where value->>'url'=item->>'url';
    insert into public.office_news_seen(user_id,url,title,published_at,batch_id)
      values(r.user_id,source->>'url',source->>'title',(source->>'published_at')::timestamptz,b.id) on conflict(user_id,url) do nothing;
  end loop;
  update public.office_news_batches set status='done',output_id=output where id=b.id;
  return output;
end $$;

-- Chiamabile solo dalla rotta del titolare dopo il clic esplicito. Nessun job
-- macchina richiama questa funzione o invia una notifica in autonomia.
create function public.claim_office_news_delivery(p_output_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.office_agent_outputs; delivery uuid;
begin
  perform 1 from public.office_agents where id='news_watch' and user_id=p_user_id and settings->'telegram'='true'::jsonb for update;
  if not found then raise exception 'Telegram non abilitato nelle impostazioni'; end if;
  select * into o from public.office_agent_outputs where id=p_output_id and user_id=p_user_id and agent_id='news_watch' and kind='report' and status in ('pending','approved') for update;
  if not found or jsonb_typeof(o.body->'articles') is distinct from 'array' or jsonb_array_length(o.body->'articles')=0 then raise exception 'Rassegna non disponibile per invio'; end if;
  insert into public.office_news_deliveries(user_id,output_id) values(p_user_id,o.id) on conflict(output_id) do nothing returning id into delivery;
  if delivery is null then return jsonb_build_object('claimed',false); end if;
  update public.office_agent_outputs set status='approved',decided_at=coalesce(decided_at,now()) where id=o.id;
  return jsonb_build_object('claimed',true,'id',delivery,'body',o.body);
end $$;
create function public.record_office_news_delivery(p_id uuid,p_user_id uuid,p_message_id text,p_error text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.office_news_deliveries set status=case when nullif(p_message_id,'') is null then 'uncertain' else 'sent' end,
    provider_message_id=nullif(p_message_id,''),error=left(p_error,1000),finished_at=now()
    where id=p_id and user_id=p_user_id and status='claimed';
end $$;
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in
    ('claim_office_news_batch','finish_office_news_batch','claim_office_news_delivery','record_office_news_delivery') loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
