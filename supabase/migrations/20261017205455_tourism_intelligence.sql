-- Private, owner-operated intelligence catalog. No service-role writes or outreach.
create or replace function public.tourism_name_key(value text) returns text
language sql immutable strict set search_path = public as $$
  select trim(regexp_replace(translate(lower(value), 'àáâäãåèéêëìíîïòóôöõùúûüñç', 'aaaaaaeeeeiiiiooooouuuunc'), '[^[:alnum:]]+', ' ', 'g'));
$$;

create table public.tourism_taxonomy (
  code text primary key check (code ~ '^[a-z_]+$'),
  labels jsonb not null,
  governance boolean not null default false
);
insert into public.tourism_taxonomy(code, labels, governance) values
 ('ministry','{"it":"Ministero del turismo","en":"Tourism ministry"}',true),
 ('nto','{"it":"Ente nazionale / NTO / NTA","en":"National tourism organization"}',true),
 ('rto','{"it":"Agenzia regionale / RTO","en":"Regional tourism organization"}',true),
 ('dmo','{"it":"DMO","en":"Destination management organization"}',true),
 ('dmc','{"it":"DMC · operatore commerciale","en":"Destination management company"}',false),
 ('cvb','{"it":"Convention & Visitors Bureau","en":"Convention & Visitors Bureau"}',false),
 ('gal','{"it":"Gruppo di Azione Locale","en":"Local action group"}',false),
 ('municipal_union','{"it":"Unione di comuni / comunità montana","en":"Municipal union"}',true),
 ('consortium','{"it":"Consorzio turistico / territoriale","en":"Tourism consortium"}',false),
 ('wine_route','{"it":"Strada del vino e dei sapori","en":"Wine and food route"}',false),
 ('foundation','{"it":"Fondazione territoriale","en":"Territorial foundation"}',false),
 ('association','{"it":"Associazione / Pro Loco","en":"Tourism association"}',false),
 ('park','{"it":"Ente parco","en":"Park authority"}',true),
 ('district','{"it":"Distretto / cluster turistico","en":"Tourism district or cluster"}',false),
 ('chamber','{"it":"Camera di commercio","en":"Chamber of commerce"}',false),
 ('local_office','{"it":"Ufficio turistico locale","en":"Local tourism office"}',true),
 ('network','{"it":"Rete / partnership territoriale","en":"Destination network"}',false),
 ('development_authority','{"it":"Autorità di sviluppo turistico","en":"Tourism development authority"}',true),
 ('other','{"it":"Altra organizzazione · da classificare","en":"Other organization"}',false);

create or replace function public.tourism_search_document(entity_name text,website text,aliases text[],details jsonb) returns tsvector
language sql immutable set search_path=public as $$
  select to_tsvector('simple',entity_name||' '||coalesce(website,'')||' '||array_to_string(aliases,' ')||' '||coalesce(details->>'description',''));
$$;

create table public.tourism_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('organization','place','brand','portal','person')),
  name text not null check (length(btrim(name)) between 2 and 200),
  name_key text generated always as (public.tourism_name_key(name)) stored,
  country_code text not null default '' check (country_code = '' or country_code ~ '^[A-Z]{2}$'),
  type_code text references public.tourism_taxonomy(code),
  website text check (website is null or website ~ '^https?://[^[:space:]]+$'),
  email text check (email is null or email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text check (length(phone) <= 80),
  aliases text[] not null default '{}',
  external_ids jsonb not null default '{}' check (jsonb_typeof(external_ids) = 'object'),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  status text not null default 'UNVERIFIED' check (status in ('DISCOVERED','UNVERIFIED','VERIFIED','NEEDS_REVIEW','INACTIVE','DUPLICATE')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (public.tourism_search_document(name,website,aliases,details)) stored,
  unique (user_id,id),
  unique (user_id,kind,country_code,name_key),
  check (kind <> 'organization' or (country_code <> '' and type_code is not null)),
  check (name_key <> '')
);
create index tourism_entities_search_idx on public.tourism_entities using gin(search_document);
create index tourism_entities_filters_idx on public.tourism_entities(user_id,kind,country_code,type_code,status,id);

create table public.tourism_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id uuid not null,
  source_url text not null check (source_url ~ '^https?://[^[:space:]]+$'),
  title text not null check (length(btrim(title)) between 2 and 300),
  excerpt text not null default '' check (length(excerpt) <= 2000),
  fields text[] not null check (cardinality(fields) > 0),
  method text not null default 'manual' check (method in ('manual','import','ai','pilot','crm')),
  status text not null default 'UNVERIFIED' check (status in ('UNVERIFIED','VERIFIED','REJECTED')),
  acquired_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  unique (user_id,id),
  foreign key (user_id,entity_id) references public.tourism_entities(user_id,id) on delete cascade,
  check (status <> 'VERIFIED' or (verified_at is not null and verified_by is not null))
);
create index tourism_evidence_entity_idx on public.tourism_evidence(user_id,entity_id);

create table public.tourism_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_id uuid not null,
  to_id uuid not null,
  relation text not null check (relation in ('PART_OF','COVERS','MANAGES','PROMOTES','OPERATES_BRAND','OPERATES_PORTAL','MEMBER_OF','PARTNER_OF','WORKS_FOR')),
  evidence_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (user_id,from_id) references public.tourism_entities(user_id,id),
  foreign key (user_id,to_id) references public.tourism_entities(user_id,id),
  foreign key (user_id,evidence_id) references public.tourism_evidence(user_id,id),
  unique (user_id,from_id,to_id,relation),
  check (from_id <> to_id)
);
create index tourism_relations_to_idx on public.tourism_relations(user_id,to_id);

-- The existing CRM has contacts, not a canonical account table. Keep the bridge explicit.
create table public.tourism_crm_links (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id uuid primary key,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (user_id,entity_id) references public.tourism_entities(user_id,id)
);

create table public.tourism_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  actor_id uuid,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index tourism_revisions_record_idx on public.tourism_revisions(user_id,record_id,created_at desc);

create table public.tourism_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  query text not null check (length(btrim(query)) between 5 and 1000),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_until timestamptz,
  lease_token uuid,
  result jsonb not null default '[]',
  usage jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index tourism_jobs_owner_idx on public.tourism_jobs(user_id,created_at desc);

-- RLS applies to direct PostgREST clients too. MVP is deliberately owner-only.
do $$ declare t text; begin
  foreach t in array array['tourism_entities','tourism_evidence','tourism_relations','tourism_crm_links','tourism_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy tourism_owner on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
alter table public.tourism_taxonomy enable row level security;
create policy tourism_taxonomy_read on public.tourism_taxonomy for select to authenticated using (true);
alter table public.tourism_revisions enable row level security;
create policy tourism_revisions_read on public.tourism_revisions for select to authenticated using (user_id = auth.uid());

create or replace function public.tourism_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare before_row jsonb; after_row jsonb; current_row jsonb;
begin
  if tg_op <> 'INSERT' then before_row:=to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row:=to_jsonb(new); end if;
  current_row:=coalesce(after_row,before_row);
  insert into public.tourism_revisions(user_id,table_name,record_id,actor_id,operation,before_data,after_data)
  values ((current_row->>'user_id')::uuid,tg_table_name,
    (case when tg_table_name = 'tourism_crm_links' then current_row->>'entity_id' else current_row->>'id' end)::uuid,
    auth.uid(),tg_op,before_row,after_row);
  return coalesce(new,old);
end $$;

create or replace function public.tourism_entity_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.kind = 'person' then raise exception 'Personal data ingestion requires dedicated lawful-basis workflow'; end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind then raise exception 'Immutable entity identity'; end if;
    new.version := old.version + 1;
    new.updated_at := now();
    if (new.name,new.country_code,new.type_code,new.website,new.email,new.phone,new.details,new.aliases,new.external_ids)
      is distinct from (old.name,old.country_code,old.type_code,old.website,old.email,old.phone,old.details,old.aliases,old.external_ids) then
      -- Every previous attestation now refers to the old version, never silently to new data.
      update public.tourism_evidence set status = 'UNVERIFIED', verified_at = null, verified_by = null where entity_id = old.id and user_id = old.user_id and status = 'VERIFIED';
      new.status := 'NEEDS_REVIEW';
    end if;
  end if;
  if new.status = 'VERIFIED' and not exists (
    select 1 from public.tourism_evidence e where e.user_id = new.user_id and e.entity_id = new.id
      and e.status = 'VERIFIED' and e.fields @> case when new.kind='organization' then array['name','country_code','type_code'] when new.kind='portal' then array['name','website'] else array['name'] end
  ) then raise exception 'Verified identity evidence required'; end if;
  return new;
end $$;
create trigger tourism_entity_guard before insert or update on public.tourism_entities for each row execute function public.tourism_entity_guard();

create or replace function public.tourism_evidence_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.entity_id,new.user_id,new.id) is distinct from (old.entity_id,old.user_id,old.id) then raise exception 'Immutable evidence identity'; end if;
  if new.status = 'VERIFIED' then
    new.verified_at := now(); new.verified_by := auth.uid();
  else new.verified_at := null; new.verified_by := null;
  end if;
  return new;
end $$;
create trigger tourism_evidence_guard before insert or update on public.tourism_evidence for each row execute function public.tourism_evidence_guard();

create or replace function public.tourism_evidence_invalidate() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status = 'VERIFIED' and pg_trigger_depth() = 1 then
    update public.tourism_entities set status = 'NEEDS_REVIEW' where id = old.entity_id and user_id = old.user_id and status = 'VERIFIED';
  end if;
  return coalesce(new,old);
end $$;
create trigger tourism_evidence_invalidate after update or delete on public.tourism_evidence for each row execute function public.tourism_evidence_invalidate();

create or replace function public.tourism_relation_guard() returns trigger
language plpgsql set search_path = public as $$
declare fk text; tk text; source_entity uuid;
begin
  if new.relation = 'PART_OF' then perform pg_advisory_xact_lock(hashtext(new.user_id::text||':tourism-geography')); end if;
  select kind into fk from public.tourism_entities where id = new.from_id and user_id = new.user_id;
  select kind into tk from public.tourism_entities where id = new.to_id and user_id = new.user_id;
  select entity_id into source_entity from public.tourism_evidence where id = new.evidence_id and user_id = new.user_id;
  if source_entity is distinct from new.from_id then raise exception 'Evidence must belong to source entity'; end if;
  if not exists(select 1 from public.tourism_evidence where id=new.evidence_id and fields && array['coverage','relationship']) then raise exception 'Relationship evidence required'; end if;
  if not (
    (new.relation = 'PART_OF' and fk = 'place' and tk = 'place') or
    (new.relation in ('COVERS','MANAGES','PROMOTES') and fk = 'organization' and tk = 'place') or
    (new.relation = 'OPERATES_BRAND' and fk = 'organization' and tk = 'brand') or
    (new.relation = 'OPERATES_PORTAL' and fk = 'organization' and tk = 'portal') or
    (new.relation in ('MEMBER_OF','PARTNER_OF') and fk = 'organization' and tk = 'organization') or
    (new.relation = 'WORKS_FOR' and fk = 'person' and tk = 'organization')
  ) then raise exception 'Invalid relationship types'; end if;
  if new.relation = 'PART_OF' and exists (
    with recursive ancestors(id) as (
      select new.to_id union select r.to_id from public.tourism_relations r join ancestors a on r.from_id = a.id
      where r.user_id = new.user_id and r.relation = 'PART_OF' and r.id <> new.id
    ) select 1 from ancestors where id = new.from_id
  ) then raise exception 'Geographic cycle'; end if;
  return new;
end $$;
create trigger tourism_relation_guard before insert or update on public.tourism_relations for each row execute function public.tourism_relation_guard();

create or replace function public.tourism_link_guard() returns trigger
language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.contacts where id=new.contact_id and user_id=new.user_id) then raise exception 'Cross-workspace CRM link denied'; end if;
  if not exists(select 1 from public.tourism_entities where id=new.entity_id and user_id=new.user_id and kind='organization' and status='VERIFIED') then raise exception 'Verified organization required'; end if;
  return new;
end $$;
create trigger tourism_link_guard before insert or update on public.tourism_crm_links for each row execute function public.tourism_link_guard();

do $$ declare t text; begin
  foreach t in array array['tourism_entities','tourism_evidence','tourism_relations','tourism_crm_links'] loop
    execute format('create trigger tourism_audit after insert or update or delete on public.%I for each row execute function public.tourism_audit()', t);
  end loop;
end $$;

-- Atomic, non-destructive import. Exact duplicates gain no overwrites or verification.
create or replace function public.tourism_import(p_records jsonb,p_relations jsonb default '[]') returns jsonb
language plpgsql set search_path = public as $$
declare r jsonb; edge jsonb; entity uuid; source_entity uuid; target_entity uuid; evidence uuid; created integer := 0; duplicates integer := 0; ids jsonb := '[]';
begin
  if auth.uid() is null then raise exception 'Unauthorized'; end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) not between 1 and 200 then raise exception 'Import requires 1-200 records'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    entity := null;
    insert into public.tourism_entities(user_id,kind,name,country_code,type_code,website,email,phone,aliases,details,external_ids,status)
    values (auth.uid(),r->>'kind',r->>'name',coalesce(r->>'country_code',''),r->>'type_code',r->>'website',r->>'email',r->>'phone',
      array(select jsonb_array_elements_text(coalesce(r->'aliases','[]'))),coalesce(r->'details','{}'),coalesce(r->'external_ids','{}'),'UNVERIFIED')
    on conflict (user_id,kind,country_code,name_key) do nothing returning id into entity;
    if entity is null then
      duplicates := duplicates + 1;
      select id into entity from public.tourism_entities where user_id = auth.uid() and kind = r->>'kind' and country_code = coalesce(r->>'country_code','') and name_key = public.tourism_name_key(r->>'name');
    else
      created := created + 1;
      insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method)
      values (auth.uid(),entity,r->'evidence'->>'source_url',r->'evidence'->>'title',coalesce(r->'evidence'->>'excerpt',''),
        array(select jsonb_array_elements_text(r->'evidence'->'fields')),coalesce(r->'evidence'->>'method','import'));
    end if;
    ids := ids || to_jsonb(entity);
  end loop;
  if jsonb_typeof(p_relations) <> 'array' or jsonb_array_length(p_relations)>500 then raise exception 'Invalid relationships'; end if;
  for edge in select value from jsonb_array_elements(p_relations) loop
    source_entity := (ids->>(edge->>'from_index')::integer)::uuid;
    target_entity := (ids->>(edge->>'to_index')::integer)::uuid;
    if source_entity is null or target_entity is null then raise exception 'Invalid relationship indices'; end if;
    select id into evidence from public.tourism_evidence where user_id=auth.uid() and entity_id=source_entity order by acquired_at desc limit 1;
    if evidence is null then raise exception 'Missing relationship evidence'; end if;
    insert into public.tourism_relations(user_id,from_id,to_id,relation,evidence_id)
      values(auth.uid(),source_entity,target_entity,edge->>'relation',evidence) on conflict (user_id,from_id,to_id,relation) do nothing;
  end loop;
  return jsonb_build_object('created',created,'duplicates',duplicates,'ids',ids);
end $$;

create or replace function public.tourism_review(p_entity_id uuid,p_evidence_id uuid,p_version integer,p_approve boolean) returns void
language plpgsql set search_path = public as $$
declare e public.tourism_entities;
begin
  select * into e from public.tourism_entities where id = p_entity_id and user_id = auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or e.version <> p_version then raise exception 'Version conflict'; end if;
  if p_approve is null then raise exception 'Review decision required'; end if;
  update public.tourism_evidence set status = case when p_approve then 'VERIFIED' else 'REJECTED' end
    where id = p_evidence_id and entity_id = e.id and user_id = auth.uid();
  if not found then raise exception 'Evidence not found'; end if;
  if p_approve and exists (select 1 from public.tourism_evidence where entity_id=e.id and status='VERIFIED' and fields @> case when e.kind='organization' then array['name','country_code','type_code'] when e.kind='portal' then array['name','website'] else array['name'] end) then
    update public.tourism_entities set status = 'VERIFIED' where id = e.id;
  else
    update public.tourism_entities set status = 'NEEDS_REVIEW' where id = e.id;
  end if;
end $$;

create or replace function public.tourism_promote(p_entity_id uuid) returns jsonb
language plpgsql set search_path = public as $$
declare e public.tourism_entities; cid uuid; matches integer; created boolean := false; verified_email text; verified_phone text;
begin
  select * into e from public.tourism_entities where id = p_entity_id and user_id = auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if e.kind <> 'organization' or e.status <> 'VERIFIED' then raise exception 'Only verified organizations can enter CRM'; end if;
  select contact_id into cid from public.tourism_crm_links where entity_id = e.id and user_id = auth.uid();
  if cid is not null then return jsonb_build_object('contact_id',cid,'created',false); end if;
  -- Serialize matching across distinct entities too (shared email is never an automatic merge).
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':tourism-crm'));
  if exists(select 1 from public.tourism_evidence where entity_id=e.id and status='VERIFIED' and 'email'=any(fields)) then verified_email:=e.email; end if;
  if exists(select 1 from public.tourism_evidence where entity_id=e.id and status='VERIFIED' and 'phone'=any(fields)) then verified_phone:=e.phone; end if;
  select count(*), min(id::text)::uuid into matches,cid from public.contacts
    where user_id = auth.uid() and public.tourism_name_key(coalesce(nullif(btrim(company),''),name)) = e.name_key
      and (country = e.country_code or country is null or country = '');
  if matches > 1 then raise exception 'Ambiguous CRM match: review existing contacts'; end if;
  if matches = 0 then
    if exists(select 1 from public.contacts where user_id=auth.uid() and public.tourism_name_key(coalesce(nullif(btrim(company),''),name))=e.name_key) then
      raise exception 'CRM country mismatch or unnormalized country: manual review required';
    end if;
    if e.email is not null and exists(select 1 from public.contacts where user_id=auth.uid() and lower(email)=lower(e.email)) then
      raise exception 'Email already used by another CRM identity: manual review required';
    end if;
    insert into public.contacts(user_id,name,company,country,email,phone,status,source,contact_scope,marketing_eligibility,legacy_id,note)
    values(auth.uid(),e.name,e.name,e.country_code,verified_email,verified_phone,'New','tourism-intelligence','crm','review','tourism:'||e.id,
      'Organizzazione qualificata manualmente. Provenienza e verifiche nel catalogo Tourism Intelligence. Nessuna iscrizione a campagne.') returning id into cid;
    created := true;
  end if;
  insert into public.tourism_crm_links(user_id,entity_id,contact_id) values(auth.uid(),e.id,cid);
  insert into public.activities(user_id,contact_id,type,content)
    values(auth.uid(),cid,'system','Collegamento approvato a Tourism Intelligence: '||e.name||' ['||e.id||'].');
  return jsonb_build_object('contact_id',cid,'created',created);
end $$;

-- Explicit two-way sync. CRM -> catalog always creates unverified evidence.
create or replace function public.tourism_sync(p_entity_id uuid,p_direction text,p_version integer) returns void
language plpgsql set search_path = public as $$
declare e public.tourism_entities; c public.contacts;
begin
  select * into e from public.tourism_entities where id=p_entity_id and user_id=auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or e.version <> p_version then raise exception 'Version conflict'; end if;
  select ct.* into c from public.contacts ct join public.tourism_crm_links l on l.contact_id=ct.id
    where l.entity_id=e.id and l.user_id=auth.uid() and ct.user_id=auth.uid() for update of ct;
  if not found then raise exception 'CRM link not found'; end if;
  if p_direction='to_crm' then
    if e.status <> 'VERIFIED' then raise exception 'Verified organization required'; end if;
    if not exists(select 1 from public.tourism_evidence where entity_id=e.id and status='VERIFIED' and fields @> array['email','phone']) then raise exception 'Verified contact evidence required'; end if;
    update public.contacts set email=e.email,phone=e.phone where id=c.id;
  elsif p_direction='from_crm' then
    update public.tourism_entities set email=c.email,phone=c.phone,status='NEEDS_REVIEW' where id=e.id;
    insert into public.tourism_evidence(user_id,entity_id,source_url,title,fields,method)
      values(auth.uid(),e.id,'https://crm.speaqi.com/contacts/'||c.id,'Recapiti importati dal CRM',array['email','phone'],'crm');
  else raise exception 'Invalid sync direction'; end if;
  insert into public.activities(user_id,contact_id,type,content) values(auth.uid(),c.id,'system','Sincronizzazione Tourism Intelligence approvata: '||p_direction);
end $$;

create or replace function public.tourism_claim_job(p_job_id uuid) returns public.tourism_jobs
language plpgsql set search_path=public as $$
declare j public.tourism_jobs;
begin
  -- Owner-wide lock keeps a single running web-search job and bounds provider cost.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-discovery'));
  if exists(select 1 from public.tourism_jobs where user_id=auth.uid() and state='running' and lease_until>now()) then raise exception 'Discovery already running'; end if;
  update public.tourism_jobs set state='running',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),error=null,finished_at=null
    where id=p_job_id and user_id=auth.uid() and attempts<3 and (state in ('queued','failed') or (state='running' and lease_until<now())) returning * into j;
  if not found then raise exception 'Job unavailable or retry limit reached'; end if;
  return j;
end $$;

create or replace function public.tourism_save_indicator(p_entity_id uuid,p_version integer,p_factor text,p_value integer,p_source_url text,p_rationale text) returns void
language plpgsql set search_path=public as $$
declare e public.tourism_entities;
begin
  if p_factor is null or p_value is null or p_source_url is null or p_rationale is null or p_factor not in ('tourism_relevance','destination_scale','organization_size','digital_need','map_need','multilingual_need','ai_need','investment_capacity','contact_access','product_fit') or p_value not between 0 and 100 or p_source_url !~ '^https?://[^[:space:]]+$' or length(btrim(p_rationale)) not between 2 and 500 then raise exception 'Invalid indicator'; end if;
  select * into e from public.tourism_entities where id=p_entity_id and user_id=auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or e.version<>p_version then raise exception 'Version conflict'; end if;
  update public.tourism_entities set details=jsonb_set(details,'{indicators}',coalesce(details->'indicators','{}')||jsonb_build_object(p_factor,jsonb_build_object('value',p_value,'source_url',p_source_url,'rationale',p_rationale))) where id=e.id;
  insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields)
    values(auth.uid(),e.id,p_source_url,'Valutazione commerciale: '||p_factor,p_rationale,array['indicator:'||p_factor]);
end $$;
revoke all on function public.tourism_save_indicator(uuid,integer,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.tourism_save_indicator(uuid,integer,text,integer,text,text) to authenticated;

-- Trigger functions are not callable RPCs. Public grants are narrowed explicitly.
revoke all on function public.tourism_audit(),public.tourism_entity_guard(),public.tourism_evidence_guard(),public.tourism_evidence_invalidate(),public.tourism_relation_guard(),public.tourism_link_guard() from public,anon,authenticated;
revoke all on function public.tourism_name_key(text),public.tourism_search_document(text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.tourism_name_key(text),public.tourism_search_document(text,text,text[],jsonb) to authenticated;
revoke all on function public.tourism_import(jsonb,jsonb),public.tourism_review(uuid,uuid,integer,boolean),public.tourism_promote(uuid),public.tourism_sync(uuid,text,integer),public.tourism_claim_job(uuid) from public,anon,authenticated;
grant execute on function public.tourism_import(jsonb,jsonb),public.tourism_review(uuid,uuid,integer,boolean),public.tourism_promote(uuid),public.tourism_sync(uuid,text,integer),public.tourism_claim_job(uuid) to authenticated;
-- Supabase installations can grant table privileges through ALTER DEFAULT PRIVILEGES.
-- Remove inherited mutation/TRUNCATE rights before assigning this module's explicit ACL.
revoke all on public.tourism_taxonomy,public.tourism_revisions,public.tourism_entities,public.tourism_evidence,public.tourism_relations,public.tourism_crm_links,public.tourism_jobs from anon,authenticated;
revoke all on sequence public.tourism_revisions_id_seq from anon,authenticated;
grant select on public.tourism_taxonomy,public.tourism_revisions to authenticated;
grant select,insert,update,delete on public.tourism_entities,public.tourism_evidence,public.tourism_relations,public.tourism_crm_links,public.tourism_jobs to authenticated;

create or replace function public.tourism_overview() returns jsonb
language sql stable set search_path=public as $$
  select jsonb_build_object(
    'organizations',count(*) filter(where kind='organization'),
    'countries',count(distinct country_code) filter(where kind='organization'),
    'places',count(*) filter(where kind='place'),
    'verified',count(*) filter(where kind='organization' and status='VERIFIED'),
    'review',count(*) filter(where kind='organization' and status in ('UNVERIFIED','NEEDS_REVIEW','DISCOVERED')),
    'new_week',count(*) filter(where kind='organization' and created_at>now()-interval '7 days'),
    'contacts',count(*) filter(where kind='organization' and (email is not null or phone is not null)),
    'crm',(select count(*) from public.tourism_crm_links where user_id=auth.uid()),
    'by_country',coalesce((select jsonb_agg(c) from (select country_code,count(*) as total,count(*) filter(where status='VERIFIED') as verified from public.tourism_entities where user_id=auth.uid() and kind='organization' group by country_code order by count(*) desc) c),'[]'::jsonb)
  ) from public.tourism_entities where user_id=auth.uid();
$$;
revoke all on function public.tourism_overview() from public,anon,authenticated;
grant execute on function public.tourism_overview() to authenticated;
