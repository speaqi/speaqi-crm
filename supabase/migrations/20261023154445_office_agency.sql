-- Agenzia: riuso delle opportunità/presentazioni Agency e della RPC delle bozze.
alter table public.office_agents drop constraint office_agents_department_check;
alter table public.office_agents add constraint office_agents_department_check
  check (department in ('direzione','mappe','ricerca','commerciale','finanza','marketing','operazioni','agenzia','sviluppo'));

-- Gli UUID sono riservati prima delle creazioni: restano riutilizzabili dopo un crash.
-- Non sono FK: la prenotazione precede la riga Agency; l'RPC verifica gli id già esistenti.
create table public.office_agency_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id text not null default 'agency' check (agent_id='agency'),
  item_key text not null check (item_key ~ '^(contact|project):[0-9a-f-]{36}$'),
  project_id uuid not null default gen_random_uuid(),
  presentation_id uuid not null default gen_random_uuid(),
  generation_state text not null default 'pending' check (generation_state in ('pending','running','done','uncertain')),
  generation_run_id uuid references public.office_agent_runs(id) on delete set null,
  step_keys jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(user_id,item_key),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade
);
create index office_agency_items_project on public.office_agency_items(user_id,project_id);
alter table public.office_agency_items enable row level security;
create policy office_agency_items_owner on public.office_agency_items for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.office_agency_items from anon,authenticated;
grant select on public.office_agency_items to authenticated;
grant all on public.office_agency_items to service_role;

-- Il registro sopravvive alla cancellazione/invio di una bozza.
create table public.office_agency_deliveries (
  user_id uuid not null,
  agent_id text not null default 'agency' check (agent_id='agency'),
  delivery_key text not null,
  draft_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(user_id,delivery_key),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade
);
alter table public.office_agency_deliveries enable row level security;
create policy office_agency_deliveries_owner on public.office_agency_deliveries for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.office_agency_deliveries from anon,authenticated;
grant select on public.office_agency_deliveries to authenticated;
grant all on public.office_agency_deliveries to service_role;

create function public.claim_office_agency_item(p_run_id uuid,p_key text,p_project_id uuid default null)
returns public.office_agency_items language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; item public.office_agency_items; key_id uuid;
begin
  perform 1 from public.office_agents where id='agency' for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='agency' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa Agenzia non attiva'; end if;
  if p_key is null or p_key !~ '^(contact|project):[0-9a-f-]{36}$' then raise exception 'Elemento Agenzia non valido'; end if;
  key_id:=split_part(p_key,':',2)::uuid;
  if p_key like 'contact:%' and not exists(select 1 from public.contacts where id=key_id and user_id=r.user_id) then raise exception 'Contatto di un altro workspace o assente'; end if;
  if p_key like 'project:%' and p_project_id is distinct from key_id then raise exception 'Opportunità non corrispondente'; end if;
  if p_project_id is not null and not exists(select 1 from public.agency_projects where id=p_project_id and user_id=r.user_id) then raise exception 'Opportunità di un altro workspace o assente'; end if;
  if p_key like 'contact:%' and p_project_id is not null and not exists(select 1 from public.agency_projects where id=p_project_id and contact_id=key_id and user_id=r.user_id) then raise exception 'Cliente non corrispondente'; end if;
  insert into public.office_agency_items(user_id,item_key,project_id,step_keys)
    values(r.user_id,p_key,coalesce(p_project_id,gen_random_uuid()),jsonb_build_object('project',p_run_id::text||':'||p_key||':project','presentation',p_run_id::text||':'||p_key||':presentation'))
    on conflict(user_id,item_key) do nothing;
  select * into item from public.office_agency_items where user_id=r.user_id and item_key=p_key;
  return item;
end $$;

create function public.claim_office_agency_generation(p_run_id uuid,p_item_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs;
begin
  perform 1 from public.office_agents where id='agency' for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='agency' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa Agenzia non attiva'; end if;
  update public.office_agency_items set generation_state='running',generation_run_id=p_run_id,
    step_keys=step_keys||jsonb_build_object('generation',p_run_id::text||':'||item_key||':generation')
    where id=p_item_id and user_id=r.user_id and generation_state='pending';
  return found;
end $$;

create function public.finish_office_agency_generation(p_run_id uuid,p_item_id uuid,p_state text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs;
begin
  perform 1 from public.office_agents where id='agency' for update;
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='agency' and status='running' and started_at>now()-interval '30 minutes';
  if not found or p_state not in ('pending','done','uncertain') or p_state is null then raise exception 'Esito Agenzia non valido o corsa scaduta'; end if;
  update public.office_agency_items set generation_state=p_state
    where id=p_item_id and user_id=r.user_id and (generation_run_id=p_run_id or (generation_run_id is null and p_state='done'));
  if not found then raise exception 'Elemento di un’altra corsa o workspace'; end if;
end $$;
revoke all on function public.claim_office_agency_item(uuid,text,uuid),public.claim_office_agency_generation(uuid,uuid),public.finish_office_agency_generation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_office_agency_item(uuid,text,uuid),public.claim_office_agency_generation(uuid,uuid),public.finish_office_agency_generation(uuid,uuid,text) to service_role;

-- Estensione della RPC esistente: stessi lock, bozze e guardie; mai un invio.
create or replace function public.create_office_email_draft(p_run_id uuid, p_contact_id uuid,
  p_key text, p_subject text, p_text text, p_html text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.office_agent_runs; draft_id uuid; recipient text;
  agency_quote public.quotes; agency_presentation public.agency_presentations; agency_followup boolean:=false;
begin
  perform 1 from public.office_agents where id = (select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id;
  if not found or r.status <> 'running' or r.started_at <= now()-interval '30 minutes' then
    raise exception 'Corsa non attiva';
  end if;
  if r.agent_id='agency' then
    if p_key ~ '^agency:proposal:[0-9a-f-]{36}$' then
      select ap.* into agency_presentation from public.agency_presentations ap
        join public.agency_projects project on project.id=ap.project_id and project.user_id=r.user_id
        where ap.id=split_part(p_key,':',3)::uuid and ap.user_id=r.user_id and project.contact_id=p_contact_id
        and ap.status='approved' and ap.approved_at is not null for share of ap,project;
      if not found then return jsonb_build_object('id',null,'created',false,'reason','not_approved'); end if;
      select * into agency_quote from public.quotes where id=agency_presentation.quote_id and user_id=r.user_id
        and agency_project_id=agency_presentation.project_id and contact_id=p_contact_id and status in ('sent','accepted') for share;
      if not found then return jsonb_build_object('id',null,'created',false,'reason','quote_not_sent'); end if;
      if position('/proposta/'||agency_presentation.public_token in p_text)=0 then raise exception 'Link proposta Agenzia non valido'; end if;
    elsif p_key ~ '^agency:followup:[0-9a-f-]{36}$' then
      agency_followup:=true;
      select q.* into agency_quote from public.quotes q join public.agency_projects project
        on project.id=q.agency_project_id and project.user_id=r.user_id and project.contact_id=p_contact_id
        where q.id=split_part(p_key,':',3)::uuid and q.user_id=r.user_id and q.contact_id=p_contact_id
        and q.status='sent' and q.sent_at<now()-interval '7 days'
        and q.payment_state is distinct from 'paid'
        and not exists(select 1 from public.quote_signatures where quote_id=q.id and user_id=r.user_id) for share of q,project;
      if not found then return jsonb_build_object('id',null,'created',false,'reason','quote_not_due'); end if;
    else raise exception 'Passo email Agenzia non valido'; end if;
  end if;
  select lower(trim(email)) into recipient from public.contacts where id=p_contact_id and user_id=r.user_id
    and coalesce(hidden,false)=false and nullif(trim(email),'') is not null
    and (r.agent_id not in ('sales_followup','agency') or coalesce(contact_scope,'crm')='crm')
    and email_unsubscribed_at is null for update;
  if not found then raise exception 'Contatto non disponibile per una bozza'; end if;
  -- Due schede con la stessa email non devono preparare due bozze in parallelo.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text || ':' || recipient,0));
  if nullif(trim(p_key),'') is null or nullif(trim(p_subject),'') is null or nullif(trim(p_text),'') is null then
    raise exception 'Bozza incompleta';
  end if;
  select id into draft_id from public.email_drafts where user_id=r.user_id and office_key=p_key;
  if found then return jsonb_build_object('id',draft_id,'created',false); end if;
  if r.agent_id='agency' then
    select delivery.draft_id into draft_id from public.office_agency_deliveries delivery where user_id=r.user_id and delivery_key=p_key;
    if found then return jsonb_build_object('id',draft_id,'created',false); end if;
  end if;
  if exists (select 1 from public.email_drafts d join public.contacts c on c.id=d.contact_id and c.user_id=r.user_id
    where d.user_id=r.user_id and lower(trim(c.email))=recipient and d.status='pending') then
    return jsonb_build_object('id',null,'created',false,'reason','pending_draft');
  end if;
  if (r.agent_id = 'sales_followup' or agency_followup) and exists (
    select 1 from public.gmail_messages i join public.contacts c on c.id=p_contact_id and c.user_id=r.user_id
    where i.user_id=r.user_id and i.direction='inbound'
      and (i.contact_id=c.id or lower(trim(i.from_email))=lower(trim(c.email)))
      and i.sent_at > case when agency_followup then agency_quote.sent_at else coalesce((select max(o.sent_at) from public.gmail_messages o
        where o.user_id=r.user_id and o.direction='outbound' and o.contact_id=c.id), '1970-01-01'::timestamptz) end
  ) then return jsonb_build_object('id',null,'created',false,'reason','reply_received'); end if;
  if r.agent_id='sales_followup' or agency_followup then
    insert into public.office_agent_daily_quotas(user_id,agent_id,day)
      values(r.user_id,r.agent_id,(now() at time zone 'Europe/Rome')::date) on conflict do nothing;
    if (select used_count from public.office_agent_daily_quotas where user_id=r.user_id
      and agent_id=r.agent_id and day=(now() at time zone 'Europe/Rome')::date) >= (case when agency_followup then 5 else 15 end) then
      return jsonb_build_object('id',null,'created',false,'reason','daily_cap');
    end if;
  end if;
  insert into public.email_drafts(user_id,contact_id,subject,body_text,body_html,source,status,office_agent_id,office_key,office_note)
    values(r.user_id,p_contact_id,p_subject,p_text,p_html,'office','pending',r.agent_id,p_key,p_note)
    returning id into draft_id;
  if r.agent_id='sales_followup' or agency_followup then
    update public.office_agent_daily_quotas set used_count=used_count+1 where user_id=r.user_id and agent_id=r.agent_id and day=(now() at time zone 'Europe/Rome')::date;
  end if;
  if r.agent_id='agency' then
    insert into public.office_agency_deliveries(user_id,delivery_key,draft_id) values(r.user_id,p_key,draft_id);
  end if;
  return jsonb_build_object('id',draft_id,'created',true);
end;
$$;
revoke all on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) to service_role;
