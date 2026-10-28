#!/usr/bin/env python3
"""LeadOcean company pages -> Tourism Intelligence candidates and import SQL.

The pages come from the LeadOcean MCP (leadocean_search_companies with the
`fields` filter used below); this script only reads them from disk, so it needs
no key and no network:

python3 scripts/tourism/leadocean.py --pages 'dir/it-agencies-page-*.json' \
  --owner <workspace uuid> --out backups/tourism-acquisition/leadocean-it

Rules, all conservative:
- a company without its own website domain is held (nothing to deduplicate on);
- the type comes from the company's own name and description, never from the
  NAICS code (LeadOcean files most Italian travel agencies as hotels, 721110);
- nothing is written for a domain that Tourism Intelligence already has: the
  SQL filters those out inside the transaction, against live data;
- every entity enters UNVERIFIED with one evidence row pointing at the source.
"""
import argparse
import collections
import glob
import json
import pathlib
import re
import uuid

SHARED_DOMAINS = {'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com', 'tripadvisor.com', 'tripadvisor.it', 'booking.com', 'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'libero.it', 'linktr.ee', 'sites.google.com', 'business.site', 'wa.me', 'whatsapp.com', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'altervista.org', 'jimdo.com', 'webnode.it', 'paginegialle.it'}

# Order matters: the first rule that matches decides. Incoming/DMC first: it
# is the most specific claim and the one Speaqi sells to first.
TYPE_RULES = (
    ('cvb', re.compile(r'convention\s*(?:&|and)?\s*visitors?\s*bureau', re.I)),
    ('dmo', re.compile(r'\b(?:dmo|destination marketing|tourism board|tourist board|ente (?:del|di promozione del) turismo)\b', re.I)),
    ('dmc', re.compile(r'\b(?:dmc|destination management|incoming|receptive|inbound tour)', re.I)),
    ('tour_operator', re.compile(r'\btour[\s-]?operator', re.I)),
    ('travel_agency', re.compile(r'\b(?:agenzi[ae] (?:di )?viagg|travel agen|agenzia turistica)', re.I)),
    # Managing other people's short-stay homes: that is what makes a property
    # manager a distributor. A single holiday home is accommodation, and an
    # estate agent without short-let management is neither.
    ('property_manager', re.compile(r'property manag\w*.{0,120}(?:affitt\w* brev|short[\s-]?term|vacanz|holiday|turistic|airbnb|host|extra[\s-]?alberghier)|(?:affitt\w* brev|short[\s-]?term|vacanz|holiday|turistic|airbnb|extra[\s-]?alberghier).{0,120}property manag|gestion\w* (?:professional\w* )?(?:di |degli |delle )?(?:affitt\w* brev|case vacanz|appartamenti|immobili turistic|locazion\w* turistic|strutture extra)|\bco[\s-]?host|hosting management|short[\s-]?term rental (?:management|company|specialist)|specialized in short[\s-]?term rental', re.I)),
    ('accommodation', re.compile(r'\b(?:hotels?|resorts?|albergh\w*|holiday homes?|case vacanz\w*|casa vacanz\w*|vacation rentals?|apartments?|appartamenti|b&b|agriturism\w*|residence)\b', re.I)),
    ('tourism_supplier', re.compile(r'\b(?:tours?|escursion|visite guidate|guided|experiences?|esperienz|gite|itinerar)', re.I)),
)
# A hotel company that runs more than one property can distribute to all of them.
CHAIN_SIGNAL = re.compile(r'\b(?:hotels|resorts|alberghi|collection|group|gruppo|catena|chain|brand|hotel management company|gestione alberghier\w*|\d+\s+(?:strutture|properties|propriet\w*))\b', re.I)


def name_key(value):
    value = str(value or '').lower().translate(str.maketrans('àáâäãåèéêëìíîïòóôöõùúûüñç', 'aaaaaaeeeeiiiiooooouuuunc'))
    return re.sub(r'[\W_]+', ' ', value, flags=re.UNICODE).strip()


def clean_domain(value):
    host = str(value or '').strip().lower()
    host = re.sub(r'^[a-z]+://', '', host).split('/')[0].split('?')[0].removeprefix('www.')
    if not re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', host or ''):
        return None
    if any(host == s or host.endswith('.' + s) for s in SHARED_DOMAINS):
        return None
    return host


def clean_text(value):
    # LeadOcean returns apostrophes escaped (\\') and descriptions cut with an ellipsis.
    return re.sub(r'\s+', ' ', str(value or '').replace("\\'", "'")).strip()


def classify(name, description):
    haystack = name + ' ' + description
    for code, rule in TYPE_RULES:
        if rule.search(haystack):
            return code
    return None


def to_record(item, country):
    data = item.get('company_data') or {}
    name = clean_text(data.get('company_name'))
    domain = clean_domain(data.get('company_domain'))
    description = clean_text(data.get('company_description'))
    if not 2 <= len(name) <= 200:
        return None, 'missing_name'
    if not domain:
        return None, 'missing_domain'
    type_code = classify(name, description)
    if not type_code:
        return None, 'unclassified'
    address = data.get('company_primary_address') or {}
    if (address.get('country_code') or '').upper() != country:
        return None, 'other_country'
    linkedin = ((data.get('company_social_links') or {}).get('linkedin') or {}).get('url')
    employees = (data.get('company_employees') or {}).get('number_of_employees_code')
    industries = [i.get('name3') for i in data.get('company_industries') or [] if i.get('name3')]
    city = clean_text(address.get('city')) or None
    region = clean_text(address.get('state')) or None
    website = 'https://' + domain + '/'
    excerpt = ('Scheda azienda LeadOcean: settore ' + (', '.join(industries) or 'n.d.') + '; dipendenti ' + (employees or 'n.d.')
               + '; sede ' + ', '.join(v for v in (city, region, country) if v) + '. ' + description)[:2000]
    evidence = {
        'source_url': linkedin if linkedin and linkedin.startswith('https://www.linkedin.com/company/') else website,
        'title': ('LeadOcean — ' + name)[:200],
        'excerpt': excerpt,
        'fields': ['name', 'country_code', 'type_code', 'website'],
        'method': 'import',
    }
    record = {
        'kind': 'organization', 'name': name, 'country_code': country, 'type_code': type_code,
        'website': website, 'email': None, 'phone': None, 'aliases': [],
        'external_ids': {k: v for k, v in {'leadocean': str(data.get('company_id') or ''), 'linkedin': linkedin}.items() if v},
        'details': {
            'description': description[:2000], 'domain': domain, 'hq_city': city, 'hq_region': region,
            'employees': employees, 'industries': industries,
            'decision_makers': data.get('company_number_of_decision_makers'),
            'hotel_group': bool(type_code == 'accommodation' and CHAIN_SIGNAL.search(name + ' ' + description)),
            'acquisition': {'source': 'leadocean', 'self_reported': False, 'classification_rule': 'leadocean_name_description_keywords'},
        },
        'evidence': evidence,
    }
    return record, None


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def import_sql(records, owner):
    """One transaction per batch. Records whose domain is already in the catalogue
    are dropped inside the transaction, so a rerun never duplicates."""
    payload = json.dumps(records, ensure_ascii=False, separators=(',', ':'))
    tag = '$speaqi_leadocean$'
    while tag in payload:
        tag = tag[:-1] + '_$'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
select pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-catalog-acquisition'));
do {tag}
declare v_records jsonb; v_result jsonb;
begin
  select coalesce(jsonb_agg(r.value),'[]'::jsonb) into v_records
  from jsonb_array_elements({literal(payload)}::jsonb) r
  where not exists (
    select 1 from public.tourism_entities e
    where e.user_id=auth.uid() and e.kind='organization'
      and lower(regexp_replace(split_part(regexp_replace(coalesce(e.website,''),'^https?://','','i'),'/',1),'^www\\.','','i'))=r.value->'details'->>'domain');
  if jsonb_array_length(v_records)>0 then
    v_result := public.tourism_import(v_records);
    raise notice 'leadocean batch: % created, % duplicates by name, % skipped by domain',
      v_result->>'created', v_result->>'duplicates', {len(records)}-jsonb_array_length(v_records);
  end if;
end {tag};
commit;
"""


def compact_sql(records, owner):
    """Same import as import_sql, with each record sent as a short array and
    rebuilt inside Postgres. Used when the SQL has to travel through a tool
    call instead of psql: about a quarter of the size, same result."""
    rows = []
    for r in records:
        d = r['details']
        linkedin = r['external_ids'].get('linkedin') or ''
        rows.append([r['external_ids'].get('leadocean', ''), r['name'], r['type_code'], d['domain'],
                     linkedin.removeprefix('https://www.linkedin.com/company/'), d['hq_city'] or '', d['hq_region'] or '',
                     d['employees'] or '', ', '.join(d['industries']), 1 if d['hotel_group'] else 0, d['description'][:160]])
    payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'))
    tag = '$speaqi_leadocean$'
    while tag in payload:
        tag = tag[:-1] + '_$'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
select pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-catalog-acquisition'));
do {tag}
declare v_records jsonb; v_result jsonb; v_rows jsonb := {literal(payload)}::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind','organization','name',x->>1,'country_code','IT','type_code',x->>2,
    'website','https://'||(x->>3)||'/','aliases','[]'::jsonb,
    'external_ids',jsonb_strip_nulls(jsonb_build_object('leadocean',nullif(x->>0,''),
      'linkedin',case when x->>4<>'' then 'https://www.linkedin.com/company/'||(x->>4) end)),
    'details',jsonb_build_object('description',x->>10,'domain',x->>3,'hq_city',nullif(x->>5,''),'hq_region',nullif(x->>6,''),
      'employees',nullif(x->>7,''),'industries',x->>8,'hotel_group',(x->>9)='1',
      'acquisition',jsonb_build_object('source','leadocean','self_reported',false,'classification_rule','leadocean_name_description_keywords')),
    'evidence',jsonb_build_object(
      'source_url',case when x->>4<>'' then 'https://www.linkedin.com/company/'||(x->>4) else 'https://'||(x->>3)||'/' end,
      'title',left('LeadOcean — '||(x->>1),200),
      'excerpt',left('Scheda azienda LeadOcean: settore '||coalesce(nullif(x->>8,''),'n.d.')||'; dipendenti '||coalesce(nullif(x->>7,''),'n.d.')
        ||'; sede '||concat_ws(', ',nullif(x->>5,''),nullif(x->>6,''),'IT')||'. '||(x->>10),2000),
      'fields',jsonb_build_array('name','country_code','type_code','website'),'method','import'))),'[]'::jsonb)
  into v_records
  from jsonb_array_elements(v_rows) x
  where not exists (
    select 1 from public.tourism_entities e
    where e.user_id=auth.uid() and e.kind='organization'
      and lower(regexp_replace(split_part(regexp_replace(coalesce(e.website,''),'^https?://','','i'),'/',1),'^www\\.','','i'))=x->>3);
  if jsonb_array_length(v_records)>0 then
    v_result := public.tourism_import(v_records);
    raise notice 'leadocean batch: % created, % duplicates by name, % skipped by domain',
      v_result->>'created', v_result->>'duplicates', jsonb_array_length(v_rows)-jsonb_array_length(v_records);
  end if;
end {tag};
commit;
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pages', required=True, help='glob of JSON arrays saved from leadocean_search_companies')
    parser.add_argument('--owner', required=True)
    parser.add_argument('--country', default='IT')
    parser.add_argument('--out', required=True)
    parser.add_argument('--batch-size', type=int, default=100)
    parser.add_argument('--compact', action='store_true', help='short-array SQL, for running through a tool call')
    args = parser.parse_args()
    owner = str(uuid.UUID(args.owner))
    country = args.country.upper()
    items = [item for path in sorted(glob.glob(args.pages)) for item in json.loads(pathlib.Path(path).read_text())]
    held = collections.Counter()
    records, seen_domains, seen_names = [], set(), set()
    for item in items:
        record, reason = to_record(item, country)
        if not record:
            held[reason] += 1
            continue
        domain, key = record['details']['domain'], name_key(record['name'])
        if domain in seen_domains or key in seen_names:
            held['duplicate_in_source'] += 1
            continue
        seen_domains.add(domain)
        seen_names.add(key)
        records.append(record)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'candidates.json').write_text(json.dumps(records, ensure_ascii=False, indent=1) + '\n')
    for stale in out.glob('import-*.sql'):
        stale.unlink()
    for index in range(0, len(records), args.batch_size):
        build = compact_sql if args.compact else import_sql
        (out / f'import-{index // args.batch_size:04}.sql').write_text(build(records[index:index + args.batch_size], owner))
    report = {'items': len(items), 'records': len(records), 'held': dict(held),
              'types': dict(collections.Counter(r['type_code'] for r in records))}
    (out / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
