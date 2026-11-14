-- Keep the original Kanban card and its invoice links intact.
create table public.todo_contact_links (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index todo_contact_links_user_contact_idx on public.todo_contact_links(user_id, contact_id);
alter table public.todo_contact_links enable row level security;
create policy todo_contact_links_owner on public.todo_contact_links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid()) and t.contact_id is null) and exists (select 1 from public.contacts c where c.id = contact_id and c.user_id = (select auth.uid())));
grant select, insert on public.todo_contact_links to authenticated;

create or replace function public.activate_todo_contact(p_task_id uuid, p_contact_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare t public.tasks%rowtype; c public.contacts%rowtype; candidates jsonb; existing_id uuid; task_name text;
begin
  select * into t from public.tasks where id = p_task_id and user_id = (select auth.uid()) and contact_id is null for update;
  if not found then raise exception 'Attività non trovata o non autorizzata'; end if;
  select contact_id into existing_id from public.todo_contact_links where task_id = t.id;
  if existing_id is not null then
    select * into c from public.contacts where id = existing_id;
    return jsonb_build_object('status','linked','contact',to_jsonb(c));
  end if;
  task_name := btrim(coalesce(t.title, ''));
  if task_name = '' then raise exception 'Inserisci prima un nome per l’attività'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text || ':' || lower(task_name), 0));
  if p_contact_id is null then
    select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into candidates from (
      select id,name,company,status,contact_scope,hidden from public.contacts
      where user_id = (select auth.uid()) and (lower(btrim(name)) = lower(task_name) or lower(btrim(company)) = lower(task_name))
      order by name limit 20
    ) matches;
    if jsonb_array_length(candidates) > 0 then return jsonb_build_object('status','matches','candidates',candidates); end if;
    insert into public.contacts(user_id,name,status,source,contact_scope,hidden)
      values ((select auth.uid()),task_name,'New','todo-activation','crm',false) returning * into c;
  else
    select * into c from public.contacts where id = p_contact_id and user_id = (select auth.uid());
    if not found then raise exception 'Contatto non trovato o non autorizzato'; end if;
  end if;
  insert into public.todo_contact_links(task_id,contact_id,user_id) values(t.id,c.id,(select auth.uid()));
  return jsonb_build_object('status',case when p_contact_id is null then 'created' else 'linked' end,'contact',to_jsonb(c));
end $$;
revoke all on function public.activate_todo_contact(uuid,uuid) from public, anon;
grant execute on function public.activate_todo_contact(uuid,uuid) to authenticated;
