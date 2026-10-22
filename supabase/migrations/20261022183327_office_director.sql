-- Decisioni umane dell'ufficio, atomiche con l'accodamento interno del Direttore.
create index office_director_decisions on public.office_agent_outputs(user_id,status,decided_at)
  where agent_id='director' and kind='proposal';

create function public.decide_office_output(p_output_id uuid,p_user_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.office_agent_outputs; recipient public.office_agents; expected text; entry jsonb;
begin
  if p_status not in ('approved','rejected') or p_status is null then raise exception 'Decisione non valida'; end if;
  select * into o from public.office_agent_outputs where id=p_output_id and user_id=p_user_id for update;
  if not found then return jsonb_build_object('output',null,'reason','not_found'); end if;
  if o.status <> 'pending' then return jsonb_build_object('output',null,'reason','already_decided'); end if;
  if o.agent_id='director' and o.kind='proposal' and p_status='approved' then
    expected := case o.body->>'action' when 'build_map' then 'mymaps_builder'
      when 'publication_review' then 'maps_quality' when 'complete_languages' then 'languages_voice' else null end;
    if expected is null or expected is distinct from o.body->>'recipient_agent_id'
      or nullif(o.body->>'action_key','') is null or nullif(o.target_id,'') is null or o.target_table is null
      or nullif(trim(o.body->>'city'),'') is null
      or (o.body->>'action'='build_map' and o.target_table not in ('tourism_destinations','tourism_hubs'))
      or (o.body->>'action'='publication_review' and o.target_table is distinct from 'studiomap_maps')
      or (o.body->>'action'='complete_languages' and o.target_table is distinct from 'speaqi_maps') then
      raise exception 'Proposta del Direttore non valida';
    end if;
    if lower(coalesce(o.body->>'city','') || ' ' || coalesce(o.body->>'map_slug','') || ' ' || o.target_id)
      ~ '(napoli|naples)' then raise exception 'Napoli non modificabile'; end if;
    select * into recipient from public.office_agents where id=expected and user_id=p_user_id for update;
    if not found then return jsonb_build_object('output',null,'reason','agent_missing'); end if;
    if jsonb_typeof(coalesce(recipient.settings->'queue','[]'::jsonb)) <> 'array' then
      raise exception 'La coda del destinatario non e una lista';
    end if;
    entry := jsonb_build_object('key',o.body->>'action_key','action',o.body->>'action','city',o.body->>'city',
      'map_slug',o.body->'map_slug','target_table',o.target_table,'target_id',o.target_id,
      'source_output_id',o.id,'queued_at',now(),'status','pending');
    if not exists(select 1 from jsonb_array_elements(coalesce(recipient.settings->'queue','[]'::jsonb)) q
      where q->>'key'=o.body->>'action_key') then
      update public.office_agents set settings=jsonb_set(settings,'{queue}',coalesce(settings->'queue','[]'::jsonb) || jsonb_build_array(entry))
        where id=recipient.id and user_id=p_user_id;
    end if;
  end if;
  -- Anche il rifiuto resta tracciato: il Direttore lo consulta per 28 giorni.
  update public.office_agent_outputs set status=p_status,decided_at=now() where id=o.id returning * into o;
  return jsonb_build_object('output',to_jsonb(o));
end;
$$;
revoke all on function public.decide_office_output(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_office_output(uuid,uuid,text) to service_role;
