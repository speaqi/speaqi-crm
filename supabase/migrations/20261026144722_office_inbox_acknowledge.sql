-- Leggere un rapporto non equivale ad approvare il documento o il lavoro collegato.
create index office_work_approval_output_lookup on public.office_work_items(user_id, approval_output_id)
  where approval_output_id is not null;
create index office_work_dependency_output_lookup on public.office_work_dependencies(user_id, output_id)
  where output_id is not null;

create function public.acknowledge_office_outputs(p_user_id uuid, p_output_ids uuid[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  output_id uuid;
  item public.office_agent_outputs;
  results jsonb := '[]'::jsonb;
begin
  if p_user_id is null or coalesce(cardinality(p_output_ids), 0) not between 1 and 50
    or array_position(p_output_ids, null) is not null then
    raise exception 'Selezionare da 1 a 50 avvisi validi';
  end if;
  -- Ordine stabile anche quando due schede archiviano gruppi sovrapposti.
  for output_id in select distinct unnest(p_output_ids) order by 1 loop
    select * into item from public.office_agent_outputs
      where id = output_id and user_id = p_user_id for update;
    if not found then
      results := results || jsonb_build_array(jsonb_build_object('id', output_id, 'ok', false, 'error', 'Avviso non trovato. Aggiorna la coda.'));
    elsif item.kind <> 'report' or item.body->>'action' is not null then
      results := results || jsonb_build_array(jsonb_build_object('id', output_id, 'ok', false, 'error', 'Questa voce richiede una decisione esplicita.'));
    elsif item.status <> 'pending' then
      results := results || jsonb_build_array(jsonb_build_object('id', output_id, 'ok', true, 'already_processed', true));
    elsif exists (select 1 from public.office_work_items w where w.user_id = p_user_id and w.approval_output_id = item.id)
      or exists (select 1 from public.office_work_dependencies d where d.user_id = p_user_id and d.output_id = item.id) then
      results := results || jsonb_build_array(jsonb_build_object('id', output_id, 'ok', false, 'error', 'Questo avviso è una decisione richiesta da un lavoro. Apri il lavoro collegato.'));
    else
      update public.office_agent_outputs set status = 'done', decided_at = now()
        where id = item.id and user_id = p_user_id;
      results := results || jsonb_build_array(jsonb_build_object('id', output_id, 'ok', true));
    end if;
  end loop;
  return results;
end;
$$;
revoke all on function public.acknowledge_office_outputs(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.acknowledge_office_outputs(uuid, uuid[]) to service_role;
