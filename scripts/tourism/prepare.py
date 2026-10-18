#!/usr/bin/env python3
"""Prepare inspectable, transactional SQL; no network access or credentials needed."""
import argparse
import json
import pathlib
import re
import uuid

from acquire import Acquisition, SHARED_DOMAINS


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def import_sql(records, owner):
    payload = json.dumps(records, ensure_ascii=False, separators=(',', ':'))
    tag = '$speaqi_catalog_ingest$'
    while tag in payload:
        tag = tag[:-1] + '_$'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
select pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-catalog-acquisition'));
do {tag}
declare v_records jsonb := {literal(payload)}::jsonb; v_record jsonb; v_source jsonb; v_entity_id uuid;
begin
  perform public.tourism_import(v_records);
  for v_record in select value from jsonb_array_elements(v_records) loop
    select id into v_entity_id from public.tourism_entities where user_id=auth.uid() and kind=v_record->>'kind' and country_code=v_record->>'country_code' and name_key=public.tourism_name_key(v_record->>'name');
    if v_entity_id is null then raise exception 'Import result not found'; end if;
    for v_source in select value from jsonb_array_elements(v_record->'source_evidence') loop
      insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method)
      select auth.uid(),v_entity_id,v_source->>'source_url',v_source->>'title',coalesce(v_source->>'excerpt',''),array(select jsonb_array_elements_text(v_source->'fields')),'import'
      where not exists(select 1 from public.tourism_evidence where user_id=auth.uid() and entity_id=v_entity_id and source_url=v_source->>'source_url' and fields=array(select jsonb_array_elements_text(v_source->'fields')));
    end loop;
  end loop;
end {tag};
commit;
"""


def matching_sql(owner, countries):
    excluded = ','.join(literal(value) for value in sorted(SHARED_DOMAINS))
    country_map = literal(json.dumps(countries, ensure_ascii=False)) + '::jsonb'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
set local statement_timeout='90s';
select pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-crm-matching'));
with crm as materialized (
  select id,public.tourism_name_key(coalesce(nullif(btrim(company),''),name)) as name_key,
    coalesce(({country_map})->>public.tourism_name_key(country),case when btrim(country)~'^[A-Za-z]{{2}}$' then upper(btrim(country)) end) as country,
    lower(regexp_replace(split_part(regexp_replace(coalesce(normalized_website,''),'^https?://','','i'),'/',1),'^www\\.','','i')) as website_domain,
    lower(split_part(coalesce(email,''),'@',2)) as email_domain
  from public.contacts where user_id=auth.uid()
), entities as materialized (
  select id,country_code,name_key,aliases,name,
    lower(regexp_replace(split_part(regexp_replace(coalesce(website,''),'^https?://','','i'),'/',1),'^www\\.','','i')) as website_domain,
    lower(split_part(coalesce(email,''),'@',2)) as email_domain
  from public.tourism_entities where user_id=auth.uid() and kind='organization' and status not in ('INACTIVE','DUPLICATE')
    and coalesce(details#>>'{{acquisition,classification_rule}}','') not in ('scope_requires_review','identity_requires_review')
), names as materialized (
  select e.id,e.country_code,public.tourism_name_key(n) as name_key from entities e cross join lateral unnest(array_prepend(e.name,e.aliases)) n
), org_domains as materialized (
  select distinct e.id,e.country_code,d as domain from entities e cross join lateral unnest(array[e.website_domain,e.email_domain]) d
  where d<>'' and d not in ({excluded}) and d !~ '(^|\\.)(facebook|instagram|linkedin|youtube|tripadvisor|booking)\\.'
), contact_domains as materialized (
  select id,country,d as domain,rule from crm cross join lateral (values(website_domain,'website_domain'),(email_domain,'email_domain')) as x(d,rule)
  where d<>'' and d not in ({excluded})
), raw_matches as (
  select n.id as entity_id,c.id as contact_id,case when c.country=n.country_code then 'name_country' else 'name' end as rule,
    case when c.country=n.country_code then 100 else 85 end as score
    from names n join crm c on c.name_key=n.name_key where c.name_key<>'' and (c.country=n.country_code or c.country is null)
  union all
  select d.id,c.id,c.rule,case when c.country=d.country_code then 97 else 90 end
    from org_domains d join contact_domains c on c.domain=d.domain where c.country=d.country_code or c.country is null
), per_contact as (
  select *,row_number() over(partition by entity_id,contact_id order by score desc,rule) as best from raw_matches
), ranked as (
  select *,row_number() over(partition by entity_id order by score desc,contact_id) as rank from per_contact where best=1
), fresh as materialized (select * from ranked where rank<=5), removed as (
  delete from public.tourism_crm_matches m where m.user_id=auth.uid() and m.state='candidate'
    and not exists(select 1 from fresh f where f.entity_id=m.entity_id and f.contact_id=m.contact_id) returning id
), inserted as (
  insert into public.tourism_crm_matches(user_id,entity_id,contact_id,rule,score)
  select auth.uid(),entity_id,contact_id,rule,score from fresh
  on conflict(user_id,entity_id,contact_id) do update set rule=excluded.rule,score=excluded.score,matched_at=now()
  where tourism_crm_matches.state='candidate'
  returning entity_id
)
select jsonb_build_object('candidate_pairs',count(*),'organizations',count(distinct entity_id),'stale_suggestions_removed',(select count(*) from removed)) as matching from inserted;
commit;
"""


def coverage_sql(records,edges,owner):
    identities={}
    for record in records:
        if record['kind']!='organization':
            continue
        for source in record.get('source_evidence',[record['evidence']]):
            match=re.fullmatch(r'https://www.wikidata.org/wiki/(Q\d+)',source['source_url'])
            if match and 'name' in source['fields'] and 'type_code' in source['fields']:
                identities[(record['country_code'],match[1])]=record
    payload=[]
    for edge in edges:
        record=identities.get((edge['organization_country'],edge['organization_wikidata']))
        if not record:
            raise ValueError('Unresolved sourced organization: '+edge['organization_wikidata'])
        payload.append({'name':record['name'],'organization_country':record['country_code'],'covered_country':edge['covered_country'],'source_url':edge['source_url']})
    raw=json.dumps(payload,ensure_ascii=False)
    tag='$speaqi_explicit_coverage$'
    while tag in raw:
        tag=tag[:-1]+'_$'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
do {tag}
declare v_edges jsonb := {literal(raw)}::jsonb; v_edge jsonb; v_org uuid; v_country uuid; v_evidence uuid;
begin
 for v_edge in select value from jsonb_array_elements(v_edges) loop
  select id into strict v_org from public.tourism_entities where user_id=auth.uid() and kind='organization' and country_code=v_edge->>'organization_country' and name_key=public.tourism_name_key(v_edge->>'name');
  select id into strict v_country from public.tourism_entities where user_id=auth.uid() and kind='place' and details->>'place_level'='country' and country_code=v_edge->>'covered_country';
  select id into v_evidence from public.tourism_evidence where user_id=auth.uid() and entity_id=v_org and source_url=v_edge->>'source_url' and fields @> array['coverage','relationship'] order by acquired_at limit 1;
  if v_evidence is null then
   insert into public.tourism_evidence(user_id,entity_id,source_url,title,excerpt,fields,method)
   values(auth.uid(),v_org,v_edge->>'source_url','Wikidata: giurisdizione esplicita P1001','Paese / territorio esplicitamente dichiarato in P1001: '||(v_edge->>'covered_country')||'. Nessuna copertura dedotta dalla sede.',array['coverage','relationship'],'import') returning id into v_evidence;
  end if;
  insert into public.tourism_relations(user_id,from_id,to_id,relation,evidence_id) values(auth.uid(),v_org,v_country,'COVERS',v_evidence) on conflict(user_id,from_id,to_id,relation) do nothing;
 end loop;
end {tag};
commit;
select count(*) as sourced_relations from public.tourism_relations where user_id={literal(owner)};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--owner', required=True)
    parser.add_argument('--input', default='backups/tourism-acquisition/candidates-validated.json')
    parser.add_argument('--out', default='backups/tourism-acquisition/sql')
    parser.add_argument('--coverage',nargs='*',default=[])
    parser.add_argument('--batch-size',type=int,default=30)
    args = parser.parse_args()
    if not 1<=args.batch_size<=200:
        parser.error('--batch-size must be between 1 and 200')
    owner = str(uuid.UUID(args.owner))
    rows = json.loads(pathlib.Path(args.input).read_text())
    rows.sort(key=lambda record: 0 if record['kind'] == 'organization' else 1)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    batches=(len(rows)+args.batch_size-1)//args.batch_size
    for stale in out.glob('import-[0-9][0-9][0-9][0-9].sql'):
        if int(stale.stem.split('-')[1])>=batches:
            stale.unlink()
    for index in range(0, len(rows), args.batch_size):
        (out / f'import-{index//args.batch_size:04}.sql').write_text(import_sql(rows[index:index+args.batch_size], owner))
    countries = Acquisition(out / 'metadata').country_names
    countries.update({'italia':'IT','francia':'FR','germania':'DE','regno unito':'GB','stati uniti':'US','spagna':'ES','paesi bassi':'NL','grecia':'GR'})
    (out / 'matching.sql').write_text(matching_sql(owner, countries))
    if args.coverage:
        edges=[edge for file in args.coverage for edge in json.loads(pathlib.Path(file).read_text())]
        (out/'coverage.sql').write_text(coverage_sql(rows,edges,owner))
    print(json.dumps({'records':len(rows),'import_batches':batches,'matching_sql':str(out/'matching.sql')}))


if __name__ == '__main__':
    main()
