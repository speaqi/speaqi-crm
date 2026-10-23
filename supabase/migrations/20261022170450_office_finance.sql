-- Bozze dell'ufficio: sempre revisione umana, mai source=auto.
-- Il vincolo originale (20260609140000) ammetteva solo 'auto' e 'manual':
-- senza allargarlo ogni bozza dell'ufficio sarebbe rifiutata dal database.
alter table public.email_drafts drop constraint if exists email_drafts_source_check;
alter table public.email_drafts add constraint email_drafts_source_check
  check (source in ('auto', 'manual', 'office'));
alter table public.email_drafts
  add column office_agent_id text,
  add column office_key text,
  add column office_note text,
  add constraint email_drafts_office_owner foreign key (office_agent_id, user_id)
    references public.office_agents(id, user_id),
  add constraint email_drafts_office_manual check (
    (office_agent_id is null and office_key is null and office_note is null)
    or (office_agent_id is not null and office_key is not null and source = 'office')
  );
create unique index email_drafts_office_key on public.email_drafts(user_id, office_key) where office_key is not null;

-- Il lock del contatto e la chiave persistente impediscono doppie bozze anche
-- dopo un retry, un'altra corsa o una bozza gia' inviata a mano.
create function public.create_office_email_draft(p_run_id uuid, p_contact_id uuid,
  p_key text, p_subject text, p_text text, p_html text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.office_agent_runs; draft_id uuid;
begin
  perform 1 from public.office_agents where id = (select agent_id from public.office_agent_runs where id=p_run_id) for update;
  select * into r from public.office_agent_runs where id=p_run_id;
  if not found or r.status <> 'running' or r.started_at <= now()-interval '30 minutes' then
    raise exception 'Corsa non attiva';
  end if;
  perform 1 from public.contacts where id=p_contact_id and user_id=r.user_id
    and coalesce(hidden,false)=false and nullif(trim(email),'') is not null
    and email_unsubscribed_at is null for update;
  if not found then raise exception 'Contatto non disponibile per una bozza'; end if;
  if nullif(trim(p_key),'') is null or nullif(trim(p_subject),'') is null or nullif(trim(p_text),'') is null then
    raise exception 'Bozza incompleta';
  end if;
  select id into draft_id from public.email_drafts where user_id=r.user_id and office_key=p_key;
  if found then return jsonb_build_object('id',draft_id,'created',false); end if;
  if exists (select 1 from public.email_drafts where user_id=r.user_id and contact_id=p_contact_id and status='pending') then
    return jsonb_build_object('id',null,'created',false,'reason','pending_draft');
  end if;
  insert into public.email_drafts(user_id,contact_id,subject,body_text,body_html,source,status,office_agent_id,office_key,office_note)
    values(r.user_id,p_contact_id,p_subject,p_text,p_html,'office','pending',r.agent_id,p_key,p_note)
    returning id into draft_id;
  return jsonb_build_object('id',draft_id,'created',true);
end;
$$;
revoke all on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_office_email_draft(uuid,uuid,text,text,text,text,text) to service_role;
