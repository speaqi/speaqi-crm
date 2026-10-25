-- Attivare un ente di Tourism Intelligence in un gesto: «chiudiamo noi» e il dato
-- entra nel CRM. Lo usano due strade, entrambe a nome del titolare:
--   - il pulsante «Conferma e aggiungi ai contatti» della scheda (origin 'owner');
--   - il Direttore, quando il titolare chiede la presentazione di un ente non ancora
--     attivo (origin 'director'): l'ordine del titolare è l'autorizzazione.
-- In una transazione: riempie solo i campi vuoti (sito, email, telefono), scrive la
-- prova verificata con la fonte, mette l'ente VERIFIED, se c'è una città crea o
-- ritrova il luogo con la relazione, e lo porta nel CRM con tourism_promote. Un
-- passaggio nel CRM che non riesce (nome ambiguo, email già usata) NON annulla la
-- verifica: torna come motivo, da sistemare a mano, invece di bloccare tutto.

create or replace function public.tourism_activate(p_user_id uuid, p_entity_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.tourism_entities; p public.tourism_entities; origin text; city text; v_site text; v_email text; v_phone text;
  src text; quote text; fields text[]; identity uuid; coverage uuid; v_relation text; place uuid; promote jsonb;
  promote_error text; filled text[] := '{}';
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
      coverage := identity;
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
  begin
    promote := public.tourism_promote(e.id);
  exception when others then
    promote_error := sqlerrm;
  end;

  return jsonb_build_object('entity_id', e.id, 'place_id', place, 'filled', to_jsonb(filled),
    'contact_id', promote->>'contact_id', 'contact_created', coalesce((promote->>'created')::boolean, false), 'crm_error', promote_error);
end $$;

revoke all on function public.tourism_activate(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tourism_activate(uuid, uuid, jsonb) to service_role;
