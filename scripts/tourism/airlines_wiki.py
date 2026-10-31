#!/usr/bin/env python3
"""Siti ufficiali e stato delle compagnie aeree dalle schede Wikipedia (infobox).

Per ogni compagnia dell'elenco "List of airline codes" si apre la sua scheda e si
legge dall'infobox: sito ufficiale, "Ceased operations", codici IATA/ICAO. Si
prende solo il fatto (un indirizzo, una data), non il testo. Una richiesta alla
volta, pausa fra le richieste, user agent con contatto, riprende da dove si e'
fermato. Nessuna scrittura sul database: produce un JSONL da rivedere.

  airlines_wiki.py links --html List_of_airline_codes.html --out links.json
  airlines_wiki.py fetch --links links.json --targets icao.json --out wiki_sites.jsonl [--delay 1.0]
"""
import argparse
import gzip
import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

UA = 'speaqi-crm-research/1.0 (info@speaqi.com; one request at a time)'


def text(fragment):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', fragment))).strip()


def links(html_path):
    """ICAO -> titoli delle schede collegate nella tabella."""
    page = pathlib.Path(html_path).read_text(encoding='utf8', errors='ignore')
    out = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(cells) != 6:
            continue
        icao = text(cells[1])
        found = re.search(r'href="(?:https://en\.wikipedia\.org)?/wiki/([^"#?]+)"', cells[2])
        if icao and found and 'redlink' not in cells[2] and not found.group(1).startswith(('Special:', 'Help:', 'File:')):
            out.setdefault(icao, []).append(urllib.parse.unquote(found.group(1)))
    return out


def get(title):
    request = urllib.request.Request(
        'https://en.wikipedia.org/wiki/' + urllib.parse.quote(title, safe='()_,'),
        headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'},
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        body = response.read()
        if response.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        return body.decode('utf8', errors='ignore')


def infobox(page):
    """La tabella laterale, fino alla sua chiusura (contiene tabelle annidate)."""
    start = re.search(r'<table[^>]*class="[^"]*infobox[^"]*"[^>]*>', page)
    if not start:
        return ''
    depth, position = 0, start.start()
    for tag in re.finditer(r'<(/?)table\b', page[position:]):
        depth += -1 if tag.group(1) else 1
        if depth == 0:
            return page[position:position + tag.end() + 1]
    return page[position:position + 60000]


def row(box, *labels):
    for label in labels:
        found = re.search(r'<th[^>]*>\s*(?:<[^>]+>)*\s*' + label + r'\s*(?:<[^>]+>)*\s*</th>\s*<td[^>]*>(.*?)</td>', box, re.S | re.I)
        if found:
            return found.group(1)
    return None


def website(box):
    cell = row(box, 'Website', 'Web site')
    if not cell:
        return None
    for url in re.findall(r'href="(https?://[^"]+)"', cell):
        if 'wikipedia.org' in url or 'wikidata.org' in url or 'archive.org' in url:
            continue
        return html.unescape(url).strip()
    return None


def read(page, icao):
    box = infobox(page)
    if not box:
        return {'status': 'no_infobox'}
    codes = text(row(box, 'ICAO') or '')
    result = {
        'status': 'ok',
        'website': website(box),
        'ceased': text(row(box, 'Ceased operations') or '') or None,
        'founded': None,
        'icao_on_page': codes[:20] or None,
        'icao_matches': bool(codes) and icao in re.findall(r'[A-Z]{3}', codes),
    }
    return result


def fetch(links_path, targets_path, out_path, delay):
    mapping = json.loads(pathlib.Path(links_path).read_text())
    targets = json.loads(pathlib.Path(targets_path).read_text())
    out = pathlib.Path(out_path)
    done = set()
    if out.exists():
        done = {json.loads(line)['icao'] for line in out.read_text().splitlines() if line.strip()}
    with out.open('a', encoding='utf8') as handle:
        for index, icao in enumerate(targets):
            if icao in done:
                continue
            titles = mapping.get(icao)
            record = {'icao': icao, 'title': None}
            if not titles:
                record['status'] = 'no_link'
            else:
                record['title'] = titles[0]
                for attempt in range(3):
                    try:
                        record.update(read(get(titles[0]), icao))
                        break
                    except urllib.error.HTTPError as error:
                        if error.code in (429, 503):
                            time.sleep(15 * (attempt + 1))
                            record['status'] = f'http_{error.code}'
                        else:
                            record['status'] = f'http_{error.code}'
                            break
                    except Exception as error:  # rete: ritenta, poi segnala
                        record['status'] = 'error:' + type(error).__name__
                        time.sleep(5)
                time.sleep(delay)
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
            handle.flush()
            if index % 50 == 0:
                print(index, len(targets), flush=True)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)
    first = sub.add_parser('links')
    first.add_argument('--html', required=True)
    first.add_argument('--out', required=True)
    second = sub.add_parser('fetch')
    second.add_argument('--links', required=True)
    second.add_argument('--targets', required=True)
    second.add_argument('--out', required=True)
    second.add_argument('--delay', type=float, default=1.0)
    args = parser.parse_args()
    if args.cmd == 'links':
        mapping = links(args.html)
        pathlib.Path(args.out).write_text(json.dumps(mapping))
        print(json.dumps({'icao_with_page': len(mapping)}))
    else:
        fetch(args.links, args.targets, args.out, args.delay)


if __name__ == '__main__':
    main()
