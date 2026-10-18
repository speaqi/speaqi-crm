#!/usr/bin/env python3
"""Reproducible public-source acquisition; writes candidates, never CRM contacts.

python -m venv /tmp/speaqi-tourism-venv
/tmp/speaqi-tourism-venv/bin/pip install -r scripts/tourism/requirements.txt
/tmp/speaqi-tourism-venv/bin/python scripts/tourism/acquire.py
"""
import argparse
import collections
import datetime as dt
import hashlib
import html
import ipaddress
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

import pycountry

UA = 'SpeaqiTourismCatalog/1.0 (+https://speaqi.com)'
EDITIONS = ('london', 'atm', 'latin-america')
ALLOWED_SEARCH_HOST = 'xd0u5m6y4r-dsn.algolia.net'
SIMPLE_EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
GENERIC_MAILBOX = re.compile(r'^(info|office|contact|booking|sales|marketing|administration|enquiries|enquiry|inquiries|tourism|tourisme|turismo|secretariat|hello|welcome|reservas|reservations|incoming|reception|assistance|support|communication|comunicazione|segreteria|commerciale|press|bureau|general|service|admin|inbound)([._+\-].*)?$')
COUNTRY_ALIASES = {'united kingdom the': 'GB', 'united kingdom': 'GB', 'united states of america': 'US', 'united states': 'US', 'korea the republic of': 'KR', 'korea republic of': 'KR', 'south korea': 'KR', 'north korea': 'KP', 'taiwan': 'TW', 'taiwan province of china': 'TW', 'netherlands kingdom of the': 'NL', 'netherlands': 'NL', 'tanzania the united republic of': 'TZ', 'tanzania': 'TZ', 'cote d ivoire': 'CI', 'republic of moldova': 'MD', 'moldova': 'MD', 'bahamas the': 'BS', 'dominican republic the': 'DO', 'turkiye': 'TR', 'turkey': 'TR', 'kosovo': 'XK', 'iran islamic republic of': 'IR', 'venezuela bolivarian republic of': 'VE', 'bolivia plurinational state of': 'BO', 'vietnam': 'VN', 'viet nam': 'VN', 'russia': 'RU', 'laos': 'LA', 'syria': 'SY', 'palestine': 'PS'}
SHARED_DOMAINS = {'facebook.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'twitter.com', 'x.com', 'tripadvisor.com', 'booking.com', 'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'linktr.ee', 'sites.google.com', 'business.site', 'wa.me', 'whatsapp.com'}


COUNTRY_ALIASES.update({'northern macedonia':'MK','cape verde':'CV','falkland islands':'FK','saint martin':'MF'})


def name_key(value):
    value = str(value or '').lower().translate(str.maketrans('àáâäãåèéêëìíîïòóôöõùúûüñç', 'aaaaaaeeeeiiiiooooouuuunc'))
    return re.sub(r'[\W_]+', ' ', value, flags=re.UNICODE).strip()


def text(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', str(value or '')))).strip()


def public_url(value):
    value = str(value or '').strip()
    if value and not re.match(r'^[a-z]+://', value, re.I):
        value = 'https://' + value
    try:
        url = urllib.parse.urlsplit(value)
        host = (url.hostname or '').lower()
        if url.scheme not in ('http', 'https') or url.username or url.password or not host or '.' not in host or re.search(r'\s', value) or url.port not in (None, 80, 443):
            return None
        if host.endswith(('.local', '.internal', '.localhost', '.test')):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        return urllib.parse.urlunsplit((url.scheme, url.netloc, url.path or '/', url.query, ''))[:2000]
    except ValueError:
        return None


def domain(value):
    url = public_url(value)
    host = urllib.parse.urlsplit(url).hostname.lower().removeprefix('www.') if url else ''
    return '' if any(host == s or host.endswith('.' + s) for s in SHARED_DOMAINS) else host


def institutional_email(value):
    value = str(value or '').strip().lower()
    return value if len(value) <= 254 and SIMPLE_EMAIL.fullmatch(value) and GENERIC_MAILBOX.fullmatch(value.split('@')[0]) else None


class Acquisition:
    def __init__(self, root, refresh=False):
        self.root = pathlib.Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.refresh = refresh
        self.receipts = []
        self.now = dt.datetime.now(dt.timezone.utc).isoformat()
        self.country_names = dict(COUNTRY_ALIASES)
        self.valid_codes = {c.alpha_2 for c in pycountry.countries} | {'XK'}
        for c in pycountry.countries:
            for value in (c.name, getattr(c, 'official_name', ''), getattr(c, 'common_name', ''), c.alpha_2, c.alpha_3):
                if value:
                    self.country_names[name_key(value)] = c.alpha_2

    def save(self, name, payload):
        path = self.root / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
        return path

    def cached(self, path):
        return path.exists() and not self.refresh and 0 <= time.time() - path.stat().st_mtime <= 86400

    def request(self, url, payload=None, headers=None):
        body = json.dumps(payload).encode() if payload is not None else None
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, data=body, headers={'User-Agent': UA, 'Accept': 'application/json,text/html;q=0.9', **({'Content-Type': 'application/json'} if body else {}), **(headers or {})})
                with urllib.request.urlopen(req, timeout=50) as response:
                    raw = response.read(30_000_001)
                    if len(raw) > 30_000_000:
                        raise ValueError('Source response exceeds 30 MB limit')
                    return raw
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    raise
                time.sleep(min(10, max(1, int(error.headers.get('Retry-After', '2'))) * (attempt + 1)))
            except (TimeoutError, urllib.error.URLError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))

    def sparql(self, name, query):
        path = self.root / ('wikidata-' + name + '.json')
        url = 'https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': query, 'format': 'json'})
        query_hash = hashlib.sha256(query.encode()).hexdigest()
        reused = self.cached(path)
        data = json.loads(path.read_text()) if reused else None
        if data and data.get('_speaqi_query_sha256') not in (None, query_hash):
            reused = False
        if not reused:
            raw = self.request(url, headers={'Accept': 'application/sparql-results+json'})
            data = json.loads(raw)
            data['_speaqi_query_sha256'] = query_hash
            self.save(path.name, data)
            time.sleep(.5)
        self.receipts.append({'source': 'wikidata:' + name, 'url': url, 'retrieved_at': dt.datetime.fromtimestamp(path.stat().st_mtime,dt.timezone.utc).isoformat(), 'rows': len(data['results']['bindings']), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'query_sha256': data.get('_speaqi_query_sha256'), 'cache_reused': reused, 'license': 'CC0', 'complete_for_response': True})
        return data['results']['bindings']

    def country_code(self, value):
        return self.country_names.get(name_key(value))

    def configuration(self, edition):
        path = self.root / ('wtm-config.json' if edition == 'london' else 'wtm-' + edition + '-config.json')
        page_url = 'https://www.wtm.com/' + edition + '/en-gb/exhibitor-directory.html'
        if self.cached(path):
            return json.loads(path.read_text())['props'], page_url
        raw = self.request(page_url).decode()
        match = re.search(r'var reactSettings = JSON.parse\("(.*?)"\);', raw)
        if not match:
            raise ValueError('Public directory configuration missing')
        settings = json.loads(re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m[1], 16)), match[1]).replace('\\/', '/'))
        self.save(path.name, settings)  # Browser-visible search-only key; this directory is ignored by Git.
        return settings['props'], page_url

    def wtm(self, edition):
        props, source_url = self.configuration(edition)
        robots_path = self.root / 'wtm-robots.txt'
        robots_text = robots_path.read_text() if self.cached(robots_path) else self.request('https://www.wtm.com/robots.txt').decode()
        robots = urllib.robotparser.RobotFileParser()
        robots.parse(robots_text.splitlines())
        if not robots.can_fetch(UA, source_url):
            raise ValueError('Directory disallowed by robots.txt')
        context, config = props['context'], props['algoliaConfig']
        host = config['appId'].lower() + '-dsn.algolia.net'
        if host != ALLOWED_SEARCH_HOST:
            raise ValueError('New search host requires configuration review: ' + host)
        index = context['eventId'] + '-index'
        endpoint = 'https://' + host + '/1/indexes/' + urllib.parse.quote(index) + '/query'
        filters = ' AND '.join(('eventEditionId:' + context['eventEditionId'], 'recordType:exhibitor', 'locale:' + context['interfaceLocale'].lower()))
        headers = {'X-Algolia-API-Key': config['apiKey'], 'X-Algolia-Application-Id': config['appId']}
        hits, total, pages, retrieval_times = [], None, 1, []
        page = 0
        while page < pages:
            name = 'wtm-' + edition + '-page-' + str(page).zfill(3) + '.json'
            path = self.root / name
            if self.cached(path):
                data = json.loads(path.read_text())
                if data.get('_speaqi_filters') not in (None, filters) or any(hit.get('eventEditionId') != context['eventEditionId'] for hit in data.get('hits', [])):
                    data = None
            else:
                data = None
            if data is None:
                data = json.loads(self.request(endpoint, {'query': '', 'filters': filters, 'hitsPerPage': 500, 'page': page, 'attributesToHighlight': []}, headers))
                data['_speaqi_filters'] = filters
                self.save(name, data)
                time.sleep(.6)
            retrieval_times.append(path.stat().st_mtime)
            if total is not None and total != data['nbHits']:
                raise ValueError('Directory changed during pagination; rerun with --refresh')
            total, pages = data['nbHits'], data['nbPages']
            if pages > 200 or total > 100_000:
                raise ValueError('Unexpected source volume requires review')
            hits.extend(data['hits'])
            print(json.dumps({'source': edition, 'page': page + 1, 'pages': pages, 'fetched': len(hits), 'reported_total': total}), flush=True)
            page += 1
        unique = {h['objectID']: h for h in hits}
        if len(hits) != total or len(unique) != total:
            raise ValueError('Pagination is incomplete or duplicated; no complete receipt produced')
        self.save('wtm-' + edition + '-raw.json', hits)
        receipt = {'source': 'wtm:' + edition, 'url': source_url, 'event_name': context['eventEditionName'], 'event_edition_id': context['eventEditionId'], 'retrieved_at': dt.datetime.fromtimestamp(min(retrieval_times),dt.timezone.utc).isoformat(), 'checked_at': self.now, 'rows': total, 'unique_ids': len(unique), 'pages': pages, 'complete_for_directory': True, 'robots_allowed': True, 'classification': 'Exhibitor self-reported categories; requires review'}
        self.receipts.append(receipt)
        return hits, props, receipt


def primary_activity(hit):
    filters = hit.get('exhibitorFilters') or {}
    return next((value for key, value in filters.items() if key.casefold() in ('main company activity', 'company activity')), {})


def classify_wtm(hit):
    filters = hit.get('exhibitorFilters') or {}
    main = ' '.join(primary_activity(hit).get('lvl0', [])).lower()
    groups = ' '.join((filters.get('Product Groups') or {}).get('lvl0', [])).lower()
    name = text(hit.get('companyName') or hit.get('exhibitorName'))
    description = text(hit.get('exhibitorDescription'))
    if 'destination management company' in main:
        return 'dmc', 'primary_activity'
    if any(value in main for value in ('tourism board', 'tourism organisation', 'tourism organization')):
        # Self-selected board tags do not establish legal governance status.
        if re.search(r'\bdmc\b|destination management company', description, re.I) and not re.search(r'ministr|touris[mt] board|authority|bureau|government', name, re.I):
            return 'dmc', 'description_overrides_inconsistent_board_tag'
        if re.search(r'tourism company|travel agency|tour operator|travel company', description, re.I) and not re.search(r'ministr|touris[mt] board|authority|bureau|government', name, re.I):
            return 'other', 'inconsistent_board_tag_requires_classification_review'
        if re.search(r'minist', name, re.I):
            return 'ministry', 'primary_activity_and_name'
        if re.search(r'convention|visitors? bureau', name, re.I):
            return 'cvb', 'primary_activity_and_name'
        if re.search(r'national touris|touris[mt] board of|touris[mt] authority', name, re.I):
            return 'nto', 'primary_activity_and_name'
        if re.search(r'national touris[mt] (?:board|organisation|organization|agency|development authority)', description, re.I):
            return 'nto', 'primary_activity_and_description'
        if re.search(r'regional touris[mt] (?:board|organisation|organization|agency)', description, re.I):
            return 'rto', 'primary_activity_and_description'
        return 'dmo', 'self_reported_board_category'
    if 'association' in main and re.search(r'touris|travel|turism|destin', name + ' ' + description, re.I):
        return 'association', 'primary_activity_and_tourism_context'
    # Seller product groups can describe their customers (e.g. software sold to DMCs).
    # Never override an explicit non-tourism primary activity with those groups.
    if main and re.search(r'technolog|press/media|educational|investment|financial|marketing services|consulting', main):
        if re.search(r'travel operator|direct dmc operations', description, re.I) and not re.search(r'software company|technology company|platform built for', description, re.I):
            return 'other', 'inconsistent_company_activity_requires_review'
        return None, 'non_target_primary_activity'
    if re.search(r'national touris[mt] (?:board|organisation|organization|agency|development authority)', description, re.I):
        return 'nto', 'explicit_institutional_description'
    self_described_dmc = re.search(r'destination management company\b|\b(?:a|an|leading|local|boutique|top|trusted|online|as)\s+(?:(?:local|inbound|leading|boutique)\s+){0,3}dmc\b|\bdmc\s+(?:based|operating|speciali|con base|in\b)', description, re.I)
    if re.search(r'\bdmc\b', name, re.I) or self_described_dmc:
        if re.search(r'marketplace connecting|software for|technology platform for', description, re.I):
            return None, 'supplier_platform_not_destination_operator'
        return 'dmc', 'explicit_name_or_description'
    if re.search(r'ministry.{0,40}touris|touris[mt] board|convention.{0,25}bureau|destination marketing organi[sz]ation', name, re.I):
        return ('ministry' if re.search(r'ministr', name, re.I) else 'cvb' if re.search(r'convention|bureau', name, re.I) else 'dmo'), 'explicit_organization_name'
    if re.search(r'\bdmc\b|destination management', description, re.I):
        return 'other', 'tourism_company_role_requires_review'
    if main:
        return None, 'non_target_primary_activity'
    return None, 'insufficient_organization_classification' if groups else 'uncategorized_exhibitor'


def wtm_record(hit, edition, props, country_code):
    kind, classification = classify_wtm(hit)
    if not kind:
        return None, classification
    code = country_code(hit.get('countryName'))
    if not code:
        return None, 'missing_or_unknown_country'
    name = text(hit.get('companyName') or hit.get('exhibitorName'))
    if not 2 <= len(name) <= 200:
        return None, 'invalid_name_length'
    website = public_url(hit.get('website'))
    email = institutional_email(hit.get('email'))
    phone = text(hit.get('phone'))[:80] or None
    display = text(hit.get('exhibitorName'))
    categories = hit.get('exhibitorFilters') or {}
    source = props['navigation']['exhibitorPublicDetailsUrlFormat'].replace('{0}', hit['id'])
    description = text(hit.get('exhibitorDescription'))[:2000]
    fields = ['name', 'country_code', 'type_code'] + (['website'] if website else []) + (['email'] if email else []) + (['phone'] if phone else []) + (['description'] if description else [])
    return {'kind': 'organization', 'name': name, 'country_code': code, 'type_code': kind, 'website': website, 'email': email, 'phone': phone, 'aliases': [display] if display and display != name and len(display) <= 200 else [], 'external_ids': {'wtm': hit.get('organisationGuid') or hit['id'], 'wtm_' + edition.replace('-', '_'): hit['id']}, 'details': {'description': description, 'language': 'en', 'acquisition': {'source': 'wtm:' + edition, 'classification_rule': classification, 'self_reported': True, 'event_edition_id': props['context']['eventEditionId']}}, 'evidence': {'source_url': source, 'title': props['context']['eventEditionName'] + ' — ' + name[:160], 'excerpt': ('Company activity published by this directory: ' + json.dumps(primary_activity(hit), ensure_ascii=False) + '. ' + description)[:2000], 'fields': fields, 'method': 'import'}}, None


def deduplicate(records):
    grouped = {}
    identities = {}
    for record in records:
        record_sources = record.get('source_evidence') or [record['evidence']]
        key = (record['kind'], record['country_code'], name_key(record['name']))
        strong_ids = [(record['kind'], record['country_code'], source, value) for source, value in record['external_ids'].items() if source in ('wtm', 'wikidata')]
        existing = {identities[i] for i in strong_ids if i in identities}
        if len(existing) > 1:
            raise ValueError('Conflicting source identities require review')
        key = next(iter(existing), key)
        if key not in grouped:
            grouped[key] = {**record, 'source_evidence': list(record_sources)}
            for identity in strong_ids:
                identities[identity] = key
            continue
        previous = grouped[key]
        if previous['external_ids'].get('wikidata') and record['external_ids'].get('wikidata') and previous['external_ids']['wikidata']!=record['external_ids']['wikidata']:
            raise ValueError('Distinct Wikidata identities share a name; disambiguation required')
        previous['source_evidence'].extend(record_sources)
        previous['aliases'] = sorted(set(previous['aliases'] + record['aliases'] + ([record['name']] if record['name'] != previous['name'] else [])))[:30]
        previous['external_ids'].update(record['external_ids'])
        for identity in strong_ids:
            identities[identity] = key
        for field in ('website', 'email', 'phone'):
            if not previous[field] and record[field]:
                previous[field] = record[field]
    return list(grouped.values())


def wikidata_records(rows, type_code, valid_codes):
    records, rejected = [], collections.Counter()
    for row in rows:
        value = lambda key: row.get(key, {}).get('value', '')
        code, name, qid = value('iso'), value('itemLabel'), value('item').rsplit('/', 1)[-1]
        if code not in valid_codes or not 2 <= len(name) <= 200 or re.fullmatch(r'Q\d+', name):
            rejected['missing_country_or_label'] += 1
            continue
        website = public_url(value('website'))
        records.append({'kind': 'organization', 'name': name, 'country_code': code, 'type_code': type_code, 'website': website, 'email': None, 'phone': None, 'aliases': [], 'external_ids': {'wikidata': qid}, 'details': {'description': value('description')[:2000], 'language': row.get('itemLabel', {}).get('xml:lang', 'en'), 'acquisition': {'source': 'wikidata', 'classification_rule': 'explicit_instance_of', 'self_reported': False}}, 'evidence': {'source_url': 'https://www.wikidata.org/wiki/' + qid, 'title': 'Wikidata CC0 — ' + name[:200], 'excerpt': ('Instance classification and country published by Wikidata. ' + value('description'))[:2000], 'fields': ['name', 'country_code', 'type_code'] + (['website'] if website else []), 'method': 'import'}})
    return records, dict(rejected)


def country_records(rows, valid_codes):
    records, seen = [], set()
    for row in rows:
        code = row['iso']['value']
        if code not in valid_codes or code in seen:
            continue
        seen.add(code)
        qid = row['country']['value'].rsplit('/', 1)[-1]
        records.append({'kind': 'place', 'name': row['countryLabel']['value'], 'country_code': code, 'type_code': None, 'website': None, 'email': None, 'phone': None, 'aliases': [], 'external_ids': {'wikidata': qid, 'iso': code}, 'details': {'place_level': 'country', 'description': 'Country or territory identified by its ISO 3166-1 code. Organization coverage is tracked separately.', 'acquisition': {'source': 'wikidata'}}, 'evidence': {'source_url': 'https://www.wikidata.org/wiki/' + qid, 'title': 'Wikidata country / territory — ' + code, 'excerpt': 'Wikidata P297 ISO 3166-1 alpha-2 identifier; this is geography, not proof of tourism organization coverage.', 'fields': ['name', 'country_code'], 'method': 'import'}})
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='backups/tourism-acquisition')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--sources', nargs='+', default=list(EDITIONS))
    args = parser.parse_args()
    acquisition = Acquisition(args.out, args.refresh)
    records, issues, statistics = [], [], []
    countries = acquisition.sparql('countries', 'SELECT ?country ?countryLabel ?iso WHERE { ?country wdt:P297 ?iso. FILTER(STRLEN(?iso)=2) FILTER NOT EXISTS { ?country wdt:P576 ?end. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,it". } }')
    for country in countries:
        if country['iso']['value'] in acquisition.valid_codes:
            acquisition.country_names[name_key(country['countryLabel']['value'])] = country['iso']['value']
    records.extend(country_records(countries, acquisition.valid_codes))
    for edition in args.sources:
        try:
            hits, props, receipt = acquisition.wtm(edition)
            rejects = collections.Counter()
            accepted = []
            for hit in hits:
                record, error = wtm_record(hit, edition, props, acquisition.country_code)
                if record:
                    accepted.append(record)
                else:
                    rejects[error] += 1
            records.extend(accepted)
            statistics.append({**receipt, 'eligible_organizations': len(accepted), 'excluded': dict(rejects)})
        except Exception as error:
            issues.append({'source': 'wtm:' + edition, 'error': str(error), 'complete': False})
            print(json.dumps(issues[-1]), flush=True)
    for source, type_code, type_id in [('dmo-direct', 'dmo', 'Q3689421'), ('ministry-direct', 'ministry', 'Q2446662'), ('italian-promotion', 'rto', 'Q3631462'), ('tourism-association', 'association', 'Q11630513')]:
        query = 'SELECT ?item ?itemLabel ?country ?iso ?website ?description WHERE { ?item wdt:P31 wd:' + type_id + '. OPTIONAL { ?item wdt:P17 ?country. ?country wdt:P297 ?iso. } OPTIONAL { ?item wdt:P856 ?website. } OPTIONAL { ?item schema:description ?description FILTER(LANG(?description)="en") } FILTER NOT EXISTS { ?item wdt:P576 ?end. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en,it,fr,de,es". } }'
        try:
            rows = acquisition.sparql(source, query)
            accepted, rejected = wikidata_records(rows, type_code, acquisition.valid_codes)
            records.extend(accepted)
            statistics.append({'source': 'wikidata:' + source, 'rows': len(rows), 'eligible_organizations': len(accepted), 'excluded': rejected, 'complete_for_query': True, 'license': 'CC0'})
        except Exception as error:
            issues.append({'source': 'wikidata:' + source, 'error': str(error), 'complete': False})
    unique = deduplicate(records)
    orgs = [r for r in unique if r['kind'] == 'organization']
    report = {'retrieved_at': acquisition.now, 'sources': statistics, 'issues': issues, 'raw_normalized_rows': len(records), 'entities': len(unique), 'organizations': len(orgs), 'countries_with_organizations': len({r['country_code'] for r in orgs}), 'country_reference_records': sum(r['kind'] == 'place' for r in unique), 'by_country': dict(collections.Counter(r['country_code'] for r in orgs).most_common()), 'by_type': dict(collections.Counter(r['type_code'] for r in orgs).most_common()), 'verification': 'UNVERIFIED until source review', 'worldwide_completeness': 'Unknown; complete directories and typed Wikidata queries are not a census of all tourism organizations.'}
    acquisition.save('candidates.json', unique)
    acquisition.save('acquisition-report.json', report)
    acquisition.save('source-receipts.json', acquisition.receipts)
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
