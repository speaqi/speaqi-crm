#!/usr/bin/env python3
"""Discover additional agencies through bounded Wikipedia categories + Wikidata.

Wikipedia category membership is discovery evidence. Facts remain unverified;
no article text, people, guessed addresses or unsourced geographic coverage.
"""
import argparse
import collections
import json
import hashlib
import pathlib
import re
import time
import urllib.parse

from acquire import Acquisition, deduplicate, institutional_email, public_url, text


def api(acquisition, host, params, name):
    path = acquisition.root / name
    if acquisition.cached(path):
        return json.loads(path.read_text())
    url = 'https://' + host + '/w/api.php?' + urllib.parse.urlencode({'format': 'json', **params})
    data = json.loads(acquisition.request(url))
    if data.get('error'):
        raise ValueError(str(data['error']))
    acquisition.save(name, data)
    time.sleep(.6)
    return data


def values(entity, property_id):
    return [statement['mainsnak']['datavalue']['value'] for statement in entity.get('claims', {}).get(property_id, []) if statement.get('rank') != 'deprecated' and statement.get('mainsnak', {}).get('datavalue')]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='backups/tourism-acquisition/wikipedia')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    acquisition = Acquisition(args.out, args.refresh)
    reference = json.loads((acquisition.root.parent / 'wikidata-countries.json').read_text())['results']['bindings']
    country_codes = {row['country']['value'].rsplit('/', 1)[-1]: row['iso']['value'] for row in reference if row['iso']['value'] in acquisition.valid_codes}
    queue = collections.deque([('Category:Tourism agencies', 0), ('Category:Tourism ministries', 0), ('Category:Convention and visitors bureaus', 0)])
    visited, articles = set(), {}
    while queue:
        category, depth = queue.popleft()
        if category in visited:
            continue
        if len(visited) >= 40:
            raise ValueError('Category scope exceeded; review rather than silently truncate')
        visited.add(category)
        continuation = {}
        while True:
            params = {'action': 'query', 'list': 'categorymembers', 'cmtitle': category, 'cmlimit': 500, **continuation}
            cache = 'category-' + re.sub(r'[^a-z0-9]+', '-', category.lower()) + ('-' + hashlib.sha256(json.dumps(continuation,sort_keys=True).encode()).hexdigest()[:12] if continuation else '') + '.json'
            data = api(acquisition, 'en.wikipedia.org', params, cache)
            for member in data['query']['categorymembers']:
                if member['ns'] == 0:
                    articles[member['pageid']] = member
                elif member['ns'] == 14 and depth < 2 and re.search(r'agencies|agenc|organi[sz]ations|tourism ministries|tourism development corporations|convention.*bureaus', member['title'], re.I):
                    queue.append((member['title'], depth + 1))
            if 'continue' not in data:
                break
            continuation = data['continue']
        print(json.dumps({'categories':len(visited),'article_candidates':len(articles)}), flush=True)
    qids = {}
    page_ids = list(articles)
    for index in range(0, len(page_ids), 50):
        data = api(acquisition, 'en.wikipedia.org', {'action':'query','prop':'pageprops','ppprop':'wikibase_item','pageids':'|'.join(map(str,page_ids[index:index+50]))}, f'pageprops-{index//50:03}.json')
        for page in data['query']['pages'].values():
            qid = page.get('pageprops', {}).get('wikibase_item')
            if qid:
                qids[qid] = page
    entity_groups = []
    for index in range(0, len(qids), 50):
        ids = list(qids)[index:index+50]
        data = api(acquisition, 'www.wikidata.org', {'action':'wbgetentities','ids':'|'.join(ids),'props':'labels|descriptions|claims','languages':'en|it|fr|de|es'}, f'entities-{index//50:03}.json')
        entity_groups.append(data)
    parent_ids = set()
    for group in entity_groups:
        for entity in group['entities'].values():
            if any(isinstance(v,dict) and v.get('id') in country_codes for v in values(entity,'P17')):
                continue
            for property_id in ('P159','P1001'):
                parent_ids.update(v['id'] for v in values(entity,property_id) if isinstance(v,dict) and v.get('id') and v['id'] not in country_codes)
    parents = {}
    for index in range(0,len(parent_ids),50):
        ids = sorted(parent_ids)[index:index+50]
        data = api(acquisition,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'labels|claims','languages':'en|it|fr|de|es'},f'geographic-parents-{index//50:03}.json')
        parents.update(data['entities'])
    records, held, coverage = [], collections.Counter(), []
    for group_index, data in enumerate(entity_groups):
        for qid, entity in data['entities'].items():
            types = {v['id'] for v in values(entity, 'P31') if isinstance(v, dict) and v.get('id')}
            if 'Q5' in types or types.intersection({'Q13442814','Q571','Q41176','Q1587716','Q18411786'}) or values(entity, 'P576'):
                held['person_publication_facility_or_dissolved'] += 1
                continue
            countries = [country_codes.get(v['id']) for v in values(entity, 'P17') if isinstance(v, dict)]
            countries = list(dict.fromkeys(code for code in countries if code))
            country_evidence = []
            if not countries:
                for property_id in ('P159','P1001'):
                    for parent in values(entity,property_id):
                        if not isinstance(parent,dict) or not parent.get('id'):
                            continue
                        parent_id = parent['id']
                        if parent_id in country_codes:
                            countries.append(country_codes[parent_id])
                        else:
                            inherited = [country_codes[v['id']] for p in ('P17','P131') for v in values(parents.get(parent_id,{}),p) if isinstance(v,dict) and v.get('id') in country_codes]
                            countries.extend(inherited)
                        if countries:
                            country_evidence.append({'source_url':'https://www.wikidata.org/wiki/'+parent_id,'title':'Wikidata headquarters / jurisdiction country','excerpt':'Country resolved from published '+property_id+' and the parent entity country claim; no inference from name, website suffix or language.','fields':['country_code'],'method':'import'})
                    if countries:
                        countries=list(dict.fromkeys(countries))
                        break
            if not countries:
                held['missing_country'] += 1
                continue
            label = next((entity.get('labels', {}).get(lang, {}).get('value') for lang in ('en','it','fr','de','es') if entity.get('labels', {}).get(lang)), '')
            description = next((entity.get('descriptions', {}).get(lang, {}).get('value') for lang in ('en','it') if entity.get('descriptions', {}).get(lang)), '')
            if not 2 <= len(label) <= 200:
                held['missing_name'] += 1
                continue
            category = 'dmo' if 'Q3689421' in types else 'other'
            if 'Q2446662' in types or re.search(r'ministry.{0,70}tourism|tourism ministry', label + ' ' + description, re.I):
                category = 'ministry'
            elif re.search(r'convention.{0,30}(?:bureau|visitors)', label, re.I):
                category = 'cvb'
            elif re.search(r'national touris[mt] (?:board|organi[sz]ation|agency)|touris[mt] board of', label + ' ' + description, re.I):
                category = 'nto'
            elif re.search(r'state tourism development|regional tourism', label + ' ' + description, re.I):
                category = 'rto'
            website = next((url for v in values(entity,'P856') if (url:=public_url(v))), None)
            email = next((email for v in values(entity,'P968') if (email:=institutional_email(str(v).removeprefix('mailto:')))), None)
            phone = next((text(str(v).removeprefix('tel:'))[:80] for v in values(entity,'P1329')), None)
            fields = ['name','country_code','type_code'] + (['website'] if website else []) + (['email'] if email else []) + (['phone'] if phone else [])
            evidence = {'source_url':'https://www.wikidata.org/wiki/'+qid,'title':'Wikidata — '+label[:200],'excerpt':('Tourism agency discovered through Wikipedia categories. '+description)[:2000],'fields':fields,'method':'import'}
            category_source = {'source_url':'https://en.wikipedia.org/?curid='+str(qids[qid]['pageid']),'title':'Wikipedia tourism agency category membership — '+label[:180],'excerpt':'Category membership is discovery evidence, not legal identity or operating-status verification. Facts are sourced separately to Wikidata.','fields':['name'],'method':'import'}
            for code in countries:
                records.append({'kind':'organization','name':label,'country_code':code,'type_code':category,'website':website,'email':email,'phone':phone,'aliases':[],'external_ids':{'wikidata':qid},'details':{'description':description[:2000],'language':'en','acquisition':{'source':'wikidata:wikipedia-agencies','classification_rule':'category_discovery_and_explicit_claims','self_reported':False}},'evidence':evidence,'source_evidence':[evidence,category_source]+country_evidence})
                for jurisdiction in values(entity,'P1001'):
                    if isinstance(jurisdiction,dict) and jurisdiction.get('id') in country_codes:
                        coverage.append({'organization_wikidata':qid,'organization_country':code,'covered_country':country_codes[jurisdiction['id']],'source_url':'https://www.wikidata.org/wiki/'+qid})
        print(json.dumps({'wikidata_processed':min((group_index+1)*50,len(qids)),'total':len(qids),'organization_rows':len(records)}), flush=True)
    # Already carry both evidence records; no lossy merge on domain or article title.
    acquisition.save('candidates.json', records)
    acquisition.save('country-coverage.json', coverage)
    report = {'source':'wikidata:wikipedia-agencies','retrieved_at':acquisition.now,'categories':sorted(visited),'article_candidates':len(articles),'wikidata_entities':len(qids),'organization_rows':len(records),'held':dict(held),'license':'Wikidata claims CC0; category membership links to Wikipedia, no article text copied','complete_for_scope':True,'worldwide_completeness':'Unknown'}
    acquisition.save('report.json', report)
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
