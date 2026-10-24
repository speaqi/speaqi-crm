-- Un ordine che riaccoda lo stesso lavoro con dati nuovi (per esempio il link
-- della My Maps che mancava) aggiorna la voce in coda invece di rispondere
-- «già in coda» lasciando la fonte vuota. Si integrano solo i campi portati
-- dall'ordine, la chiave non cambia, e la voce ricorda quando è stata aggiornata.
-- Il resto della funzione è identico a 20261024090000_office_director_orders.sql.
create or replace function public.office_director_queue(p_user_id uuid, p_agent_id text, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.office_agents; k text; existing jsonb; patch jsonb; merged jsonb;
begin
  if p_agent_id is null or p_agent_id not in ('mymaps_builder','maps_quality','presentations','agency') then
    raise exception 'Destinatario non ammesso';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or length(p_entry::text) > 4000 then
    raise exception 'Voce di coda non valida';
  end if;
  k := nullif(trim(p_entry->>'key'), '');
  if k is null then raise exception 'Voce di coda senza chiave'; end if;
  if p_agent_id in ('mymaps_builder','maps_quality')
    and lower(coalesce(p_entry->>'slug','') || ' ' || coalesce(p_entry->>'city','')) ~ '(napoli|naples)' then
    raise exception 'Napoli non modificabile';
  end if;
  select * into a from public.office_agents where id = p_agent_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('queued', false, 'reason', 'agent_missing'); end if;
  if jsonb_typeof(coalesce(a.settings->'queue', '[]'::jsonb)) <> 'array' then
    raise exception 'La coda del destinatario non e una lista';
  end if;
  select q into existing from jsonb_array_elements(coalesce(a.settings->'queue', '[]'::jsonb)) q where q->>'key' = k limit 1;
  if existing is not null then
    -- Solo i campi nuovi o cambiati, mai null: un ordine senza link non cancella quello di prima.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into patch
      from jsonb_each(p_entry) e
      where e.key not in ('key','queued_at','origin','updated_at','revisions')
        and jsonb_typeof(e.value) <> 'null' and existing->e.key is distinct from e.value;
    if patch = '{}'::jsonb then
      return jsonb_build_object('queued', false, 'reason', 'already_queued', 'enabled', a.enabled);
    end if;
    merged := existing || patch || jsonb_build_object('updated_at', now(),
      'revisions', coalesce((existing->>'revisions')::int, 0) + 1);
    update public.office_agents
      set settings = jsonb_set(settings, '{queue}', (
        select jsonb_agg(case when q->>'key' = k then merged else q end order by n)
        from jsonb_array_elements(settings->'queue') with ordinality as t(q, n)))
      where id = a.id and user_id = p_user_id;
    return jsonb_build_object('queued', false, 'reason', 'updated', 'enabled', a.enabled, 'fields', (select jsonb_agg(x) from jsonb_object_keys(patch) x));
  end if;
  update public.office_agents
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{queue}',
      coalesce(settings->'queue', '[]'::jsonb) || jsonb_build_array(p_entry || jsonb_build_object('queued_at', now(), 'origin', 'director_order')))
    where id = a.id and user_id = p_user_id;
  return jsonb_build_object('queued', true, 'enabled', a.enabled);
end $$;

revoke all on function public.office_director_queue(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.office_director_queue(uuid,text,jsonb) to service_role;
