-- tourism_activate collega l'ente al contatto che c'è già nel CRM, se l'ordine lo nomina
-- (payload.contact_id). Caso Sibiu: Simina Manea era nei contatti, l'ente no; l'attivazione
-- provava a creare un contatto nuovo e si fermava sul possibile doppione. Ora, con un
-- contact_id dello stesso workspace, si scrive il collegamento (come «Conferma collegamento»
-- nella scheda) e nessun contatto nuovo. Senza contact_id si comporta come prima.
-- Stessa firma, stessi permessi: si ridefinisce la funzione.

create or replace function public.tourism_activate(p_user_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.tourism_entities; p public.tourism_entities; origin text; city text; v_site text; v_email text; v_phone text;
  src text; quote text; fields text[]; identity uuid; coverage uuid; v_relation text; place uuid; promote jsonb;
  promote_error text; filled text[] := '{}'; v_contact uuid; linked uuid; v_linked boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 8000 then raise exception 'Dati di attivazione non validi'; end if;
  origin := coalesce(p_payload->>'origin', 'owner');
  if origin not in ('owner', 'director') then raise exception 'Origine non valida'; end if;
  select * into e from public.tourism_entities where id = p_entity_id and user_id = p_user_id for update;
  if not found or e.kind <> 'organization' or e.disabled or e.status in ('INACTIVE', 'DUPLICATE') then
    raise exception 'Ente non disponibile';
  end if;
  if nullif(p_payload->>'version', '') is not null and (p_payload->>'version')::int <> e.version then
    raise exception 'La scheda è cambiata: ricaricala prima di confermare';
  end if;
  city := nullif(btrim(coalesce(p_payload->>'city', '')), '');
  if nullif(p_payload->>'contact_id', '') is not null then
    if p_payload->>'contact_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Contatto non valido'; end if;
    v_contact := (p_payload->>'contact_id')::uuid;
    if not exists (select 1 from public.contacts where id = v_contact and user_id = p_user_id) then raise exception 'Contatto non trovato'; end if;
  end if;
  if origin = 'director' and lower(coalesce(city, '') || ' ' || e.name || ' ' || array_to_string(e.aliases, ' ')) ~ '(napoli|naples)' then
    raise exception 'Napoli esclusa dal lavoro degli agenti';
  end if;

  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);

  -- Solo i campi vuoti: un dato già scritto resta com'è.
  v_site := nullif(btrim(coalesce(p_payload->>'website', '')), '');
  if v_site is not null and v_site !~ '^https?://[^[:space:]]+\.[^[:space:]]+$' then raise exception 'Sito non valido'; end if;
  v_email := lower(nullif(btrim(coalesce(p_payload->>'email', '')), ''));
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}$' then raise exception 'Email non valida'; end if;
  v_phone := nullif(btrim(coalesce(p_payload->>'phone', '')), '');
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) not between 6 and 15 then raise exception 'Telefono non valido'; end if;
  if e.website is null and v_site is not null then filled := array_append(filled, 'website'); else v_site := null; end if;
  if e.email is null and v_email is not null then filled := array_append(filled, 'email'); else v_email := null; end if;
  if e.phone is null and v_phone is not null then filled := array_append(filled, 'phone'); else v_phone := null; end if;
  if cardinality(filled) > 0 then
    -- Il guard rimette l'ente in revisione: la prova qui sotto, scritta ora, vale per i dati nuovi.
    update public.tourism_entities set website = coalesce(website, v_site), email = coalesce(email, v_email), phone = coalesce(phone, v_phone)
      where id = e.id returning * into e;
  end if;

  -- Una prova sola che copre quello che il titolare ha confermato (o che il Direttore ha letto sul sito).
  src := coalesce(nullif(p_payload->'identity'->>'source_url', ''), e.website, 'https://crm.speaqi.com/tourism');
  if src !~ '^https?://[^[:space:]]+$' then raise exception 'Fonte non valida'; end if;
  quote := left(coalesce(nullif(btrim(p_payload->'identity'->>'quote'), ''),
    case when origin = 'director' then 'Attivato dal Direttore su ordine del titolare.' else 'Dati confermati dal titolare nel CRM.' end), 2000);
  fields := array['name', 'country_code', 'type_code'];
  if e.website is not null then fields := array_append(fields, 'website'); end if;
  if e.email is not null then fields := array_append(fields, 'email'); end if;
  if e.phone is not null then fields := array_append(fields, 'phone'); end if;
  insert into public.tourism_evidence(user_id, entity_id, source_url, title, excerpt, fields, method, status)
    values (p_user_id, e.id, src, case when origin = 'director' then 'Attivato su ordine del titolare' else 'Confermato dal titolare' end,
      quote, fields, case when origin = 'director' then 'ai' else 'manual' end, 'VERIFIED') returning id into identity;
  update public.tourism_entities set status = 'VERIFIED' where id = e.id and status <> 'VERIFIED';

  -- La destinazione che l'ente racconta: serve alle presentazioni.
  if city is not null then
    v_relation := coalesce(nullif(p_payload->'coverage'->>'relation', ''), 'COVERS');
    if v_relation not in ('COVERS', 'MANAGES', 'PROMOTES') then raise exception 'Relazione non valida'; end if;
    if nullif(p_payload->'coverage'->>'quote', '') is not null then
      insert into public.tourism_evidence(user_id, entity_id, source_url, title, excerpt, fields, method, status)
        values (p_user_id, e.id, coalesce(nullif(p_payload->'coverage'->>'source_url', ''), src), 'Legame con ' || city,
          left(p_payload->'coverage'->>'quote', 2000), array['coverage', 'relationship'], 'ai', 'VERIFIED') returning id into coverage;
    else
      -- Senza una frase del sito che leghi l'ente alla città, la prova del legame è
      -- l'ordine (o la conferma) del titolare, scritta come tale. La prova d'identità
      -- non basta: il catalogo vuole una prova di copertura per ogni relazione.
      insert into public.tourism_evidence(user_id, entity_id, source_url, title, excerpt, fields, method, status)
        values (p_user_id, e.id, src, 'Legame con ' || city,
          case when origin = 'director'
            then 'Su ordine del titolare: ' || e.name || ' racconta ' || city || '.'
            else 'Confermato dal titolare: ' || e.name || ' racconta ' || city || '.' end,
          array['coverage', 'relationship'], case when origin = 'director' then 'ai' else 'manual' end, 'VERIFIED')
        returning id into coverage;
    end if;
    select * into p from public.tourism_entities where user_id = p_user_id and kind = 'place' and country_code = e.country_code
      and name_key = public.tourism_name_key(city) for update;
    if p.id is null then
      insert into public.tourism_entities(user_id, kind, name, country_code, status) values (p_user_id, 'place', city, e.country_code, 'UNVERIFIED') returning * into p;
    end if;
    if p.disabled or p.status in ('INACTIVE', 'DUPLICATE') then raise exception 'Destinazione disabilitata'; end if;
    if origin = 'director' and lower(p.name || ' ' || array_to_string(p.aliases, ' ')) ~ '(napoli|naples)' then raise exception 'Napoli esclusa dal lavoro degli agenti'; end if;
    place := p.id;
    if p.status <> 'VERIFIED' then
      insert into public.tourism_evidence(user_id, entity_id, source_url, title, excerpt, fields, method, status)
        values (p_user_id, place, src, 'Destinazione dell''ente ' || e.name, quote, array['name'], 'manual', 'VERIFIED');
      update public.tourism_entities set status = 'VERIFIED' where id = place;
    end if;
    insert into public.tourism_relations(user_id, from_id, to_id, relation, evidence_id)
      values (p_user_id, e.id, place, v_relation, coverage)
      on conflict (user_id, from_id, to_id, relation) do nothing;
  end if;

  -- Nel CRM. Un rifiuto non annulla la verifica: torna come motivo.
  if v_contact is not null then
    -- Il contatto c'è già: si collega quello, come «Conferma collegamento» nella scheda.
    perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':tourism-crm'));
    select contact_id into linked from public.tourism_crm_links where user_id = p_user_id and entity_id = e.id;
    if linked is null then
      insert into public.tourism_crm_links(user_id, entity_id, contact_id) values (p_user_id, e.id, v_contact);
      update public.tourism_crm_matches set state = 'confirmed' where user_id = p_user_id and entity_id = e.id and contact_id = v_contact;
      insert into public.activities(user_id, contact_id, type, content)
        values (p_user_id, v_contact, 'system', 'Collegato all''ente di Tourism Intelligence ' || e.name || '. Nessun recapito sovrascritto.');
      promote := jsonb_build_object('contact_id', v_contact, 'created', false);
      v_linked := true;
    elsif linked = v_contact then
      promote := jsonb_build_object('contact_id', v_contact, 'created', false);
    else
      promote_error := 'Organization already linked to another CRM contact';
    end if;
  else
    begin
      promote := public.tourism_promote(e.id);
    exception when others then
      promote_error := sqlerrm;
    end;
  end if;

  return jsonb_build_object('entity_id', e.id, 'place_id', place, 'filled', to_jsonb(filled),
    'contact_id', promote->>'contact_id', 'contact_created', coalesce((promote->>'created')::boolean, false), 'contact_linked', v_linked, 'crm_error', promote_error);
end $$;

revoke all on function public.tourism_activate(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tourism_activate(uuid, uuid, jsonb) to service_role;
