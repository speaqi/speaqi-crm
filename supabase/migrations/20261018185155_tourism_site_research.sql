-- Bounded site research, staged POI candidates and project-level commercial work.
-- No automatic identity verification, CRM promotion, publication or outreach.
create table public.tourism_site_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  entity_id uuid,
  url text not null check (url ~ '^https?://[^[:space:]]+$'),
  label text not null check (length(btrim(label)) between 2 and 200),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  official_status text not null default 'candidate' check (official_status in ('candidate','confirmed','rejected')),
  destination_status text not null default 'candidate' check (destination_status in ('candidate','confirmed','rejected')),
  review_url text,
  review_note text not null default '' check (length(review_note)<=2000),
  enabled boolean not null default false,
  interval_days integer not null default 30 check (interval_days between 7 and 365),
  max_requests integer not null default 15 check (max_requests between 3 and 40),
  next_run_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  failures integer not null default 0,
  last_scanned_at timestamptz,
  last_state text,
  latest_report jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique(user_id,id), unique(user_id,url),
  foreign key(user_id,entity_id) references public.tourism_entities(user_id,id),
  check ((official_status<>'confirmed' and destination_status<>'confirmed') or (review_url is not null and review_url ~ '^https?://' and length(btrim(review_note))>=10))
);
create index tourism_site_sources_due_idx on public.tourism_site_sources(user_id,next_run_at) where enabled;
create table public.tourism_site_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  source_id uuid not null,
  state text not null check(state in ('completed','partial','blocked','failed')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  requests integer not null check(requests between 0 and 40),
  bytes bigint not null check(bytes>=0),
  duration_ms integer not null check(duration_ms>=0),
  report jsonb not null,
  changes jsonb not null,
  unique(user_id,id),
  foreign key(user_id,source_id) references public.tourism_site_sources(user_id,id)
);
create index tourism_site_scans_source_idx on public.tourism_site_scans(user_id,source_id,finished_at desc);
create table public.tourism_poi_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  source_id uuid not null,
  source_url text not null check(source_url ~ '^https?://'),
  name text not null check(length(btrim(name)) between 1 and 200),
  category text not null check(category in ('place','restaurant')),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  address text check(length(address)<=500),
  evidence_kind text not null check(evidence_kind in ('jsonld','html','link')),
  content_hash text not null,
  state text not null default 'candidate' check(state in ('candidate','approved','rejected')),
  reuse_status text not null default 'unknown' check(reuse_status in ('unknown','authorized','open')),
  reuse_url text,
  review_note text not null default '',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id,id),unique(source_id,source_url,name),
  foreign key(user_id,source_id) references public.tourism_site_sources(user_id,id),
  check((latitude is null)=(longitude is null)),
  check(state<>'approved' or (reuse_status<>'unknown' and reuse_url is not null and reuse_url ~ '^https?://' and length(btrim(review_note))>=10 and reviewed_by is not null and reviewed_at is not null))
);
create index tourism_poi_candidates_source_idx on public.tourism_poi_candidates(user_id,source_id,state);
create table public.tourism_project_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  entity_id uuid not null,
  title text not null check(length(btrim(title)) between 3 and 200),
  project_kind text not null default 'destination_map' check(project_kind in ('destination_map','multilingual_guide','ai_concierge','qr_network')),
  stage text not null default 'research' check(stage in ('research','meeting','demo_prepared','proposal','won','lost')),
  responsible text not null default '' check(length(responsible)<=200),
  next_action text not null default '' check(length(next_action)<=1000),
  project_status text check(project_status in ('demo','trial','active','suspended','archived')),
  platform_project_url text,
  source_url text not null check(source_url ~ '^https?://'),
  rationale text not null check(length(btrim(rationale)) between 10 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(user_id,id),
  foreign key(user_id,entity_id) references public.tourism_entities(user_id,id),
  check(project_status is null or (platform_project_url is not null and platform_project_url ~ '^https?://'))
);
create index tourism_project_opportunities_entity_idx on public.tourism_project_opportunities(user_id,entity_id,stage);
-- Reversible canonical identity: sources and their evidence remain intact.
create table public.tourism_canonical_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  duplicate_id uuid not null unique,
  canonical_id uuid not null,
  reason text not null check(length(btrim(reason)) between 10 and 2000),
  previous_status text not null,
  applied_version integer not null,
  created_at timestamptz not null default now(),
  foreign key(user_id,duplicate_id) references public.tourism_entities(user_id,id),
  foreign key(user_id,canonical_id) references public.tourism_entities(user_id,id),
  check(duplicate_id<>canonical_id)
);
create index tourism_canonical_links_owner_idx on public.tourism_canonical_links(user_id,canonical_id);

do $$ declare t text; begin
  foreach t in array array['tourism_site_sources','tourism_site_scans','tourism_poi_candidates','tourism_project_opportunities','tourism_canonical_links'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner on public.%I for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()))',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated,service_role',t);
    execute format('create trigger tourism_audit after insert or update or delete on public.%I for each row execute function public.tourism_audit()',t);
  end loop;
end $$;

create function public.tourism_research_guard() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.user_id<>old.user_id then raise exception 'Immutable identity'; end if;
    new.version:=old.version+1;
  end if;
  if tg_table_name='tourism_site_sources' then
    if tg_op='UPDATE' and (new.url,new.entity_id) is distinct from (old.url,old.entity_id) then raise exception 'Immutable site source: register a new URL'; end if;
    if new.official_status='rejected' or new.destination_status='rejected' then new.enabled:=false; end if;
  else
    new.updated_at:=now();
    if not exists(select 1 from public.tourism_entities where id=new.entity_id and user_id=new.user_id and kind='organization') then raise exception 'Organization required'; end if;
    if (new.stage<>'research' or new.project_status is not null) and not exists(select 1 from public.tourism_entities e join public.tourism_crm_links l on l.entity_id=e.id and l.user_id=e.user_id where e.id=new.entity_id and e.user_id=new.user_id and e.status='VERIFIED') then raise exception 'Verified organization linked to CRM required'; end if;
  end if;
  return new;
end $$;
create trigger tourism_research_guard before insert or update on public.tourism_site_sources for each row execute function public.tourism_research_guard();
create trigger tourism_research_guard before insert or update on public.tourism_project_opportunities for each row execute function public.tourism_research_guard();

create function public.tourism_claim_site(p_source_id uuid default null,p_owner uuid default null) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare s public.tourism_site_sources; owner_id uuid:=coalesce(p_owner,auth.uid()); token uuid:=gen_random_uuid();
begin
  if owner_id is null or (auth.uid() is distinct from owner_id and current_user<>'service_role') then raise exception 'Owner access denied'; end if;
  -- Serialize reservations too: the daily cap includes active leases across replicas.
  perform pg_advisory_xact_lock(hashtext(owner_id::text||':tourism-site-budget'));
  select * into s from public.tourism_site_sources where user_id=owner_id
    and (p_source_id is null or id=p_source_id)
    and (p_source_id is not null or (enabled and next_run_at<=now()))
    and official_status<>'rejected' and destination_status<>'rejected'
    and (leased_until is null or leased_until<now())
    order by next_run_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  if coalesce((select sum(requests) from public.tourism_site_scans where user_id=owner_id and finished_at>=date_trunc('day',now())),0)
    + coalesce((select sum(max_requests) from public.tourism_site_sources where user_id=owner_id and leased_until>now()),0)
    + s.max_requests > 120 then return null; end if;
  update public.tourism_site_sources set lease_token=token,leased_until=now()+interval '6 minutes' where id=s.id;
  return to_jsonb(s)||jsonb_build_object('lease_token',token);
end $$;

create function public.tourism_finish_site(p_source_id uuid,p_token uuid,p_report jsonb,p_changes jsonb) returns uuid
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
  update public.tourism_site_sources set latest_report=p_report,last_state=p_report->>'state',last_scanned_at=now(),
    failures=case when p_report->>'state' in ('blocked','failed') then failures+1 else 0 end,
    next_run_at=now()+make_interval(days=>case when p_report->>'state' in ('blocked','failed') then greatest(7,least(interval_days,7*(failures+1))) else interval_days end),
    lease_token=null,leased_until=null where id=s.id;
  -- Keep 90 days for budgets/usage plus at least four snapshots per source.
  delete from public.tourism_site_scans where source_id=s.id and finished_at<now()-interval '90 days' and id in (select id from public.tourism_site_scans where source_id=s.id order by finished_at desc,id desc offset 4);
  return scan_id;
end $$;

create function public.tourism_bulk_review(p_items jsonb) returns integer
language plpgsql security invoker set search_path=public as $$
declare item jsonb; n integer:=0;
begin
  if auth.uid() is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 25 then raise exception 'Invalid review batch'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'Duplicate review items'; end if;
  perform id from public.tourism_entities where user_id=auth.uid() and id in(select (value->>'id')::uuid from jsonb_array_elements(p_items)) order by id for update;
  for item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
    if exists(select 1 from public.tourism_entities where id=(item->>'id')::uuid and user_id=auth.uid() and (details @> '{"scope_requires_review":true}' or details @> '{"identity_requires_review":true}')) then raise exception 'Ambiguous identity requires individual review'; end if;
    perform public.tourism_review((item->>'id')::uuid,(item->>'evidence_id')::uuid,(item->>'version')::integer,true);
    n:=n+1;
  end loop;
  return n;
end $$;

create function public.tourism_set_canonical(p_duplicate uuid,p_canonical uuid,p_duplicate_version integer,p_canonical_version integer,p_reason text) returns uuid
language plpgsql security invoker set search_path=public as $$
declare d public.tourism_entities; c public.tourism_entities; link_id uuid;
begin
  if auth.uid() is null then raise exception 'Owner access denied'; end if;
  perform id from public.tourism_entities where user_id=auth.uid() and id in(p_duplicate,p_canonical) order by id for update;
  select * into d from public.tourism_entities where id=p_duplicate and user_id=auth.uid();
  select * into c from public.tourism_entities where id=p_canonical and user_id=auth.uid();
  if d.id is null or c.id is null or d.id=c.id or d.kind<>c.kind or d.country_code<>c.country_code then raise exception 'Invalid canonical identity'; end if;
  if d.version<>p_duplicate_version or c.version<>p_canonical_version then raise exception 'Version conflict'; end if;
  if exists(select 1 from public.tourism_canonical_links where user_id=auth.uid() and (duplicate_id in(d.id,c.id) or canonical_id=d.id)) then raise exception 'Canonical chains require review'; end if;
  if exists(select 1 from public.tourism_crm_links where entity_id=d.id and user_id=auth.uid()) then raise exception 'Duplicate linked to CRM requires individual review'; end if;
  insert into public.tourism_canonical_links(user_id,duplicate_id,canonical_id,reason,previous_status,applied_version)
    values(auth.uid(),d.id,c.id,p_reason,d.status,d.version+1) returning id into link_id;
  update public.tourism_entities set status='DUPLICATE' where id=d.id;
  return link_id;
end $$;
create function public.tourism_undo_canonical(p_link_id uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare l public.tourism_canonical_links; v integer;
begin
  select * into l from public.tourism_canonical_links where id=p_link_id and user_id=auth.uid() for update;
  if not found then raise exception 'Canonical link not found'; end if;
  select version into v from public.tourism_entities where id=l.duplicate_id and user_id=auth.uid() for update;
  if v<>l.applied_version then raise exception 'Version conflict: duplicate changed since consolidation'; end if;
  update public.tourism_entities set status=l.previous_status where id=l.duplicate_id and user_id=auth.uid();
  delete from public.tourism_canonical_links where id=l.id and user_id=auth.uid();
end $$;

create function public.tourism_research_overview() returns jsonb
language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
  'sources',(select count(*) from tourism_site_sources where user_id=auth.uid()),
  'enabled',(select count(*) from tourism_site_sources where user_id=auth.uid() and enabled),
  'scanned',(select count(*) from tourism_site_sources where user_id=auth.uid() and last_scanned_at is not null),
  'destination_confirmed',(select count(*) from tourism_site_sources where user_id=auth.uid() and official_status='confirmed' and destination_status='confirmed'),
  'poi_candidates',(select count(*) from tourism_poi_candidates where user_id=auth.uid()),
  'geocoded',(select count(*) from tourism_poi_candidates where user_id=auth.uid() and latitude is not null),
  'approved_poi',(select count(*) from tourism_poi_candidates where user_id=auth.uid() and state='approved'),
  'requests_last_30_days',(select coalesce(sum(requests),0) from tourism_site_scans where user_id=auth.uid() and finished_at>now()-interval '30 days'),
  'opportunities',(select count(*) from tourism_project_opportunities where user_id=auth.uid()),
  'stages',(select coalesce(jsonb_object_agg(stage,n),'{}') from(select stage,count(*) n from tourism_project_opportunities where user_id=auth.uid() group by stage)t),
  'project_statuses',(select coalesce(jsonb_object_agg(project_status,n),'{}') from(select project_status,count(*) n from tourism_project_opportunities where user_id=auth.uid() and project_status is not null group by project_status)t),
  'coverage',(select coalesce(jsonb_agg(to_jsonb(c) order by country_code),'[]') from(
    select country_code,count(*) organizations,count(*) filter(where status='VERIFIED') verified,
      count(*) filter(where website is not null) with_website,
      count(*) filter(where type_code='nto') nto,count(*) filter(where type_code='rto') rto,
      count(*) filter(where type_code in('dmo','local_office','cvb')) local_destinations,
      count(*) filter(where type_code='dmc') dmc,count(*) filter(where type_code='ota') ota,
      null::integer official_denominator
    from tourism_entities where user_id=auth.uid() and kind='organization' group by country_code
  ) c)
);
$$;

revoke all on function public.tourism_research_guard() from public,anon,authenticated;
revoke all on function public.tourism_claim_site(uuid,uuid),public.tourism_finish_site(uuid,uuid,jsonb,jsonb),public.tourism_bulk_review(jsonb),public.tourism_set_canonical(uuid,uuid,integer,integer,text),public.tourism_undo_canonical(uuid),public.tourism_research_overview() from public,anon;
grant execute on function public.tourism_claim_site(uuid,uuid),public.tourism_finish_site(uuid,uuid,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.tourism_bulk_review(jsonb),public.tourism_set_canonical(uuid,uuid,integer,integer,text),public.tourism_undo_canonical(uuid),public.tourism_research_overview() to authenticated;
