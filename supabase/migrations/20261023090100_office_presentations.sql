-- Generata con Supabase CLI; timestamp riordinato dopo il 05 già in main.
-- Da applicare a cura di Claude prima del merge. Solo bozze, mai invii.
create table public.office_presentation_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null default 'presentations' check(agent_id='presentations'),
  run_id uuid references public.office_agent_runs(id) on delete set null,
  entity_id uuid not null,
  destination_id uuid not null,
  deck_id uuid unique references public.tourism_decks(id) on delete set null,
  public_base text not null check(public_base ~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'),
  state text not null default 'claimed' check(state in ('claimed','ready','failed')),
  email_state text not null default 'awaiting_approval' check(email_state in ('awaiting_approval','verified_email_missing','crm_contact_missing','pending_draft','prepared')),
  email_prepared_at timestamptz,
  email_draft_id uuid references public.email_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,entity_id,destination_id),
  check(deck_id is null or deck_id=id),
  foreign key(agent_id,user_id) references public.office_agents(id,user_id) on delete cascade,
  foreign key(user_id,entity_id) references public.tourism_entities(user_id,id),
  foreign key(user_id,destination_id) references public.tourism_entities(user_id,id)
);
create trigger office_presentation_owner before insert or update on public.office_presentation_tasks
for each row execute function public.office_check_run_owner();
alter table public.office_presentation_tasks enable row level security;
create policy office_presentation_read on public.office_presentation_tasks for select to authenticated using((select auth.uid())=user_id);
revoke all on public.office_presentation_tasks from public,anon,authenticated;
grant select on public.office_presentation_tasks to authenticated;
grant all on public.office_presentation_tasks to service_role;

create function public.claim_office_presentation(p_run_id uuid,p_entity_id uuid,p_destination_id uuid,p_public_base text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; task public.office_presentation_tasks;
begin
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='presentations' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa presentazioni non attiva'; end if;
  perform 1 from public.office_agents where id=r.agent_id and user_id=r.user_id for no key update;
  if not exists(select 1 from public.tourism_entities where id=p_entity_id and user_id=r.user_id and kind='organization' and status='VERIFIED' and not disabled)
    or not exists(select 1 from public.tourism_entities where id=p_destination_id and user_id=r.user_id and kind='place' and status='VERIFIED' and not disabled)
    then raise exception 'Ente o destinazione non verificati nel workspace'; end if;
  if exists(select 1 from public.tourism_entities where id in(p_entity_id,p_destination_id) and lower(name)~'(napoli|naples)') then raise exception 'Napoli esclusa'; end if;
  insert into public.office_presentation_tasks(user_id,run_id,entity_id,destination_id,public_base)
    values(r.user_id,r.id,p_entity_id,p_destination_id,p_public_base)
    on conflict(user_id,entity_id,destination_id) do nothing returning * into task;
  if found then return jsonb_build_object('claimed',true,'task',to_jsonb(task)); end if;
  select * into task from public.office_presentation_tasks where user_id=r.user_id and entity_id=p_entity_id and destination_id=p_destination_id;
  return jsonb_build_object('claimed',false,'task',to_jsonb(task));
end $$;

-- Chiamata dopo il clic di approvazione della pipeline esistente, o per
-- riconciliare un'approvazione il cui contatto CRM non era ancora disponibile.
create function public.prepare_office_presentation_email(p_deck_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.office_presentation_tasks; deck public.tourism_decks; entity public.tourism_entities;
  recipient public.contacts; draft uuid; message text; draft_key text;
begin
  select * into task from public.office_presentation_tasks where id=p_deck_id and user_id=p_user_id;
  if not found then return jsonb_build_object('created',false,'reason','not_office'); end if;
  select * into deck from public.tourism_decks where id=p_deck_id and user_id=p_user_id and entity_id=task.entity_id for no key update;
  if not found or deck.status<>'approved' or deck.approved_at is null then return jsonb_build_object('created',false,'reason','not_approved'); end if;
  select * into task from public.office_presentation_tasks where id=p_deck_id and user_id=p_user_id for update;
  if deck.slides::text ~ '\[DA VERIFICARE' then raise exception 'Presentazione con segnaposto: nessuna bozza'; end if;
  if task.email_prepared_at is not null then return jsonb_build_object('created',false,'id',task.email_draft_id,'reason','already_prepared'); end if;
  select * into entity from public.tourism_entities where id=task.entity_id and user_id=p_user_id and status='VERIFIED' and not disabled;
  if not found or not exists(select 1 from public.tourism_evidence where user_id=p_user_id and entity_id=task.entity_id and status='VERIFIED' and 'email'=any(fields)) then
    update public.office_presentation_tasks set email_state='verified_email_missing' where id=task.id;
    return jsonb_build_object('created',false,'reason','verified_email_missing'); end if;
  select c.* into recipient from public.contacts c join public.tourism_crm_links l on l.contact_id=c.id and l.user_id=c.user_id
    where l.entity_id=task.entity_id and c.user_id=p_user_id and not coalesce(c.hidden,false) and c.email_unsubscribed_at is null
      and lower(trim(c.email))=lower(trim(entity.email)) and c.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' for update of c;
  if not found then
    update public.office_presentation_tasks set email_state='crm_contact_missing' where id=task.id;
    return jsonb_build_object('created',false,'reason','crm_contact_missing'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text||':'||lower(trim(recipient.email)),0));
  if exists(select 1 from public.email_drafts d join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
    where d.user_id=p_user_id and d.status='pending' and lower(trim(c.email))=lower(trim(recipient.email))) then
    update public.office_presentation_tasks set email_state='pending_draft' where id=task.id;
    return jsonb_build_object('created',false,'reason','pending_draft'); end if;
  draft_key:='presentation:'||deck.id::text;
  message:='Buongiorno,'||chr(10)||chr(10)||'qui trovi la presentazione Speaqi per '||deck.destination||':'||chr(10)
    ||task.public_base||'/presentazione/'||deck.public_token||chr(10)||chr(10)||'Resto a disposizione per parlarne.';
  insert into public.email_drafts(user_id,contact_id,subject,body_text,body_html,source,status,office_agent_id,office_key,office_note)
    values(p_user_id,recipient.id,'Presentazione Speaqi — '||left(deck.destination,150),message,
      '<p>'||replace(replace(replace(replace(message,'&','&amp;'),'<','&lt;'),'>','&gt;'),chr(10),'<br>')||'</p>',
      'office','pending','presentations',draft_key,'Presentazione approvata dal titolare. Rivedere la bozza e inviarla a mano.')
    on conflict(user_id,office_key) where office_key is not null do nothing returning id into draft;
  if draft is null then select id into draft from public.email_drafts where user_id=p_user_id and office_key=draft_key; end if;
  update public.office_presentation_tasks set email_state='prepared',email_prepared_at=now(),email_draft_id=draft where id=task.id;
  return jsonb_build_object('created',true,'id',draft);
end $$;

create function public.office_presentation_approved() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' and old.status is distinct from 'approved' then
    perform public.prepare_office_presentation_email(new.id,new.user_id);
    update public.office_agent_outputs set status='approved',decided_at=now()
      where user_id=new.user_id and agent_id='presentations' and target_table='tourism_decks' and target_id=new.id::text and kind='report' and status='pending';
  end if;
  return new;
end $$;
create trigger office_presentation_approved after update of status on public.tourism_decks
for each row execute function public.office_presentation_approved();

create function public.finish_office_presentation(p_run_id uuid,p_task_id uuid,p_report jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.office_agent_runs; task public.office_presentation_tasks; deck public.tourism_decks; output uuid; report_key text;
begin
  select * into r from public.office_agent_runs where id=p_run_id and agent_id='presentations' and status='running' and started_at>now()-interval '30 minutes';
  if not found then raise exception 'Corsa presentazioni non attiva'; end if;
  perform 1 from public.office_agents where id=r.agent_id and user_id=r.user_id for no key update;
  select * into task from public.office_presentation_tasks where id=p_task_id and user_id=r.user_id for update;
  if not found then raise exception 'Presentazione di un altro workspace'; end if;
  select * into deck from public.tourism_decks where id=task.id and user_id=task.user_id and entity_id=task.entity_id;
  if not found or deck.status not in ('ready','failed','approved') then raise exception 'Presentazione non conclusa'; end if;
  update public.office_presentation_tasks set deck_id=deck.id,state=case when deck.status='failed' then 'failed' else 'ready' end where id=task.id;
  report_key:='presentation:'||task.id::text||':v'||deck.version::text;
  select id into output from public.office_agent_outputs o where o.user_id=r.user_id and o.agent_id=r.agent_id and o.output_key=report_key;
  if output is null then output:=public.add_office_agent_output(r.id,report_key,'report',
    case when deck.status='failed' then 'Presentazione da verificare' when deck.status='approved' then 'Presentazione approvata' else 'Presentazione da approvare' end,
    p_report||jsonb_build_object('deck_id',deck.id,'status',deck.status,'editor','/tourism','version',deck.version),'tourism_decks',deck.id::text); end if;
  if deck.status='approved' then update public.office_agent_outputs set status='approved',decided_at=coalesce(decided_at,now()) where id=output and status='pending'; end if;
  return output;
end $$;
revoke all on function public.claim_office_presentation(uuid,uuid,uuid,text),public.prepare_office_presentation_email(uuid,uuid),public.office_presentation_approved(),public.finish_office_presentation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_office_presentation(uuid,uuid,uuid,text),public.prepare_office_presentation_email(uuid,uuid),public.finish_office_presentation(uuid,uuid,jsonb) to service_role;
