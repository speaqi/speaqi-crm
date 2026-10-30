#!/usr/bin/env python3
"""Catalogo delle compagnie aeree del mondo per Tourism Intelligence.

Fonte: OpenFlights (ODbL, https://github.com/jpatokal/openflights): airlines.dat,
airports.dat, routes.dat. Il file e' del 2017: una compagnia puo' essere
cessata, per questo ogni ente nasce UNVERIFIED e porta la fonte e l'anno. Il
sito e le dimensioni arrivano dopo, da un arricchimento a parte; nessun
indirizzo si inventa. Nessun accesso alla rete: i tre file si scaricano prima.

  airlines.py catalog --data DIR [--out scripts/data/tourism-airlines.json]
  airlines.py sql --catalog scripts/data/tourism-airlines.json --owner UUID --out DIR
  airlines.py routes --data DIR [--out scripts/data/tourism-airline-routes.json]
"""
import argparse
import collections
import csv
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
