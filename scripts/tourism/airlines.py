#!/usr/bin/env python3
"""Catalogo delle compagnie aeree del mondo per Tourism Intelligence.

Fonte: OpenFlights (ODbL, https://github.com/jpatokal/openflights): airlines.dat,
airports.dat, routes.dat. Il file e' del 2017: una compagnia puo' essere
cessata, per questo ogni ente nasce UNVERIFIED e porta la fonte e l'anno. Il
sito e le dimensioni arrivano dopo, da un arricchimento a parte; nessun
indirizzo si inventa. Nessun accesso alla rete: i tre file si scaricano prima.

  airlines.py catalog --data DIR [--out scripts/data/tourism-airlines.json]
  airlines.py sql --catalog scripts/data/tourism-airlines.json --owner UUID --out DIR
  airlines.py wiki --html List_of_airline_codes.html --data DIR [--known scripts/data/tourism-airlines.json]
  airlines.py routes --data DIR [--out scripts/data/tourism-airline-routes.json]
"""
import argparse
import collections
import csv
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
HUBS = ROOT / 'scripts' / 'data' / 'tourism-airports.json'
SOURCE = 'https://github.com/jpatokal/openflights/blob/master/data/airlines.dat'
# Nomi che non sono vettori passeggeri o che OpenFlights usa come segnaposto.
NOT_PASSENGER = re.compile(r'\b(cargo|freight|logistic|courier|parcel|air ?freight|aviation services?|helicopt|aerial|flying club|flight school|private|unknown|test)\b', re.I)
NOISE = re.compile(r'^(\\N|-|n/a|unknown)$', re.I)


def rows(path):
    with open(path, encoding='utf8', newline='') as handle:
        return list(csv.reader(handle))


def country_codes(data):
    """Nome paese di OpenFlights -> ISO 3166-1 alpha-2, dal voto degli aeroporti."""
    hubs = {h['iata']: h['country'] for h in json.loads(HUBS.read_text())['hubs'] if h.get('iata')}
    votes = collections.defaultdict(collections.Counter)
    for row in rows(data / 'airports.dat'):
        if len(row) > 4 and row[4] in hubs:
            votes[row[3]][hubs[row[4]]] += 1
    return {name: counter.most_common(1)[0][0] for name, counter in votes.items()}


def catalog(data):
    iso = country_codes(data)
    served = collections.Counter(line.split(',')[1] for line in (data / 'routes.dat').read_text().splitlines())
    out, held = [], collections.Counter()
    seen = set()
    for row in rows(data / 'airlines.dat'):
        _id, name, alias, iata, icao, callsign, country, active = row[:8]
        name = name.strip()
        if len(re.sub(r'[^A-Za-z]', '', name)) < 3:
            held['nome_non_valido'] += 1
            continue
        if active != 'Y' or not re.fullmatch(r'[A-Z0-9]{2}', iata) or not re.fullmatch(r'[A-Z]{3}', icao):
            held['non_attiva_o_senza_codici'] += 1
            continue
        if NOT_PASSENGER.search(name):
            held['non_passeggeri'] += 1
            continue
        code = iso.get(country)
        if not code:
            held['paese_non_risolto'] += 1
            continue
        key = (code, re.sub(r'[^a-z0-9]', '', name.lower()))
        if key in seen:
            held['doppione'] += 1
            continue
        seen.add(key)
        record = {
            'kind': 'organization', 'name': name, 'country_code': code, 'type_code': 'airline',
            'website': None, 'email': None, 'phone': None,
            'aliases': [icao],
            'external_ids': {'iata': iata, 'icao': icao, 'openflights': _id},
            'details': {
                'iata': iata, 'icao': icao, 'callsign': None if NOISE.match(callsign) else callsign.title(),
                'routes_in_source': served.get(_id, 0),
                'acquisition': {'source': 'openflights:airlines.dat', 'snapshot_year': 2017,
                                'classification_rule': 'active_flag_with_iata_and_icao', 'verified_alive': False},
            },
            'evidence': {
                'source_url': SOURCE, 'title': 'OpenFlights — ' + name[:180],
                'excerpt': f'Vettore con codice IATA {iata} e ICAO {icao}, paese {country}. Catalogo del 2017: stato operativo e sito da verificare.',
                'fields': ['name', 'country_code', 'type_code'], 'method': 'import',
            },
            'source_evidence': [],
        }
        record['source_evidence'] = [record['evidence']]
        out.append(record)
    out.sort(key=lambda r: (-r['details']['routes_in_source'], r['name']))
    return out, held


WIKI_URL = 'https://en.wikipedia.org/wiki/List_of_airline_codes'
WIKI_COUNTRIES = {
    'Ukraine': 'UA', 'Moldova': 'MD', 'Myanmar': 'MM', 'Republic of the Congo': 'CG', 'Republic of Korea': 'KR',
    'Macao': 'MO', 'Russian Federation': 'RU', 'The Gambia': 'GM', 'UAE': 'AE', 'Democratic Republic of the Congo': 'CD',
    'Iraqi Kurdistan': 'IQ', "Lao People's Democratic Republic": 'LA', 'THAILAND': 'TH', 'Syrian Arab Republic': 'SY',
}
# Cessata: la lista Wikipedia lo scrive nelle note. "Formerly", "renamed" o "ICAO code no longer allocated"
# non bastano: la compagnia puo' essere viva sotto un altro nome o codice.
WIKI_DEAD = re.compile(r'defunct|ceased|bankrupt|liquidat|merged (with|into)|no longer operat|dissolved|shut down|collapsed|insolven|operations (suspended|terminated)', re.I)
WIKI_NOT_AIRLINE = re.compile(r'\b(squadron|air force|navy|army|police|ministry|airbus|boeing|\w*cargo\w*|fedex|dhl|ups airlines|freight\w*|logistic\w*|courier|helicopt\w*|flying club|flight school|aero ?club|reservation|travel network|it group|carga|fret)\b', re.I)
WIKI_NO_COUNTRY = {'', 'Global', 'APAC', 'Multiple', 'International'}


def clean_ref(text):
    return re.sub(r'\s*\[[^\]]*\]', '', text).strip()


def wiki_rows(path):
    text = pathlib.Path(path).read_text(encoding='utf8', errors='ignore')
    edited = re.search(r'last edited on ([^<,]*)', text)
    out = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', text, re.S):
        cells = [html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', c))).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) == 6:
            out.append(cells)
    return out, (edited.group(1).strip() if edited else None)


def wiki_catalog(html_path, data, known_path=None):
    iso = {**country_codes(data), **WIKI_COUNTRIES}
    rows_, edited = wiki_rows(html_path)
    known = set()
    if known_path:
        known = {r['details']['icao'] for r in json.loads(pathlib.Path(known_path).read_text())['records']}
    openflights = {r[4]: r[0] for r in rows(data / 'airlines.dat') if len(r) > 4}
    alive, held = [], collections.Counter()
    for iata, icao, name, callsign, country, note in rows_:
        if not iata or not icao:
            held['senza_iata_o_icao'] += 1
        elif WIKI_DEAD.search(note):
            held['cessata_secondo_le_note'] += 1
        elif WIKI_NOT_AIRLINE.search(name + ' ' + note):
            held['non_passeggeri'] += 1
        elif country in WIKI_NO_COUNTRY:
            held['senza_paese'] += 1
        elif country not in iso:
            held['paese_non_risolto'] += 1
        elif len(re.sub(r'[^A-Za-z]', '', name)) < 3 or not re.fullmatch(r'[A-Z0-9]{2}', iata) or not re.fullmatch(r'[A-Z]{3}', icao):
            held['codici_o_nome_non_validi'] += 1
        else:
            alive.append((iata, icao, re.sub(r'\s*\[[^\]]*\]', '', name).strip(), callsign, country, note))
    seen, new = set(), []
    for iata, icao, name, callsign, country, note in alive:
        key = (iso[country], re.sub(r'[^a-z0-9]', '', name.lower()))
        if key in seen:
            held['doppione'] += 1
            continue
        seen.add(key)
        if icao in known:
            continue
        excerpt = f'Vettore con codice IATA {iata} e ICAO {icao}, paese {country}. Elenco Wikipedia aggiornato al {edited}; stato operativo e sito da verificare.'
        ev = {'source_url': WIKI_URL, 'title': 'Wikipedia: List of airline codes — ' + name[:150], 'excerpt': excerpt[:2000],
              'fields': ['name', 'country_code', 'type_code'], 'method': 'import'}
        new.append({
            'kind': 'organization', 'name': name, 'country_code': iso[country], 'type_code': 'airline',
            'website': None, 'email': None, 'phone': None, 'aliases': [icao],
            'external_ids': {k: v for k, v in {'iata': iata, 'icao': icao, 'openflights': openflights.get(icao)}.items() if v},
            'details': {'iata': iata, 'icao': icao, 'callsign': clean_ref(callsign).title() or None, 'note': clean_ref(note) or None,
                        'acquisition': {'source': 'wikipedia:list-of-airline-codes', 'list_edited': edited,
                                        'classification_rule': 'iata_icao_no_defunct_note', 'verified_alive': False}},
            'evidence': ev, 'source_evidence': [ev],
        })
    alive_icao = {a[1] for a in alive}
    stale = sorted(r['details']['icao'] for r in json.loads(pathlib.Path(known_path).read_text())['records'] if r['details']['icao'] not in alive_icao) if known_path else []
    return new, stale, held, edited


def routes(data):
    """Coppie compagnia-aeroporto, per i collegamenti con tourism_hub_operators (ruolo route)."""
    pairs = collections.Counter()
    for line in (data / 'routes.dat').read_text().splitlines():
        part = line.split(',')
        if len(part) < 6 or not re.fullmatch(r'[A-Z0-9]{2}', part[0]):
            continue
        for airport in (part[2], part[4]):
            if re.fullmatch(r'[A-Z]{3}', airport):
                pairs[(part[0], airport)] += 1
    return [{'airline_iata': a, 'airport_iata': p, 'routes': n} for (a, p), n in sorted(pairs.items())]


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def import_sql(records, owner):
    """Stesso involucro di prepare.py (transazione, proprietario, prove), senza le sue dipendenze."""
    payload = json.dumps(records, ensure_ascii=False, separators=(',', ':'))
    tag = '$speaqi_catalog_ingest$'
    while tag in payload:
        tag = tag[:-1] + '_$'
    return f"""begin;
select set_config('request.jwt.claim.sub',{literal(owner)},true);
set local role authenticated;
select pg_advisory_xact_lock(hashtext(auth.uid()::text||':tourism-catalog-acquisition'));
select public.tourism_import({literal(payload)}::jsonb);
commit;
"""


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)
    for name in ('catalog', 'routes'):
        s = sub.add_parser(name)
        s.add_argument('--data', required=True)
        s.add_argument('--out')
    s = sub.add_parser('wiki')
    s.add_argument('--html', required=True)
    s.add_argument('--data', required=True)
    s.add_argument('--known')
    s.add_argument('--out')
    s = sub.add_parser('sql')
    s.add_argument('--catalog', required=True)
    s.add_argument('--owner', required=True)
    s.add_argument('--out', required=True)
    args = parser.parse_args()
    if args.cmd == 'catalog':
        records, held = catalog(pathlib.Path(args.data))
        target = pathlib.Path(args.out or ROOT / 'scripts' / 'data' / 'tourism-airlines.json')
        target.write_text(json.dumps({'source': 'OpenFlights (ODbL), 2017', 'records': records}, ensure_ascii=False, indent=1))
        print(json.dumps({'records': len(records), 'held': held, 'out': str(target)}))
    elif args.cmd == 'wiki':
        new, stale, held, edited = wiki_catalog(args.html, pathlib.Path(args.data), args.known)
        target = pathlib.Path(args.out or ROOT / 'scripts' / 'data' / 'tourism-airlines-2026.json')
        target.write_text(json.dumps({'source': f'Wikipedia: List of airline codes (modificata il {edited})', 'records': new, 'stale_icao': stale}, ensure_ascii=False, indent=1))
        print(json.dumps({'new': len(new), 'stale_in_known': len(stale), 'held': held, 'list_edited': edited, 'out': str(target)}))
    elif args.cmd == 'routes':
        pairs = routes(pathlib.Path(args.data))
        target = pathlib.Path(args.out or ROOT / 'scripts' / 'data' / 'tourism-airline-routes.json')
        target.write_text(json.dumps({'source': 'OpenFlights (ODbL), 2017', 'pairs': pairs}, separators=(',', ':')))
        print(json.dumps({'pairs': len(pairs), 'out': str(target)}))
    else:
        records = json.loads(pathlib.Path(args.catalog).read_text())['records']
        out = pathlib.Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for old in out.glob('*.sql'):
            old.unlink()
        for index in range(0, len(records), 200):
            (out / f'import-{index // 200:03d}.sql').write_text(import_sql(records[index:index + 200], args.owner))
        print(json.dumps({'records': len(records), 'batches': (len(records) + 199) // 200}))


if __name__ == '__main__':
    main()
