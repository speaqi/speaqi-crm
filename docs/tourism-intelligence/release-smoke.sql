begin;
select set_config('request.jwt.claim.sub', (select user_id::text from public.contacts group by user_id order by count(*) desc limit 1), true);
set local role authenticated;
do $$
declare
  v_owner_id uuid := auth.uid();
  v_entity_id uuid; v_evidence_id uuid; v_contact_id uuid; v_current_version integer;
  v_payload jsonb; v_imported jsonb; v_promoted jsonb; v_repeated jsonb;
begin
  if v_owner_id is null then raise exception 'Smoke test requires an existing workspace'; end if;
  v_payload := jsonb_build_array(jsonb_build_object('kind','organization','name','Speaqi Migration Smoke '||gen_random_uuid(),'country_code','IT','type_code','dmo','email','migration-smoke@example.invalid','phone','+390000000000','evidence',jsonb_build_object('source_url','https://example.invalid/migration-smoke','title','Temporary migration verification','fields',jsonb_build_array('name','country_code','type_code','email','phone'))));
  v_imported := public.tourism_import(v_payload);
  if (v_imported->>'created')::integer <> 1 then raise exception 'Import failed'; end if;
  v_entity_id := (v_imported->'ids'->>0)::uuid;
  v_repeated := public.tourism_import(v_payload);
  if (v_repeated->>'duplicates')::integer <> 1 or (v_repeated->>'created')::integer <> 0 then raise exception 'Import idempotency failed'; end if;
  select id into v_evidence_id from public.tourism_evidence where tourism_evidence.entity_id=v_entity_id;
  select version into v_current_version from public.tourism_entities where id=v_entity_id;
  perform public.tourism_review(v_entity_id,v_evidence_id,v_current_version,true);
  if not exists(select 1 from public.tourism_entities where id=v_entity_id and status='VERIFIED') then raise exception 'Review failed'; end if;
  v_promoted := public.tourism_promote(v_entity_id);
  v_contact_id := (v_promoted->>'contact_id')::uuid;
  v_repeated := public.tourism_promote(v_entity_id);
  if v_repeated->>'contact_id' <> v_promoted->>'contact_id' or (v_repeated->>'created')::boolean then raise exception 'Promotion idempotency failed'; end if;
  if not exists(select 1 from public.contacts where id=v_contact_id and user_id=v_owner_id and marketing_eligibility='review' and email='migration-smoke@example.invalid') then raise exception 'CRM promotion guards failed'; end if;
  select version into v_current_version from public.tourism_entities where id=v_entity_id;
  perform public.tourism_sync(v_entity_id,'to_crm',v_current_version);
  perform public.tourism_sync(v_entity_id,'from_crm',v_current_version);
  if not exists(select 1 from public.tourism_entities where id=v_entity_id and status='NEEDS_REVIEW') then raise exception 'Sync invalidation failed'; end if;
  if not exists(select 1 from public.tourism_revisions where record_id=v_entity_id and user_id=v_owner_id) then raise exception 'Audit failed'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  if exists(select 1 from public.tourism_entities where id=v_entity_id) then raise exception 'Workspace RLS failed'; end if;
  perform set_config('request.jwt.claim.sub',v_owner_id::text,true);
end $$;
rollback;
select jsonb_build_object('transactional_smoke','passed','persisted_entities',(select count(*) from public.tourism_entities),'persisted_crm_links',(select count(*) from public.tourism_crm_links),'persisted_evidence',(select count(*) from public.tourism_evidence),'persisted_revisions',(select count(*) from public.tourism_revisions)) as result;
