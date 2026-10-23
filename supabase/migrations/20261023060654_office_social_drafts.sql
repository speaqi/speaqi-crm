-- Social prepara soltanto draft_post pending. Nessuna API social o invio.
-- Da applicare a cura di Claude prima del merge, non dall'agente di sviluppo.
create table public.office_social_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null default 'social' check(agent_id='social'),
  run_id uuid references public.office_agent_runs(id) on delete set null,
  week date not null,
  sources jsonb not null check(jsonb_typeof(sources)='array' and jsonb_array_length(sources) between 1 and 5),
  status text not null default 'claimed' check(status in ('claimed','done')),
  created_at timestamptz not null default now(),
  unique(user_id,week),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade
);
create trigger office_social_batch_owner before insert or update on public.office_social_batches
for each row execute function public.office_check_run_owner();
create table public.office_social_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  map_slug text not null,
  week date not null,
  facts jsonb not null check(jsonb_typeof(facts)='object'),
  batch_id uuid not null references public.office_social_batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id,map_slug,week)
);
do $$ declare t text; begin
  foreach t in array array['office_social_batches','office_social_snapshots'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy office_social_owner on public.%I for select to authenticated using ((select auth.uid())=user_id)',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create function public.claim_office_social_batch(p_run_id uuid,p_sources jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; b public.office_social_batches; source jsonb;
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='social' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa social non attiva'; end if;
  if jsonb_typeof(p_sources) is distinct from 'array' or jsonb_array_length(p_sources) not between 1 and 5 then raise exception 'Fonti social non valide'; end if;
  for source in select value from jsonb_array_elements(p_sources) loop
    if coalesce(source->>'slug','') !~ '^[a-z0-9][a-z0-9_-]{0,99}$' or nullif(source->>'name','') is null
      or jsonb_typeof(source->'photo_urls') is distinct from 'array' or jsonb_array_length(source->'photo_urls')=0
      or source->>'url' is distinct from 'https://guides.speaqi.com/maps/'||(source->>'slug') then raise exception 'Guida senza identità, link o foto verificati'; end if;
    if lower((source->>'slug')||' '||(source->>'name'))~'(napoli|naples)' then raise exception 'Nessuna nuova bozza su Napoli'; end if;
  end loop;
  insert into public.office_social_batches(user_id,run_id,week,sources)
    values(r.user_id,r.id,date_trunc('week',(now() at time zone 'Europe/Rome'))::date,p_sources)
    on conflict(user_id,week) do nothing returning * into b;
  if found then return jsonb_build_object('claimed',true,'id',b.id); end if;
  return jsonb_build_object('claimed',false);
end $$;
create function public.finish_office_social_batch(p_batch_id uuid,p_run_id uuid,p_posts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; b public.office_social_batches; item jsonb; source jsonb; platform text; copy jsonb; n integer:=0; ids jsonb:='[]'; output uuid;
begin
  perform 1 from public.office_agents where id=(select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='social' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa social non attiva'; end if;
  select * into b from public.office_social_batches where id=p_batch_id and user_id=r.user_id and run_id=r.id for update;
  if not found then raise exception 'Settimana di un altro workspace o corsa'; end if;
  if b.status='done' then return jsonb_build_object('created',false); end if;
  if jsonb_typeof(p_posts) is distinct from 'array' or jsonb_array_length(p_posts) not between 3 and 5 then raise exception 'Servono da tre a cinque bozze'; end if;
  for item in select value from jsonb_array_elements(p_posts) loop
    select value into source from jsonb_array_elements(b.sources) where value->>'slug'=item->>'guide_slug';
    if not found or item->'facts' is distinct from source or not (source->'photo_urls' ? (item->>'photo_url')) then raise exception 'Bozza senza riscontro nelle fonti o foto inventata'; end if;
    foreach platform in array array['instagram','linkedin','facebook'] loop
      copy:=item->'platforms'->platform;
      if jsonb_typeof(copy->'text') is distinct from 'string' or nullif(trim(copy->>'text'),'') is null
        or jsonb_typeof(copy->'hashtags') is distinct from 'array' or jsonb_array_length(copy->'hashtags')>5
        or copy->>'url' is distinct from (source->>'url')||'?utm_source='||platform||'&utm_medium=social&utm_campaign=office_social' then raise exception 'Testo, hashtag o UTM non validi'; end if;
      if lower(copy->>'text')~'(napoli|naples)' then raise exception 'Nessuna nuova bozza su Napoli'; end if;
    end loop;
    n:=n+1;
    output:=public.add_office_agent_output(r.id,'social:'||b.week::text||':'||n::text,'draft_post','Bozza social: '||(source->>'name'),item,null,null);
    ids:=ids||jsonb_build_array(output);
  end loop;
  for source in select value from jsonb_array_elements(b.sources) loop
    insert into public.office_social_snapshots(user_id,map_slug,week,facts,batch_id)
      values(r.user_id,source->>'slug',b.week,source,b.id) on conflict(user_id,map_slug,week) do nothing;
  end loop;
  update public.office_social_batches set status='done' where id=b.id;
  return jsonb_build_object('created',true,'ids',ids);
end $$;
revoke all on function public.claim_office_social_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_office_social_batch(uuid,jsonb) to service_role;
revoke all on function public.finish_office_social_batch(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_office_social_batch(uuid,uuid,jsonb) to service_role;
