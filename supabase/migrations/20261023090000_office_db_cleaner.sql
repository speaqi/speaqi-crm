-- Agente 05 — Pulizia del database.
-- L'agente legge e propone; l'unione dei doppioni parte solo quando il titolare
-- approva la proposta, dentro la stessa transazione della decisione. Nessun DELETE:
-- il contatto assorbito resta, nascosto, con una nota che dice dove e' finito.

create or replace function public.office_email_key(p_email text)
returns text language sql immutable set search_path = '' as $$
  select case when lower(trim(coalesce(p_email, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    then lower(trim(p_email)) end;
$$;

-- Un numero italiano si scrive in molti modi: +39 333…, 0039 333…, 333 … .
-- La chiave e' il numero con prefisso, solo cifre. Sotto le 8 cifre non e' un numero.
create or replace function public.office_phone_key(p_phone text)
returns text language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if d like '00%' then d := substr(d, 3); end if;
  if length(d) between 9 and 10 and left(d, 1) in ('0', '3') then d := '39' || d; end if;
  if length(d) < 8 or d ~ '^(\d)\1+$' then return null; end if;
  return d;
end;
$$;

create or replace function public.office_company_key(p_company text, p_city text)
returns text language sql immutable set search_path = '' as $$
  select case when length(trim(coalesce(p_company, ''))) >= 3 and length(trim(coalesce(p_city, ''))) >= 2
    then regexp_replace(lower(trim(p_company)), '[^a-z0-9]+', ' ', 'g') || '|' || lower(trim(p_city)) end;
$$;

-- Gruppi di contatti visibili con la stessa chiave. I nascosti non contano:
-- un contatto gia' unito e' nascosto e non deve ricomparire.
create or replace function public.office_cleaner_duplicate_keys(p_user_id uuid, p_limit integer default 3000)
returns table(kind text, key text, ids uuid[])
language sql stable security definer set search_path = '' as $$
  with visible as (
    select c.id, c.email, c.phone, c.company, c.billing_city, c.created_at
    from public.contacts c where c.user_id = p_user_id and coalesce(c.hidden, false) = false
  ), keyed as (
    select 'email'::text kind, public.office_email_key(email) key, id, created_at from visible
    union all select 'phone', public.office_phone_key(phone), id, created_at from visible
    union all select 'company', public.office_company_key(company, billing_city), id, created_at from visible
  )
  select kind, key, array_agg(id order by created_at, id) ids from keyed
  where key is not null group by kind, key having count(*) between 2 and 20
  order by count(*) desc, kind, key limit greatest(1, least(p_limit, 10000));
$$;

-- Quanto pesa ogni contatto: serve a scegliere quale tenere.
create or replace function public.office_cleaner_contacts(p_user_id uuid, p_ids uuid[])
returns table(id uuid, name text, email text, phone text, company text, billing_city text, status text,
  contact_scope text, created_at timestamptz, activities bigint, tasks bigint, deals bigint, open_deals bigint,
  quotes bigint, drafts bigint, emails bigint, in_sequence boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, c.email, c.phone, c.company, c.billing_city, c.status, c.contact_scope, c.created_at,
    (select count(*) from public.activities a where a.contact_id = c.id),
    (select count(*) from public.tasks t where t.contact_id = c.id),
    (select count(*) from public.deals d where d.contact_id = c.id),
    (select count(*) from public.deals d where d.contact_id = c.id and d.closed_at is null),
    (select count(*) from public.quotes q where q.contact_id = c.id),
    (select count(*) from public.email_drafts e where e.contact_id = c.id),
    (select count(*) from public.gmail_messages g where g.contact_id = c.id),
    exists(select 1 from public.commercial_enrollments ce where ce.contact_id = c.id and ce.status in ('pending', 'active'))
      or exists(select 1 from public.wine_project_followup_events w where w.contact_id = c.id and w.status in ('scheduled', 'queued', 'processing'))
  from public.contacts c
  where c.user_id = p_user_id and c.id = any(p_ids) and coalesce(c.hidden, false) = false;
$$;

-- Le altre categorie: numeri esatti e un campione da leggere.
create or replace function public.office_cleaner_scan(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select * from public.contacts where user_id = p_user_id and coalesce(hidden, false) = false
  ), invalid_email as (
    select id, name, email from c where nullif(trim(email), '') is not null and public.office_email_key(email) is null
  ), role_email as (
    select id, name, email from c where public.office_email_key(email) ~ '^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?)[@.+-]'
  ), pec_email as (
    select id, name, email from c where public.office_email_key(email) ~ '@(pec\.|.*\.pec\.|legalmail\.|.*\.legalmail\.|postecert\.|arubapec\.|pecaruba\.|cert\.)'
      or public.office_email_key(email) ~ '@[^@]*pec[^@]*\.(it|eu)$'
  ), stale as (
    select id, name, status, coalesce(last_contact_at, updated_at, created_at) last_seen from c
    where coalesce(contact_scope, 'crm') = 'crm' and lower(status) not in ('closed', 'paid', 'lost', 'not_interested')
      and coalesce(last_contact_at, updated_at, created_at) < now() - interval '90 days'
      and coalesce(next_followup_at, next_action_at) is null
      and not exists (select 1 from public.tasks t where t.contact_id = c.id and t.status = 'pending')
  ), old_quotes as (
    select q.id, q.title, q.created_at from public.quotes q where q.user_id = p_user_id and q.status = 'draft'
      and q.created_at < now() - interval '60 days'
  ), open_on_closed as (
    select d.id, d.title, c.name, c.status from public.deals d join c on c.id = d.contact_id
    where d.user_id = p_user_id and d.closed_at is null and lower(c.status) in ('closed', 'paid', 'lost', 'not_interested')
  ), entity_dupes as (
    select kind, country_code, regexp_replace(regexp_replace(lower(name_key),
      '\m(comune|citta|di|del|della|dei|delle|the|of|city|municipality|provincia|regione|ente|turismo|tourism|board|visit)\M', ' ', 'g'),
      '[^a-z0-9]+', '', 'g') k, array_agg(id order by created_at) ids, array_agg(name order by created_at) names
    from public.tourism_entities where user_id = p_user_id and coalesce(disabled, false) = false and coalesce(name_key, '') <> ''
    group by 1, 2, 3 having count(*) > 1 and length(regexp_replace(regexp_replace(lower(min(name_key)),
      '\m(comune|citta|di|del|della|dei|delle|the|of|city|municipality|provincia|regione|ente|turismo|tourism|board|visit)\M', ' ', 'g'),
      '[^a-z0-9]+', '', 'g')) >= 3
  )
  select jsonb_build_object(
    'invalid_emails', jsonb_build_object('count', (select count(*) from invalid_email), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from invalid_email order by name limit 100) x), '[]')),
    'role_emails', jsonb_build_object('count', (select count(*) from role_email), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from role_email order by name limit 100) x), '[]')),
    'pec_emails', jsonb_build_object('count', (select count(*) from pec_email), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pec_email order by name limit 100) x), '[]')),
    'stale_pipeline', jsonb_build_object('count', (select count(*) from stale), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from stale order by last_seen limit 100) x), '[]')),
    'old_draft_quotes', jsonb_build_object('count', (select count(*) from old_quotes), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from old_quotes order by created_at limit 100) x), '[]')),
    'open_deals_on_closed', jsonb_build_object('count', (select count(*) from open_on_closed), 'sample', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from open_on_closed limit 100) x), '[]')),
    'tourism_near_duplicates', jsonb_build_object('count', (select count(*) from entity_dupes), 'sample', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'country', country_code, 'ids', ids, 'names', names)) from (select * from entity_dupes limit 100) x), '[]'))
  );
$$;

-- Unione: tutto quello che parla del contatto assorbito passa a quello tenuto.
-- Restano dove sono solo i legami che non si possono spostare senza perdere
-- significato: sequenze e iscrizioni alle campagne (legate a quella scheda),
-- memoria AI, abbinamenti Tourism (identita' immutabile), tentativi di invio.
create or replace function public.office_merge_contacts(p_user_id uuid, p_keep uuid, p_drop uuid[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  keep_row public.contacts; d uuid; drop_row public.contacts; moved jsonb := '{}'::jsonb; n bigint; total bigint := 0;
  open_count integer;
begin
  if p_keep is null or p_drop is null or cardinality(p_drop) = 0 or cardinality(p_drop) > 20 or p_keep = any(p_drop)
    or (select count(distinct x) from unnest(p_drop) x) <> cardinality(p_drop) then
    raise exception 'Unione non valida';
  end if;
  -- Ordine stabile dei lock: nessuno stallo fra due unioni che si incrociano.
  perform 1 from public.contacts where id = p_keep or id = any(p_drop) order by id for update;
  select * into keep_row from public.contacts where id = p_keep and user_id = p_user_id;
  if not found or coalesce(keep_row.hidden, false) then raise exception 'Il contatto da tenere non c''e'' piu'' o e'' nascosto'; end if;
  if (select count(*) from public.contacts where id = any(p_drop) and user_id = p_user_id and coalesce(hidden, false) = false) <> cardinality(p_drop) then
    raise exception 'Uno dei contatti da unire non c''e'' piu'' o e'' gia'' stato unito';
  end if;
  select count(*) into open_count from public.deals where (contact_id = p_keep or contact_id = any(p_drop)) and closed_at is null;
  if open_count > 1 then
    raise exception 'Ci sono % trattative aperte su questi contatti: chiudine a mano finche'' ne resta una, poi riapprova', open_count;
  end if;

  update public.activities set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('activities', n); total := total + n;
  update public.tasks set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('tasks', n); total := total + n;
  update public.deals set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('deals', n); total := total + n;
  update public.quotes set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('quotes', n); total := total + n;
  update public.invoices set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('invoices', n); total := total + n;
  -- Una bozza automatica per contatto e orario: una per volta, cosi' due doppioni con
  -- la stessa ora non si scontrano fra loro. Quella che si scontrerebbe resta sul doppione.
  foreach d in array p_drop loop
    update public.email_drafts set contact_id = p_keep where contact_id = d
      and not (source = 'auto' and scheduled_for is not null and exists (select 1 from public.email_drafts k
        where k.contact_id = p_keep and k.source = 'auto' and k.scheduled_for = email_drafts.scheduled_for));
    get diagnostics n = row_count; total := total + n;
    moved := moved || jsonb_build_object('email_drafts', coalesce((moved->>'email_drafts')::bigint, 0) + n);
  end loop;
  update public.gmail_messages set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('gmail_messages', n); total := total + n;
  update public.stage_transitions set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('stage_transitions', n);
  update public.ai_decision_logs set lead_id = p_keep where lead_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('ai_decision_logs', n);
  update public.agency_projects set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('agency_projects', n); total := total + n;
  update public.trade_fair_exhibitors set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('trade_fair_exhibitors', n);
  update public.shipping_companies set contact_id = p_keep where contact_id = any(p_drop); get diagnostics n = row_count; moved := moved || jsonb_build_object('shipping_companies', n);
  update public.whatsapp_notification_events set contact_id = p_keep where contact_id = any(p_drop);
  -- Un legame con un ente non piu' verificato verrebbe rifiutato dal suo trigger: resta dov'e'.
  update public.tourism_crm_links l set contact_id = p_keep where l.contact_id = any(p_drop)
    and exists (select 1 from public.tourism_entities e where e.id = l.entity_id and e.user_id = p_user_id and e.kind = 'organization' and e.status = 'VERIFIED');
  get diagnostics n = row_count; moved := moved || jsonb_build_object('tourism_crm_links', n);
  update public.contact_map_links l set contact_id = p_keep where l.contact_id = any(p_drop)
    and not exists (select 1 from public.contact_map_links k where k.user_id = l.user_id and k.contact_id = p_keep and k.map_ref = l.map_ref);
  get diagnostics n = row_count; moved := moved || jsonb_build_object('contact_map_links', n);

  foreach d in array p_drop loop
    select * into drop_row from public.contacts where id = d;
    -- Sul contatto tenuto si riempiono solo i campi vuoti: niente si sovrascrive.
    update public.contacts set
      email = coalesce(nullif(trim(email), ''), drop_row.email),
      phone = coalesce(nullif(trim(phone), ''), drop_row.phone),
      company = coalesce(nullif(trim(company), ''), drop_row.company),
      country = coalesce(nullif(trim(country), ''), drop_row.country),
      billing_tax_id = coalesce(nullif(trim(billing_tax_id), ''), drop_row.billing_tax_id),
      billing_pec = coalesce(nullif(trim(billing_pec), ''), drop_row.billing_pec),
      billing_sdi = coalesce(nullif(trim(billing_sdi), ''), drop_row.billing_sdi),
      billing_address = coalesce(nullif(trim(billing_address), ''), drop_row.billing_address),
      billing_zip = coalesce(nullif(trim(billing_zip), ''), drop_row.billing_zip),
      billing_city = coalesce(nullif(trim(billing_city), ''), drop_row.billing_city),
      normalized_website = coalesce(nullif(trim(normalized_website), ''), drop_row.normalized_website),
      email_unsubscribed_at = coalesce(email_unsubscribed_at, drop_row.email_unsubscribed_at),
      email_unsubscribe_source = coalesce(email_unsubscribe_source, drop_row.email_unsubscribe_source),
      alternative_emails = (select coalesce(array_agg(distinct e), '{}') from unnest(coalesce(alternative_emails, '{}') ||
        case when public.office_email_key(drop_row.email) is not null and public.office_email_key(drop_row.email) is distinct from public.office_email_key(keep_row.email)
          then array[lower(trim(drop_row.email))] else '{}'::text[] end || coalesce(drop_row.alternative_emails, '{}')) e
        where nullif(trim(e), '') is not null and public.office_email_key(e) is distinct from public.office_email_key(keep_row.email))
    where id = p_keep;
    update public.contacts set hidden = true,
      note = concat_ws(E'\n', nullif(note, ''), format('[Unito in %s il %s dall''Ufficio]', p_keep, to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY')))
    where id = d;
  end loop;

  insert into public.activities(user_id, contact_id, type, content, metadata)
  values (p_user_id, p_keep, 'note', format('Uniti %s contatti doppi in questo (%s righe spostate).', cardinality(p_drop), total),
    jsonb_build_object('source', 'office_db_cleaner', 'merged_ids', to_jsonb(p_drop), 'moved', moved, 'reason', p_reason));
  return jsonb_build_object('keep', p_keep, 'merged', to_jsonb(p_drop), 'moved', moved);
end;
$$;

-- La decisione del titolare resta una sola RPC. Al ramo del Direttore si aggiunge
-- quello della pulizia: approvare un lotto di doppioni esegue le unioni nella stessa
-- transazione. Un gruppo che nel frattempo e' cambiato si salta e si dice perche';
-- se nessun gruppo si puo' unire la proposta resta da decidere.
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
  update public.office_agent_outputs set status=p_status,decided_at=now() where id=o.id returning * into o;
  return jsonb_build_object('output',to_jsonb(o));
end;
$$;

do $$
declare f regprocedure;
begin
  for f in select oid::regprocedure from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('office_cleaner_duplicate_keys','office_cleaner_contacts','office_cleaner_scan','office_merge_contacts','decide_office_output') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
