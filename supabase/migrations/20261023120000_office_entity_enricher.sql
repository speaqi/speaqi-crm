-- Agente 08 — Arricchimento enti. L'agente propone e basta: nessuna scrittura su
-- Tourism Intelligence o sul CRM prima del clic del titolare. Approvare una proposta
-- qui fa, in una transazione sola: prove verificate a nome del titolare (le frasi
-- che ha letto nella proposta), solo i campi vuoti riempiti, la relazione con la città,
-- l'ingresso nel CRM con tourism_promote e la coda delle Presentazioni.

create or replace function public.office_enrich_entity(p_user_id uuid, p_output_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.office_agent_outputs; b jsonb; e public.tourism_entities; p public.tourism_entities;
  v_email text; v_phone text; v_type text; place uuid; coverage uuid; promote jsonb; recipient public.office_agents;
  filled text[] := '{}'; kept text[] := '{}'; queued boolean := false; city text; part text; ev jsonb;
begin
  select * into o from public.office_agent_outputs where id=p_output_id and user_id=p_user_id;
  if not found then raise exception 'Proposta di arricchimento non trovata'; end if;
  b := o.body;
  if o.agent_id <> 'entity_enricher' or o.kind <> 'proposal' or b->>'action' is distinct from 'enrich_entity'
    or o.target_table is distinct from 'tourism_entities' or o.target_id is distinct from b->>'entity_id' then
    raise exception 'Proposta di arricchimento non valida';
  end if;
  city := nullif(btrim(b->>'city'),'');
  if city is null or b->'evidence'->'coverage'->>'relation' not in ('COVERS','MANAGES','PROMOTES') then
    raise exception 'Proposta di arricchimento incompleta';
  end if;
  foreach part in array array['identity','coverage','email','phone'] loop
    ev := b->'evidence'->part;
    if ev is null and part in ('email','phone') then continue; end if;
    if ev is null or coalesce(ev->>'source_url','') !~ '^https?://[^[:space:]]+$' or length(btrim(coalesce(ev->>'quote',''))) not between 8 and 400 then
      raise exception 'Prova % senza fonte o senza frase', part;
    end if;
  end loop;

  select * into e from public.tourism_entities where id=(b->>'entity_id')::uuid and user_id=p_user_id for update;
  if not found or e.kind <> 'organization' or e.disabled or e.status in ('INACTIVE','DUPLICATE') then
    raise exception 'Ente non disponibile';
  end if;
  if lower(city || ' ' || e.name || ' ' || array_to_string(e.aliases,' ')) ~ '(napoli|naples)' then raise exception 'Napoli esclusa'; end if;

  -- L'approvazione e' del titolare: verifiche, revisioni e collegamento CRM portano il suo id.
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);

  -- Solo i campi vuoti. Un campo riempito nel frattempo resta com'e'.
  if nullif(b->'fill'->>'email','') is not null then
    if e.email is null then v_email := lower(btrim(b->'fill'->>'email')); filled := array_append(filled,'email'); else kept := array_append(kept,'email'); end if;
  end if;
  if nullif(b->'fill'->>'phone','') is not null then
    if e.phone is null then v_phone := btrim(b->'fill'->>'phone'); filled := array_append(filled,'phone'); else kept := array_append(kept,'phone'); end if;
  end if;
  if v_email is not null and (v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' or split_part(v_email,'@',2) ~ '(^|\.)pec\.|legalmail|postacert') then
    raise exception 'Email non istituzionale';
  end if;
  if b->'decision_maker' is not null and jsonb_typeof(b->'decision_maker') = 'object' and not (e.details ? 'decision_maker_type') then
    v_type := b->'decision_maker'->>'type';
    if v_type not in ('direttore','presidente','assessore','ufficio_turismo','marketing','ufficio_stampa','segreteria','altro') then v_type := null; end if;
  end if;
  if v_email is not null or v_phone is not null or v_type is not null then
    -- Il guard del catalogo rimette l'ente in revisione e toglie la verifica alle prove vecchie:
    -- le prove nuove qui sotto, approvate ora, sono quelle che valgono per i dati nuovi.
    update public.tourism_entities set email=coalesce(email,v_email), phone=coalesce(phone,v_phone),
      details=case when v_type is null then details else details || jsonb_build_object('decision_maker_type',v_type) end
      where id=e.id;
  end if;

  insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
    values(p_user_id,e.id,b->'evidence'->'identity'->>'source_url','Identità dell''ente (Ufficio, approvata)',
      b->'evidence'->'identity'->>'quote',array['name','country_code','type_code'],'ai','VERIFIED');
  if v_email is not null then
    insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
      values(p_user_id,e.id,b->'evidence'->'email'->>'source_url','Email d''ufficio (Ufficio, approvata)',b->'evidence'->'email'->>'quote',array['email'],'ai','VERIFIED');
  end if;
  if v_phone is not null then
    insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
      values(p_user_id,e.id,b->'evidence'->'phone'->>'source_url','Telefono d''ufficio (Ufficio, approvato)',b->'evidence'->'phone'->>'quote',array['phone'],'ai','VERIFIED');
  end if;
  if v_type is not null then
    insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
      values(p_user_id,e.id,b->'decision_maker'->>'source_url','Chi decide (ruolo, approvato)',b->'decision_maker'->>'quote',array['decision_maker_type'],'ai','VERIFIED');
  end if;
  insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
    values(p_user_id,e.id,b->'evidence'->'coverage'->>'source_url','Legame con '||city||' (Ufficio, approvato)',
      b->'evidence'->'coverage'->>'quote',array['coverage','relationship'],'ai','VERIFIED') returning id into coverage;
  update public.tourism_entities set status='VERIFIED' where id=e.id and status <> 'VERIFIED';

  -- La destinazione: quella indicata, oppure il luogo con lo stesso nome nel paese, oppure un luogo nuovo.
  if nullif(b->>'place_id','') is not null then
    select * into p from public.tourism_entities where id=(b->>'place_id')::uuid and user_id=p_user_id and kind='place' for update;
  end if;
  if p.id is null then
    select * into p from public.tourism_entities where user_id=p_user_id and kind='place' and country_code=e.country_code
      and name_key=public.tourism_name_key(city) for update;
  end if;
  if p.id is null then
    insert into public.tourism_entities(user_id,kind,name,country_code,status) values(p_user_id,'place',city,e.country_code,'UNVERIFIED') returning * into p;
  end if;
  if p.disabled or p.status in ('INACTIVE','DUPLICATE') then raise exception 'Destinazione disabilitata'; end if;
  if lower(p.name || ' ' || array_to_string(p.aliases,' ')) ~ '(napoli|naples)' then raise exception 'Napoli esclusa'; end if;
  place := p.id;
  if p.status <> 'VERIFIED' then
    insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method,status)
      values(p_user_id,place,b->'evidence'->'coverage'->>'source_url','Destinazione citata dall''ente (Ufficio, approvata)',
        b->'evidence'->'coverage'->>'quote',array['name'],'ai','VERIFIED');
    update public.tourism_entities set status='VERIFIED' where id=place;
  end if;
  insert into public.tourism_relations(user_id,from_id,to_id,relation,evidence_id)
    values(p_user_id,e.id,place,b->'evidence'->'coverage'->>'relation',coverage)
    on conflict (user_id,from_id,to_id,relation) do nothing;

  -- Lo stesso ingresso nel CRM del pulsante in Tourism: un nome ambiguo o un'email gia' usata fermano tutto.
  promote := public.tourism_promote(e.id);

  select * into recipient from public.office_agents where id='presentations' and user_id=p_user_id for update;
  if found and jsonb_typeof(coalesce(recipient.settings->'queue','[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(recipient.settings->'queue','[]'::jsonb)) < 100 then
    if not exists(select 1 from jsonb_array_elements(coalesce(recipient.settings->'queue','[]'::jsonb)) q
      where q->>'entity_id'=e.id::text and coalesce(q->>'destination_id','')=place::text) then
      update public.office_agents set settings=jsonb_set(settings,'{queue}',coalesce(settings->'queue','[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('entity_id',e.id,'destination_id',place,'source_output_id',o.id,'queued_at',now())))
        where id=recipient.id and user_id=p_user_id;
    end if;
    queued := true;
  end if;

  return jsonb_build_object('entity_id',e.id,'place_id',place,'contact_id',promote->>'contact_id','contact_created',promote->'created',
    'filled',to_jsonb(filled),'kept',to_jsonb(kept),'queued_presentation',queued);
end;
$$;

-- Stessa funzione della migration della pulizia, rami del Direttore e della pulizia identici;
-- in piu' il ramo dell'arricchimento enti.
create or replace function public.decide_office_output(p_output_id uuid,p_user_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.office_agent_outputs; recipient public.office_agents; expected text; entry jsonb;
  g jsonb; merged jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; result jsonb;
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
  if o.agent_id='db_cleaner' and o.kind='data_fix' and o.body->>'action'='merge_contacts' and p_status='approved' then
    if jsonb_typeof(o.body->'groups') <> 'array' or jsonb_array_length(o.body->'groups') not between 1 and 20 then
      raise exception 'Proposta di unione non valida';
    end if;
    for g in select value from jsonb_array_elements(o.body->'groups') loop
      begin
        result := public.office_merge_contacts(p_user_id, (g->>'keep')::uuid,
          array(select jsonb_array_elements_text(g->'drop')::uuid), o.body->>'reason');
        merged := merged || jsonb_build_array(result);
      exception when others then
        skipped := skipped || jsonb_build_array(jsonb_build_object('keep', g->>'keep', 'error', sqlerrm));
      end;
    end loop;
    if jsonb_array_length(merged) = 0 then
      return jsonb_build_object('output',null,'reason','merge_failed','skipped',skipped);
    end if;
    update public.office_agent_outputs set body = body || jsonb_build_object('result', jsonb_build_object(
      'merged', merged, 'skipped', skipped, 'decided_at', now())) where id=o.id;
  end if;
  if o.agent_id='entity_enricher' and o.kind='proposal' and o.body->>'action'='enrich_entity' and p_status='approved' then
    begin
      result := public.office_enrich_entity(p_user_id, o.id);
    exception when others then
      -- Niente di fatto: la proposta resta da decidere, con il motivo.
      return jsonb_build_object('output',null,'reason','enrich_failed','error',sqlerrm);
    end;
    update public.office_agent_outputs set body = body || jsonb_build_object('result', result || jsonb_build_object('decided_at', now())) where id=o.id;
  end if;
  update public.office_agent_outputs set status=p_status,decided_at=now() where id=o.id returning * into o;
  return jsonb_build_object('output',to_jsonb(o));
end;
$$;


do $$
declare f regprocedure;
begin
  for f in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('office_enrich_entity','decide_office_output') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
