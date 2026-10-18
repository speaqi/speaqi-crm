-- Acquisition receipts and CRM identity suggestions are separate from verified links.
create table public.tourism_acquisitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  run_key text not null check (length(run_key) between 2 and 150),
  state text not null check (state in ('running','completed','partial','failed')),
  sources jsonb not null default '[]' check (jsonb_typeof(sources)='array'),
  stats jsonb not null default '{}' check (jsonb_typeof(stats)='object'),
  errors jsonb not null default '[]' check (jsonb_typeof(errors)='array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id,run_key)
);
create index tourism_acquisitions_owner_idx on public.tourism_acquisitions(user_id,started_at desc);

create table public.tourism_crm_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entity_id uuid not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  rule text not null check (rule in ('name_country','name','website_domain','email_domain')),
  score integer not null check (score between 0 and 100),
  state text not null default 'candidate' check (state in ('candidate','confirmed','rejected')),
  matched_at timestamptz not null default now(),
  foreign key(user_id,entity_id) references public.tourism_entities(user_id,id) on delete cascade,
  unique(user_id,entity_id,contact_id)
);
create index tourism_crm_matches_entity_idx on public.tourism_crm_matches(user_id,entity_id,state,score desc);

alter table public.tourism_acquisitions enable row level security;
alter table public.tourism_crm_matches enable row level security;
create policy tourism_owner on public.tourism_acquisitions for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy tourism_owner on public.tourism_crm_matches for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on public.tourism_acquisitions,public.tourism_crm_matches from anon,authenticated;
grant select,insert,update,delete on public.tourism_acquisitions,public.tourism_crm_matches to authenticated;

create or replace function public.tourism_match_guard() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (new.id,new.user_id,new.entity_id,new.contact_id) is distinct from (old.id,old.user_id,old.entity_id,old.contact_id) then
    raise exception 'Immutable match identity';
  end if;
  if not exists(select 1 from public.contacts where id=new.contact_id and user_id=new.user_id) then
    raise exception 'Cross-workspace CRM match denied';
  end if;
  if not exists(select 1 from public.tourism_entities where id=new.entity_id and user_id=new.user_id and kind='organization') then
    raise exception 'Organization required for CRM matching';
  end if;
  return new;
end $$;
revoke all on function public.tourism_match_guard() from public,anon,authenticated;
create trigger tourism_match_guard before insert or update on public.tourism_crm_matches for each row execute function public.tourism_match_guard();
create trigger tourism_audit after insert or update or delete on public.tourism_crm_matches for each row execute function public.tourism_audit();
create trigger tourism_audit after insert or update or delete on public.tourism_acquisitions for each row execute function public.tourism_audit();

create or replace function public.tourism_link_existing(p_entity_id uuid,p_contact_id uuid,p_version integer) returns jsonb
language plpgsql set search_path=public as $$
declare e public.tourism_entities; existing_contact uuid;
begin
  select * into e from public.tourism_entities where id=p_entity_id and user_id=auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or p_version<>e.version then raise exception 'Version conflict'; end if;
  if e.kind<>'organization' or e.status<>'VERIFIED' then raise exception 'Verified organization required'; end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-crm'));
  select contact_id into existing_contact from public.tourism_crm_links where user_id=auth.uid() and entity_id=e.id;
  if existing_contact is not null then
    if existing_contact<>p_contact_id then raise exception 'Organization already linked to another CRM contact'; end if;
    return jsonb_build_object('contact_id',existing_contact,'created',false);
  end if;
  if not exists(select 1 from public.contacts where id=p_contact_id and user_id=auth.uid()) then raise exception 'CRM contact not found'; end if;
  if not exists(select 1 from public.tourism_crm_matches where user_id=auth.uid() and entity_id=e.id and contact_id=p_contact_id and state='candidate') then raise exception 'CRM candidate not found'; end if;
  insert into public.tourism_crm_links(user_id,entity_id,contact_id) values(auth.uid(),e.id,p_contact_id);
  update public.tourism_crm_matches set state='confirmed' where user_id=auth.uid() and entity_id=e.id and contact_id=p_contact_id;
  insert into public.activities(user_id,contact_id,type,content) values(auth.uid(),p_contact_id,'system','Corrispondenza CRM Tourism Intelligence confermata: '||e.name||'. Nessun recapito sovrascritto.');
  return jsonb_build_object('contact_id',p_contact_id,'created',false);
end $$;
revoke all on function public.tourism_link_existing(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.tourism_link_existing(uuid,uuid,integer) to authenticated;

create or replace function public.tourism_catalog_coverage() returns jsonb
language sql stable set search_path=public as $$
  with countries as (
    select country_code,min(name) as name from public.tourism_entities
    where user_id=auth.uid() and kind='place' and details->>'place_level'='country'
    group by country_code
  ), organizations as (
    select country_code,count(*) as total,count(*) filter(where status='VERIFIED') as verified
    from public.tourism_entities where user_id=auth.uid() and kind='organization' and status not in ('INACTIVE','DUPLICATE') group by country_code
  ), coverage as (
    select coalesce(c.country_code,o.country_code) as country_code,c.name,coalesce(o.total,0) as total,coalesce(o.verified,0) as verified
    from countries c full join organizations o using(country_code)
  )
  select jsonb_build_object(
    'reference_countries',(select count(*) from countries),
    'countries_with_organizations',(select count(*) from organizations),
    'countries_without_organizations',(select count(*) from coverage where total=0),
    'matched_organizations',(select count(distinct entity_id) from public.tourism_crm_matches where user_id=auth.uid() and state='candidate'),
    'by_country',coalesce((select jsonb_agg(c order by total desc,country_code) from coverage c),'[]'::jsonb),
    'runs',coalesce((select jsonb_agg(r) from (select id,run_key,state,sources,stats,started_at,completed_at from public.tourism_acquisitions where user_id=auth.uid() order by started_at desc limit 10) r),'[]'::jsonb)
  );
$$;
revoke all on function public.tourism_catalog_coverage() from public,anon,authenticated;
grant execute on function public.tourism_catalog_coverage() to authenticated;

-- Existing promotion also respects unresolved identity suggestions.
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
  if matches = 0 and exists(select 1 from public.tourism_crm_matches where user_id=auth.uid() and entity_id=e.id and state='candidate') then
    raise exception 'Possible CRM matches require review before creating a contact';
  end if;
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

