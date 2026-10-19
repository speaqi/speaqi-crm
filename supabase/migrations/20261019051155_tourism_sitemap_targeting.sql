-- Independent target exclusion and one-time sitemap qualification across every catalog URL.
alter table public.tourism_entities add column disabled boolean not null default false;
alter table public.tourism_entities add column site_qualification jsonb not null default '{}' check(jsonb_typeof(site_qualification)='object');
create index tourism_entities_target_idx on public.tourism_entities(user_id,disabled,(site_qualification->>'classification'));
alter table public.tourism_site_sources add column excluded boolean not null default false;
alter table public.tourism_site_sources add column exclusion_origin text not null default '' check(exclusion_origin in('','entity','manual'));
alter table public.tourism_site_sources add column qualification_pending boolean not null default false;
alter table public.tourism_site_sources add column qualification_checked_at timestamptz;
create index tourism_site_sources_qualification_idx on public.tourism_site_sources(user_id,qualification_pending,next_run_at) where not excluded;

create or replace function public.tourism_claim_site(p_source_id uuid default null,p_owner uuid default null) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare s public.tourism_site_sources; owner_id uuid:=coalesce(p_owner,auth.uid()); token uuid:=gen_random_uuid();
begin
  if owner_id is null or (auth.uid() is distinct from owner_id and current_user<>'service_role') then raise exception 'Owner access denied'; end if;
  -- Serialize reservations too: the daily cap includes active leases across replicas.
  perform pg_advisory_xact_lock(hashtext(owner_id::text||':tourism-site-budget'));
  select * into s from public.tourism_site_sources where user_id=owner_id
    and (p_source_id is null or id=p_source_id)
    and (p_source_id is not null or qualification_pending or (enabled and next_run_at<=now()))
    and not excluded
    and (entity_id is null or exists(select 1 from public.tourism_entities e where e.user_id=owner_id and not e.disabled and e.status not in('INACTIVE','DUPLICATE') and (e.id=tourism_site_sources.entity_id or e.website=tourism_site_sources.url)))
    and official_status<>'rejected' and destination_status<>'rejected'
    and (leased_until is null or leased_until<now())
    order by qualification_pending desc,next_run_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  if coalesce((select sum(requests) from public.tourism_site_scans where user_id=owner_id and finished_at>=date_trunc('day',now())),0)
    + coalesce((select sum(max_requests) from public.tourism_site_sources where user_id=owner_id and leased_until>now()),0)
    + s.max_requests > (case when s.qualification_pending then 5000 else 120 end) then return null; end if;
  update public.tourism_site_sources set lease_token=token,leased_until=now()+interval '6 minutes' where id=s.id;
  return to_jsonb(s)||jsonb_build_object('lease_token',token);
end $$;

create or replace function public.tourism_finish_site(p_source_id uuid,p_token uuid,p_report jsonb,p_changes jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare s public.tourism_site_sources; scan_id uuid; p jsonb; h text;
begin
  select * into s from public.tourism_site_sources where id=p_source_id for update;
  if not found or (auth.uid() is distinct from s.user_id and current_user<>'service_role') then raise exception 'Owner access denied'; end if;
  if p_token is null or s.lease_token is distinct from p_token or s.leased_until<now() then raise exception 'Version conflict: expired site lease'; end if;
  if p_report->>'site_url' is distinct from s.url or length(p_report::text)>2000000 or coalesce(jsonb_typeof(p_report->'candidates'),'')<>'array' or jsonb_array_length(p_report->'candidates')>1000 or (p_report->>'requests')::integer>s.max_requests then raise exception 'Invalid site report'; end if;
  insert into public.tourism_site_scans(user_id,source_id,state,started_at,requests,bytes,duration_ms,report,changes)
    values(s.user_id,s.id,p_report->>'state',(p_report->>'fetched_at')::timestamptz,(p_report->>'requests')::integer,(p_report->>'bytes')::bigint,(p_report->>'duration_ms')::integer,p_report,p_changes) returning id into scan_id;
  for p in select value from jsonb_array_elements(p_report->'candidates') loop
    h:=md5((p-'last_seen_at')::text);
    insert into public.tourism_poi_candidates(user_id,source_id,source_url,name,category,latitude,longitude,address,evidence_kind,content_hash)
      values(s.user_id,s.id,p->>'source_url',p->>'name',p->>'category',(p->>'latitude')::double precision,(p->>'longitude')::double precision,p->>'address',p->>'evidence_kind',h)
      on conflict(source_id,source_url,name) do update set
        category=excluded.category,latitude=excluded.latitude,longitude=excluded.longitude,address=excluded.address,
        evidence_kind=excluded.evidence_kind,last_seen_at=now(),content_hash=excluded.content_hash,
        state=case when tourism_poi_candidates.content_hash<>excluded.content_hash then 'candidate' else tourism_poi_candidates.state end,
        reviewed_by=case when tourism_poi_candidates.content_hash<>excluded.content_hash then null else tourism_poi_candidates.reviewed_by end,
        reviewed_at=case when tourism_poi_candidates.content_hash<>excluded.content_hash then null else tourism_poi_candidates.reviewed_at end;
  end loop;
  update public.tourism_site_sources set qualification_checked_at=case when qualification_pending then now() else qualification_checked_at end,qualification_pending=false,latest_report=p_report,last_state=p_report->>'state',last_scanned_at=now(),
    failures=case when p_report->>'state' in ('blocked','failed') then failures+1 else 0 end,
    next_run_at=now()+make_interval(days=>case when p_report->>'state' in ('blocked','failed') then greatest(7,least(interval_days,7*(failures+1))) else interval_days end),
    lease_token=null,leased_until=null where id=s.id;
  if jsonb_typeof(p_report->'target_check')='object' then
    update public.tourism_entities set site_qualification=jsonb_build_object('source_id',s.id,'url',s.url,'checked_at',p_report->>'fetched_at','classification',p_report->'target_check'->>'classification','sitemap_status',p_report->'sitemap'->>'status','sitemap_enumerated',p_report->'sitemap'->'enumeration_complete','evidence',p_report->'target_check'->'evidence','state',p_report->>'state') where user_id=s.user_id and website=s.url and not disabled and status not in('INACTIVE','DUPLICATE');
  end if;
  return scan_id;
end $$;

create function public.tourism_toggle_entity(p_entity_id uuid,p_version integer,p_disabled boolean) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare e public.tourism_entities;
begin
  if auth.uid() is null or p_disabled is null then raise exception 'Owner and decision required'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-targeting'));
  select * into e from public.tourism_entities where id=p_entity_id and user_id=auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or e.version<>p_version then raise exception 'Version conflict'; end if;
  update public.tourism_entities set disabled=p_disabled where id=e.id and user_id=auth.uid();
  if p_disabled then
    update public.tourism_site_sources s set excluded=true,exclusion_origin='entity',enabled=false,qualification_pending=false
      where s.user_id=auth.uid() and (s.entity_id=e.id or s.url=e.website) and exclusion_origin<>'manual'
      and not exists(select 1 from public.tourism_entities other where other.user_id=auth.uid() and other.id<>e.id and not other.disabled and other.status not in('INACTIVE','DUPLICATE') and other.website=s.url);
  else
    update public.tourism_site_sources set excluded=false,exclusion_origin='',qualification_pending=true where user_id=auth.uid() and (entity_id=e.id or url=e.website) and exclusion_origin='entity';
  end if;
  return jsonb_build_object('id',e.id,'disabled',p_disabled,'version',e.version+1);
end $$;

create function public.tourism_queue_site_checks() returns jsonb
language plpgsql security invoker set search_path=public as $$
declare added integer; queued integer;
begin
  if auth.uid() is null then raise exception 'Owner required'; end if;
  with candidates as(select distinct on(website) id,name,country_code,website from public.tourism_entities
    where user_id=auth.uid() and website is not null and kind<>'person' and not disabled and status not in('INACTIVE','DUPLICATE') order by website,id),
  inserted as(insert into public.tourism_site_sources(user_id,entity_id,url,label,country_code,max_requests,enabled,qualification_pending)
    select auth.uid(),id,website,name,case when country_code ~ '^[A-Z]{2}$' then country_code else 'ZZ' end,10,false,true from candidates
    on conflict(user_id,url) do nothing returning id)
  select count(*) into added from inserted;
  update public.tourism_site_sources s set qualification_pending=true,next_run_at=now() where user_id=auth.uid() and not excluded and qualification_checked_at is null
    and (entity_id is null or exists(select 1 from public.tourism_entities e where e.user_id=auth.uid() and not e.disabled and e.status not in('INACTIVE','DUPLICATE') and (e.id=s.entity_id or e.website=s.url)));
  select count(*) into queued from public.tourism_site_sources where user_id=auth.uid() and qualification_pending and not excluded;
  return jsonb_build_object('added',added,'queued',queued);
end $$;
revoke all on function public.tourism_toggle_entity(uuid,integer,boolean),public.tourism_queue_site_checks() from public,anon;
grant execute on function public.tourism_toggle_entity(uuid,integer,boolean),public.tourism_queue_site_checks() to authenticated;

create view public.tourism_site_work_queue with(security_invoker=true) as select id,user_id,next_run_at,leased_until,qualification_pending from public.tourism_site_sources where not excluded and (qualification_pending or enabled) and official_status<>'rejected' and destination_status<>'rejected';
revoke all on public.tourism_site_work_queue from public,anon,authenticated;
grant select on public.tourism_site_work_queue to service_role;
