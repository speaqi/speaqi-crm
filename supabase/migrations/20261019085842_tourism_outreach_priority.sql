-- Ordine di contatto delle destinazioni: quali chiamare per prime.
-- Dato commerciale, non un attributo verificato: non e' fra le colonne che
-- tourism_entity_guard confronta, quindi cambiarlo non invalida le fonti.
alter table public.tourism_entities add column outreach_priority smallint check(outreach_priority between 1 and 3);
alter table public.tourism_entities add column outreach_note text not null default '' check(length(outreach_note) <= 500);
create index tourism_entities_outreach_idx on public.tourism_entities(user_id,outreach_priority) where outreach_priority is not null;

create function public.tourism_set_outreach(p_entity_id uuid,p_version integer,p_priority smallint,p_note text default null) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare e public.tourism_entities;
begin
  if auth.uid() is null then raise exception 'Owner required'; end if;
  if p_priority is not null and p_priority not between 1 and 3 then raise exception 'Priority must be 1, 2 or 3'; end if;
  select * into e from public.tourism_entities where id=p_entity_id and user_id=auth.uid() for update;
  if not found then raise exception 'Entity not found'; end if;
  if p_version is null or e.version<>p_version then raise exception 'Version conflict'; end if;
  update public.tourism_entities
    set outreach_priority=p_priority,
        outreach_note=case when p_priority is null then '' else coalesce(left(btrim(p_note),500),outreach_note) end
    where id=e.id and user_id=auth.uid();
  return jsonb_build_object('id',e.id,'outreach_priority',p_priority,'version',e.version+1);
end $$;

revoke all on function public.tourism_set_outreach(uuid,integer,smallint,text) from public,anon;
grant execute on function public.tourism_set_outreach(uuid,integer,smallint,text) to authenticated;
