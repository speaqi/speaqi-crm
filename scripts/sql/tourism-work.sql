-- Schema additivo, da versionare con `supabase migration new tourism_work`
-- quando la CLI è disponibile. Eseguire una sola volta, dopo tourism_site_research.
begin;
create schema if not exists tourism_private;
revoke all on schema tourism_private from public, anon;
grant usage on schema tourism_private to authenticated;

create table public.tourism_work_members (
  member_id uuid primary key references public.team_members(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  access_kind text not null default 'external' check(access_kind in ('internal','external')),
  enabled boolean not null default true
);
create table public.tourism_work_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  kind text not null check(kind in ('partner','territory','segment','opportunity','task')),
  title text not null check(length(btrim(title)) between 2 and 200),
  parent_id uuid, entity_id uuid, source_opportunity_id uuid,
  source_key text, responsible_id uuid references public.team_members(id), collaborator_ids uuid[] not null default '{}',
  stage text not null default 'qualify' check(stage in ('qualify','contact','contacted','proposal','agreement','waiting','archived')),
  next_action text not null check(length(btrim(next_action)) between 2 and 1000),
  due_on date, reason text not null default '' check(length(reason)<=1000),
  country_code text not null default '' check(country_code='' or country_code ~ '^[A-Z]{2}$'),
  segment text not null default '' check(length(segment)<=100),
  shared_context text not null default '' check(length(shared_context)<=10000),
  checklist jsonb not null default '[]' check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=20),
  website text not null default '' check(website='' or website ~ '^https?://[^[:space:]]+$'),
  version integer not null default 1, acknowledged_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,id), unique(user_id,source_key),
  foreign key(user_id,parent_id) references public.tourism_work_items(user_id,id),
  foreign key(user_id,entity_id) references public.tourism_entities(user_id,id),
  foreign key(user_id,source_opportunity_id) references public.tourism_project_opportunities(user_id,id),
  check(stage not in ('waiting','archived') or length(btrim(reason))>=2),
  check(stage in ('agreement','archived') or due_on is not null),
  check(cardinality(collaborator_ids)<=20)
);
create index tourism_work_owner_due on public.tourism_work_items(user_id,due_on,id);
create index tourism_work_responsible on public.tourism_work_items(responsible_id);
create index tourism_work_collaborators on public.tourism_work_items using gin(collaborator_ids);
create index tourism_work_parent on public.tourism_work_items(user_id,parent_id);
create table public.tourism_work_notes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), item_id uuid not null,
  actor_id uuid not null default auth.uid(), body text not null check(length(btrim(body)) between 2 and 10000),
  visibility text not null default 'internal' check(visibility in ('internal','shared')),
  document_url text not null default '' check(document_url='' or document_url ~ '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  foreign key(user_id,item_id) references public.tourism_work_items(user_id,id)
);
create index tourism_work_notes_item on public.tourism_work_notes(user_id,item_id,created_at);
create table public.tourism_work_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), item_id uuid not null,
  actor_id uuid not null, event text not null, changes jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(user_id,item_id) references public.tourism_work_items(user_id,id)
);
create index tourism_work_events_item on public.tourism_work_events(user_id,item_id,created_at);
create table public.tourism_work_rules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null check(length(btrim(name)) between 2 and 200),
  country_code text not null default '' check(country_code='' or country_code ~ '^[A-Z]{2}$'),
  segment text not null default '' check(length(segment)<=100),
  member_ids uuid[] not null check(cardinality(member_ids) between 1 and 20), enabled boolean not null default true
);

-- Only this lookup needs elevated rights: team/profile RLS must not recurse.
-- Identity comes from auth.users and auth_user_id, never user-editable metadata.
create function tourism_private.work_member(p_owner uuid) returns uuid
language sql stable security definer set search_path='' as $$
  select t.id from public.team_members t
  join public.tourism_work_members p on p.member_id=t.id and p.user_id=t.user_id
  where auth.uid() is not null and t.user_id=p_owner and p.enabled
    and 'tourism'=any(coalesce(t.allowed_areas,'{}'::text[]))
    and (t.auth_user_id=auth.uid() or (t.auth_user_id is null and nullif(btrim(t.email),'') is not null
      and lower(btrim(t.email))=(select lower(btrim(u.email)) from auth.users u where u.id=auth.uid())))
  order by t.id limit 1;
$$;
create function tourism_private.work_internal(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid()=p_owner or exists(select 1 from public.tourism_work_members
    where member_id=tourism_private.work_member(p_owner) and access_kind='internal');
$$;
revoke all on function tourism_private.work_member(uuid), tourism_private.work_internal(uuid) from public,anon;
grant execute on function tourism_private.work_member(uuid), tourism_private.work_internal(uuid) to authenticated;

alter table public.tourism_work_members enable row level security;
create policy owner on public.tourism_work_members for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
alter table public.tourism_work_items enable row level security;
create policy work_read on public.tourism_work_items for select to authenticated using (
  user_id=auth.uid() or tourism_private.work_member(user_id)=responsible_id or tourism_private.work_member(user_id)=any(collaborator_ids));
create policy work_insert on public.tourism_work_items for insert to authenticated with check(user_id=auth.uid());
create policy work_update on public.tourism_work_items for update to authenticated using (
  user_id=auth.uid() or tourism_private.work_member(user_id)=responsible_id or tourism_private.work_member(user_id)=any(collaborator_ids))
with check(user_id=auth.uid() or tourism_private.work_member(user_id)=responsible_id or tourism_private.work_member(user_id)=any(collaborator_ids));
alter table public.tourism_work_notes enable row level security;
create policy note_read on public.tourism_work_notes for select to authenticated using (
  exists(select 1 from public.tourism_work_items i where i.id=item_id and i.user_id=tourism_work_notes.user_id)
  and (visibility='shared' or tourism_private.work_internal(user_id)));
create policy note_insert on public.tourism_work_notes for insert to authenticated with check (
  actor_id=auth.uid() and exists(select 1 from public.tourism_work_items i where i.id=item_id and i.user_id=tourism_work_notes.user_id)
  and (visibility='shared' or tourism_private.work_internal(user_id)));
alter table public.tourism_work_events enable row level security;
create policy event_read on public.tourism_work_events for select to authenticated using (
  exists(select 1 from public.tourism_work_items i where i.id=item_id and i.user_id=tourism_work_events.user_id));
alter table public.tourism_work_rules enable row level security;
create policy owner on public.tourism_work_rules for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create function tourism_private.work_profile_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.team_members where id=new.member_id and user_id=new.user_id) then
    raise exception 'Collaboratore di un altro workspace'; end if;
  update public.team_members set allowed_areas=case when new.enabled then
    array(select distinct x from unnest(coalesce(allowed_areas,array['oggi','pipeline','contatti','followup'])||array['tourism']) x)
    else array_remove(allowed_areas,'tourism') end where id=new.member_id and user_id=new.user_id;
  return new;
end; $$;
create trigger work_profile_guard before insert or update on public.tourism_work_members for each row execute function tourism_private.work_profile_guard();

create function tourism_private.work_guard() returns trigger language plpgsql set search_path='' as $$
declare m uuid; p public.tourism_work_items; begin
  if tg_op='UPDATE' then
    if new.user_id<>old.user_id or new.id<>old.id or new.created_at<>old.created_at then raise exception 'Identità immutabile'; end if;
    if new.version<>old.version then raise exception 'Versione gestita dal server'; end if;
    if auth.uid()<>old.user_id and
      (to_jsonb(new)-array['stage','next_action','due_on','reason','acknowledged_at','checklist'] is distinct from
       to_jsonb(old)-array['stage','next_action','due_on','reason','acknowledged_at','checklist']) then
       raise exception 'Solo il proprietario può riassegnare o modificare il contesto'; end if;
    new.version:=old.version+1; new.updated_at:=now();
  else
    new.version:=1; new.created_at:=now(); new.updated_at:=now();
  end if;
  if jsonb_typeof(new.checklist) is distinct from 'array' then raise exception 'Checklist non valida'; end if;
  if exists(select 1 from jsonb_array_elements(new.checklist) c where
    jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'done') is distinct from 'boolean'
    or jsonb_typeof(c->'label') is distinct from 'string' or length(btrim(c->>'label')) not between 2 and 200) then raise exception 'Checklist non valida'; end if;
  if new.parent_id is not null and (tg_op='INSERT' or new.parent_id is distinct from old.parent_id) then
    select * into p from public.tourism_work_items where user_id=new.user_id and id=new.parent_id for key share;
    if not found or p.parent_id is not null or p.id=new.id then raise exception 'Portafoglio non valido: un solo livello'; end if;
    if exists(select 1 from public.tourism_work_items where user_id=new.user_id and parent_id=new.id) then raise exception 'Un portafoglio con figli non può diventare figlio'; end if;
    new.responsible_id:=p.responsible_id; new.collaborator_ids:=p.collaborator_ids;
  end if;
  if auth.uid()=new.user_id and new.source_opportunity_id is not null and not exists(select 1 from public.tourism_project_opportunities where id=new.source_opportunity_id and user_id=new.user_id) then
    raise exception 'Segnale non valido'; end if;
  foreach m in array (coalesce(array[new.responsible_id]::uuid[],'{}')||new.collaborator_ids) loop
    if m is not null and not exists(select 1 from public.team_members t where t.id=m and t.user_id=new.user_id) then
      -- Workers cannot see other team rows, but their unchanged assignments were already validated by the owner.
      if auth.uid()=new.user_id or tg_op='INSERT' then raise exception 'Collaboratore di un altro workspace'; end if;
    end if;
  end loop;
  if tg_op='UPDATE' and (new.responsible_id is distinct from old.responsible_id or new.collaborator_ids is distinct from old.collaborator_ids) then new.acknowledged_at:=null; end if;
  return new;
end; $$;
create trigger work_guard before insert or update on public.tourism_work_items for each row execute function tourism_private.work_guard();

create function tourism_private.work_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare changed jsonb; begin
  if auth.uid() is null then raise exception 'Accesso richiesto'; end if;
  if tg_op='INSERT' then changed:=jsonb_build_object('title',new.title,'responsible_id',new.responsible_id,'stage',new.stage);
  else select coalesce(jsonb_object_agg(k,v),'{}') into changed from jsonb_each(to_jsonb(new)) as x(k,v)
    where k not in ('version','updated_at') and v is distinct from to_jsonb(old)->k; end if;
  insert into public.tourism_work_events(user_id,item_id,actor_id,event,changes)
    values(new.user_id,new.id,auth.uid(),case when tg_op='INSERT' then 'Creazione' else 'Aggiornamento' end,changed);
  return new;
end; $$;
create trigger work_audit after insert or update on public.tourism_work_items for each row execute function tourism_private.work_audit();

create function tourism_private.work_note_stamp() returns trigger language plpgsql set search_path='' as $$
begin
  new.actor_id:=auth.uid(); new.created_at:=now();
  -- A recorded conversation resets the inactivity alert, with optimistic versioning.
  update public.tourism_work_items set next_action=next_action where id=new.item_id and user_id=new.user_id;
  return new;
end; $$;
create trigger work_note_stamp before insert on public.tourism_work_notes for each row execute function tourism_private.work_note_stamp();

create function tourism_private.work_rule_guard() returns trigger language plpgsql set search_path='' as $$
declare m uuid; begin
  foreach m in array new.member_ids loop
    if m is null or not exists(select 1 from public.team_members where id=m and user_id=new.user_id) then raise exception 'Collaboratore di un altro workspace'; end if;
  end loop;
  return new;
end; $$;
create trigger work_rule_guard before insert or update on public.tourism_work_rules for each row execute function tourism_private.work_rule_guard();

-- Ownership is checked by RLS on every row. A portfolio handoff is atomic.
create function public.tourism_work_handoff(p_id uuid,p_version integer,p_member uuid,p_collaborators uuid[]) returns void
language plpgsql security invoker set search_path='' as $$
declare item public.tourism_work_items; begin
  select * into item from public.tourism_work_items where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Scheda non trovata'; end if;
  if item.version<>p_version then raise exception 'Version conflict'; end if;
  update public.tourism_work_items set responsible_id=p_member,collaborator_ids=p_collaborators where id=p_id;
  update public.tourism_work_items set responsible_id=p_member,collaborator_ids=p_collaborators where parent_id=p_id and user_id=auth.uid();
end; $$;

create function public.tourism_work_identity(p_owner uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('member_id',tourism_private.work_member(p_owner), 'access_kind',case
    when auth.uid()=p_owner then 'owner' when tourism_private.work_internal(p_owner) then 'internal' else 'external' end);
$$;

create function public.tourism_work_summary(p_owner uuid,p_mine boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
  with visible as (
    select * from public.tourism_work_items where user_id=p_owner and
      (not p_mine or (auth.uid()=p_owner and responsible_id is null) or responsible_id=tourism_private.work_member(p_owner)
      or tourism_private.work_member(p_owner)=any(collaborator_ids))
  ), active as (select * from visible where stage not in ('agreement','archived'))
  select jsonb_build_object('open',count(*),'today',count(*) filter(where due_on=(now() at time zone 'UTC')::date),
    'overdue',count(*) filter(where due_on<(now() at time zone 'UTC')::date),
    'fresh',count(*) filter(where acknowledged_at is null),
    'stale',count(*) filter(where updated_at<((date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '14 days')),
    'loads',(select coalesce(jsonb_agg(x),'[]') from (select responsible_id as member_id,count(*) as open,
      count(*) filter(where due_on<(now() at time zone 'UTC')::date) as overdue from active group by responsible_id) x)) from active;
$$;
revoke all on function public.tourism_work_summary(uuid,boolean) from public,anon;
grant execute on function public.tourism_work_summary(uuid,boolean) to authenticated;

-- A saved territory/segment rule routes to the least loaded enabled member.
-- The explicit batch is transactional and idempotent; it never contacts a lead.
create function public.tourism_work_assign_entities(p_ids uuid[],p_member uuid,p_rule uuid,p_parent uuid,p_next_action text,p_due_on date) returns integer
language plpgsql security invoker set search_path='' as $$
declare e public.tourism_entities; r public.tourism_work_rules; picked uuid; added integer:=0; affected integer; begin
  if auth.uid() is null or cardinality(p_ids) not between 1 and 100 then raise exception 'Selezionare da 1 a 100 schede'; end if;
  if p_rule is not null then
    select * into r from public.tourism_work_rules where id=p_rule and user_id=auth.uid() and enabled for update;
    if not found then raise exception 'Regola non disponibile'; end if;
  end if;
  foreach picked in array p_ids loop
    select * into e from public.tourism_entities where id=picked and user_id=auth.uid();
    if not found then raise exception 'Entità non trovata'; end if;
    if p_rule is not null then
      if (r.country_code<>'' and r.country_code<>e.country_code) or (r.segment<>'' and r.segment<>coalesce(e.type_code,'')) then continue; end if;
      select t.id into picked from public.team_members t join public.tourism_work_members m on m.member_id=t.id and m.user_id=t.user_id and m.enabled
        where t.user_id=auth.uid() and t.id=any(r.member_ids) and 'tourism'=any(coalesce(t.allowed_areas,'{}'::text[]))
        order by (select count(*) from public.tourism_work_items w where w.user_id=auth.uid() and w.responsible_id=t.id and w.stage not in ('agreement','archived')),t.id limit 1;
      if picked is null then raise exception 'La regola non ha collaboratori abilitati'; end if;
    else picked:=p_member; end if;
    insert into public.tourism_work_items(user_id,kind,title,entity_id,source_key,responsible_id,parent_id,country_code,segment,website,next_action,due_on)
      values(auth.uid(),case when e.kind='place' then 'territory' else 'partner' end,e.name,e.id,'entity:'||e.id,picked,p_parent,e.country_code,coalesce(e.type_code,''),coalesce(e.website,''),p_next_action,p_due_on)
      on conflict(user_id,source_key) do nothing;
    get diagnostics affected=row_count; added:=added+affected;
  end loop;
  return added;
end; $$;
revoke all on function public.tourism_work_assign_entities(uuid[],uuid,uuid,uuid,text,date) from public,anon;
grant execute on function public.tourism_work_assign_entities(uuid[],uuid,uuid,uuid,text,date) to authenticated;

revoke all on public.tourism_work_members,public.tourism_work_items,public.tourism_work_notes,public.tourism_work_events,public.tourism_work_rules from public,anon,authenticated;
grant select,insert,update on public.tourism_work_members,public.tourism_work_items,public.tourism_work_rules to authenticated;
grant select,insert on public.tourism_work_notes to authenticated;
grant select on public.tourism_work_events to authenticated;
revoke all on function public.tourism_work_handoff(uuid,integer,uuid,uuid[]),public.tourism_work_identity(uuid) from public,anon;
grant execute on function public.tourism_work_handoff(uuid,integer,uuid,uuid[]),public.tourism_work_identity(uuid) to authenticated;
revoke all on function tourism_private.work_guard(),tourism_private.work_profile_guard(),tourism_private.work_audit(),tourism_private.work_note_stamp(),tourism_private.work_rule_guard() from public,anon,authenticated;
commit;
