-- Quota persistente: eliminare o inviare una bozza non azzera il conteggio.
create table public.office_agent_daily_quotas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  agent_id text not null,
  day date not null,
  used_count integer not null default 0 check (used_count >= 0),
  unique(user_id,agent_id,day),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id)
);
alter table public.office_agent_daily_quotas enable row level security;
create policy office_quota_owner on public.office_agent_daily_quotas for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.office_agent_daily_quotas from anon,authenticated;
grant select on public.office_agent_daily_quotas to authenticated;
grant all on public.office_agent_daily_quotas to service_role;
-- Tetto giornaliero del Commerciale, anche fra corse diverse e invii manuali.
create index email_drafts_office_daily on public.email_drafts(user_id,office_agent_id,created_at) where office_agent_id is not null;
create or replace function public.create_office_email_draft(p_run_id uuid, p_contact_id uuid,
  p_key text, p_subject text, p_text text, p_html text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.office_agent_runs; draft_id uuid; recipient text;
begin
  perform 1 from public.office_agents where id = (select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id;
  if not found or r.status <> 'running' or r.started_at <= now()-interval '30 minutes' then
    raise exception 'Corsa non attiva';
  end if;
  select lower(trim(email)) into recipient from public.contacts where id=p_contact_id and user_id=r.user_id
    and coalesce(hidden,false)=false and nullif(trim(email),'') is not null
    and (r.agent_id <> 'sales_followup' or coalesce(contact_scope,'crm')='crm')
    and email_unsubscribed_at is null for update;
  if not found then raise exception 'Contatto non disponibile per una bozza'; end if;
  -- Due schede con la stessa email non devono preparare due bozze in parallelo.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text || ':' || recipient,0));
  if nullif(trim(p_key),'') is null or nullif(trim(p_subject),'') is null or nullif(trim(p_text),'') is null then
    raise exception 'Bozza incompleta';
  end if;
  select id into draft_id from public.email_drafts where user_id=r.user_id and office_key=p_key;
  if found then return jsonb_build_object('id',draft_id,'created',false); end if;
  if exists (select 1 from public.email_drafts d join public.contacts c on c.id=d.contact_id and c.user_id=r.user_id
    where d.user_id=r.user_id and lower(trim(c.email))=recipient and d.status='pending') then
    return jsonb_build_object('id',null,'created',false,'reason','pending_draft');
  end if;
  if r.agent_id = 'sales_followup' and exists (
    select 1 from public.gmail_messages i join public.contacts c on c.id=p_contact_id and c.user_id=r.user_id
    where i.user_id=r.user_id and i.direction='inbound'
      and (i.contact_id=c.id or lower(trim(i.from_email))=lower(trim(c.email)))
      and i.sent_at > coalesce((select max(o.sent_at) from public.gmail_messages o
        where o.user_id=r.user_id and o.direction='outbound' and o.contact_id=c.id), '1970-01-01'::timestamptz)
  ) then return jsonb_build_object('id',null,'created',false,'reason','reply_received'); end if;
  if r.agent_id='sales_followup' then
    insert into public.office_agent_daily_quotas(user_id,agent_id,day)
      values(r.user_id,r.agent_id,(now() at time zone 'Europe/Rome')::date) on conflict do nothing;
    if (select used_count from public.office_agent_daily_quotas where user_id=r.user_id
      and agent_id=r.agent_id and day=(now() at time zone 'Europe/Rome')::date) >= 15 then
      return jsonb_build_object('id',null,'created',false,'reason','daily_cap');
    end if;
  end if;
  insert into public.email_drafts(user_id,contact_id,subject,body_text,body_html,source,status,office_agent_id,office_key,office_note)
    values(r.user_id,p_contact_id,p_subject,p_text,p_html,'office','pending',r.agent_id,p_key,p_note)
    returning id into draft_id;
  if r.agent_id='sales_followup' then
    update public.office_agent_daily_quotas set used_count=used_count+1 where user_id=r.user_id and agent_id=r.agent_id and day=(now() at time zone 'Europe/Rome')::date;
  end if;
  return jsonb_build_object('id',draft_id,'created',true);
end;
$$;
revoke all on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) to service_role;
