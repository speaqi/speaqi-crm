#!/usr/bin/env python3
"""Discover OTA candidates; category tags alone never establish an OTA role.

Facts come from Wikidata (CC0) and public exhibitor profiles. No article text,
invented country, automatic identity verification or CRM promotion is used.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re

from acquire import Acquisition, public_url
from wikipedia_agencies import api, values
from classification import explicit_ota_role
from country_discovery import ancestry_reaches, FACILITIES
from acquire import deduplicate, name_key, wtm_record, EDITIONS


def country_claims(entity, country_map):
    statements = entity.get('claims',{}).get('P17',[])
    preferred = [s for s in statements if s.get('rank') == 'preferred']
    claims = [s.get('mainsnak',{}).get('datavalue',{}).get('value') for s in preferred] if preferred else values(entity,'P17')
    return sorted({country_map[v['id']] for v in claims if isinstance(v,dict) and v.get('id') in country_map})


def stage(source, entities, pages, facts_file, existing_file):
    facts = {f['qid']:f for f in json.loads(pathlib.Path(facts_file).read_text())}
    reference = json.loads((source.root.parent/'wikidata-countries.json').read_text())['results']['bindings']
    country_map = {r['country']['value'].rsplit('/',1)[-1]:r['iso']['value'] for r in reference if r['iso']['value'] in source.valid_codes}
    prospective = {}
    held = []
    for qid,entity in entities.items():
        description = entity.get('descriptions',{}).get('en',{}).get('value','')
        types = {v['id'] for v in values(entity,'P31') if isinstance(v,dict) and v.get('id')}
        if qid == 'Q118710708' or values(entity,'P576') or re.search(r'\bdefunct\b|ceased operations',description,re.I) or types & FACILITIES:
            held.append({'qid':qid,'reason':'class_person_facility_publication_or_inactive'})
        elif qid in facts or explicit_ota_role(description) or 'Q118710708' in types:
            prospective[qid] = entity
        else:
            held.append({'qid':qid,'reason':'ota_role_not_established'})
    roots = {'Q43229','Q4830453','Q783794','Q217107','Q6881511','Q118710708'}
    parents, seen = {},set()
    frontier = {v['id'] for e in prospective.values() for v in values(e,'P31') if isinstance(v,dict) and v.get('id')}
    for _ in range(8):
        frontier -= seen | roots | FACILITIES
        if not frontier:
            break
        if len(seen)+len(frontier)>500:
            raise ValueError('Bounded OTA organization ontology exceeded')
        pending = set()
        for index in range(0,len(frontier),50):
            ids = sorted(frontier)[index:index+50]
            cache = 'classes-'+hashlib.sha256('|'.join(ids).encode()).hexdigest()[:16]+'.json'
            data = api(source,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'claims'},cache)
            for qid,entity in data['entities'].items():
                parents[qid] = [v['id'] for v in values(entity,'P279') if isinstance(v,dict) and v.get('id')]
                pending.update(parents[qid])
        seen.update(frontier)
        frontier = pending
    headquarters = {v['id'] for e in prospective.values() for v in values(e,'P159') if isinstance(v,dict) and v.get('id')}
    locations = {}
    for index in range(0,len(headquarters),50):
        ids = sorted(headquarters)[index:index+50]
        cache = 'headquarters-'+hashlib.sha256('|'.join(ids).encode()).hexdigest()[:16]+'.json'
        data = api(source,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'claims'},cache)
        locations.update(data['entities'])
    records = []
    for qid,entity in prospective.items():
        fact = facts.get(qid,{})
        name = fact.get('name') or next((entity.get('labels',{}).get(lang,{}).get('value') for lang in ('en','it','fr','de','es') if entity.get('labels',{}).get(lang)), '')
        description = entity.get('descriptions',{}).get('en',{}).get('value','')
        types = {v['id'] for v in values(entity,'P31') if isinstance(v,dict) and v.get('id')}
        organizational = any(ancestry_reaches(t,parents,roots) for t in types)
        if any(ancestry_reaches(t,parents,FACILITIES) for t in types):
            held.append({'qid':qid,'name':name,'reason':'non_organization_class_path'})
            continue
        # Services and brands remain separately typed entities. They never
        # inflate the organization count just because the service is an OTA.
        kind = 'organization' if organizational else 'portal'
        if not organizational and not fact:
            held.append({'qid':qid,'name':name,'reason':'organization_identity_not_established'})
            continue
        codes = [fact['country_code']] if fact.get('country_code') else country_claims(entity,country_map)
        country_sources = []
        if not codes:
            for hq in values(entity,'P159'):
                if not isinstance(hq,dict):
                    continue
                hq_id = hq.get('id')
                resolved = [country_map[hq_id]] if hq_id in country_map else country_claims(locations.get(hq_id,{}),country_map)
                codes.extend(resolved)
                if resolved:
                    country_sources.append({'source_url':'https://www.wikidata.org/wiki/'+hq_id,'title':'Wikidata: headquarters country','excerpt':'Country resolved from the organization P159 headquarters and its explicit P17 country claim, not sales destinations.','fields':['country_code'],'method':'import'})
            codes = sorted(set(codes))
        website = fact.get('website') or next((url for v in values(entity,'P856') if (url:=public_url(v))),None)
        if len(codes)!=1 or not website or not 2<=len(name)<=200:
            held.append({'qid':qid,'name':name,'reason':'ambiguous_or_missing_country_website_or_name','country_codes':codes})
            continue
        # Preserve suspicious source claims for review instead of publishing a
        # visibly unrelated site as the company's official website.
        if '/wikipedia' in website or re.search(r'wwww\.',website):
            held.append({'qid':qid,'name':name,'reason':'website_claim_requires_review'})
            continue
        fields = ['name'] + ([] if fact.get('website') else ['website']) + ([] if fact.get('country_code') else ['country_code']) + ([] if fact else ['type_code'])
        evidence = {'source_url':'https://www.wikidata.org/wiki/'+qid,'title':'Wikidata OTA identity — '+name[:180],'excerpt':('Published identity claims; operating status and legal entity still require review. '+description)[:2000],'fields':fields,'method':'import'}
        sources = [evidence]+country_sources
        if fact:
            sources.append({'source_url':fact['source_url'],'title':'Official OTA service / legal page — '+name[:170],'excerpt':fact['note'],'fields':fact['fields'],'method':'import'})
        page = pages.get(qid)
        if page:
            sources.append({'source_url':'https://en.wikipedia.org/?curid='+str(page['pageid']),'title':'Wikipedia OTA category discovery','excerpt':'Category membership used only to discover the candidate; service role and identity sourced separately.','fields':['name'],'method':'import'})
        records.append({'kind':kind,'name':name,'country_code':codes[0],'type_code':'ota','website':website,'email':None,'phone':None,'aliases':[],'external_ids':{'wikidata':qid},'details':{'description':fact.get('note',description),'acquisition':{'source':'wikidata:ota-discovery','classification_rule':'official_ota_service' if fact else 'explicit_ota_role_and_organization_claim','self_reported':bool(fact)}},'evidence':evidence,'source_evidence':sources})
    for edition in EDITIONS:
        hits = json.loads((source.root.parent/f'wtm-{edition}-raw.json').read_text())
        config_name = 'wtm-config.json' if edition == 'london' else f'wtm-{edition}-config.json'
        props = json.loads((source.root.parent/config_name).read_text())['props']
        for hit in hits:
            if not explicit_ota_role(re.sub(r'<[^>]*>',' ',str(hit.get('exhibitorDescription') or ''))):
                continue
            record, reason = wtm_record(hit,edition,props,source.country_code)
            if record and record['type_code']=='ota':
                records.append(record)
    existing = json.loads(pathlib.Path(existing_file).read_text())['organizations']
    published, duplicate = [],[]
    for record in deduplicate(records):
        strong = [(k,v) for k,v in record['external_ids'].items() if k in ('wtm','wikidata')]
        matches = [r for r in existing if r['country_code']==record['country_code'] and (r['name_key']==name_key(record['name']) or any(r['external_ids'].get(k)==v for k,v in strong))]
        if matches:
            duplicate.append({'name':record['name'],'existing_ids':[r['id'] for r in matches],'reason':'preserve_existing_record_for_review'})
        else:
            published.append(record)
    source.save('candidates.json',published)
    source.save('held.json',held)
    source.save('existing-matches.json',duplicate)
    source.save('report.json',{'checked_at':source.now,'discovered_wikidata_entities':len(entities),'ota_records':len(published),'organizations':sum(r['kind']=='organization' for r in published),'portals':sum(r['kind']=='portal' for r in published),'countries':len({r['country_code'] for r in published}),'held':dict(collections.Counter(r['reason'] for r in held)),'existing_preserved':len(duplicate),'ontology_classes':len(seen),'status':'UNVERIFIED','worldwide_completeness':'Unknown; source-bounded acquisition, not a worldwide OTA census'})
    print(json.dumps({'ota_records':len(published),'held':len(held),'existing_preserved':len(duplicate)}),flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='backups/tourism-acquisition/ota')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--official-facts',default='docs/tourism-intelligence/ota-source-facts.json')
    parser.add_argument('--existing',default='backups/tourism-acquisition/ota/catalog-before-ota.json')
    args = parser.parse_args()
    source = Acquisition(args.out, args.refresh)
    articles, categories, queue = {}, [], collections.deque([('Category:Online travel agencies', 0)])
    while queue:
        category, depth = queue.popleft()
        if category in categories:
            continue
        if len(categories) >= 25:
            raise ValueError('Category scope exceeds bounded acquisition')
        categories.append(category)
        continuation = {}
        while True:
            params = {'action':'query','list':'categorymembers','cmtitle':category,'cmlimit':500,**continuation}
            cache = 'category-' + hashlib.sha256(json.dumps(params,sort_keys=True).encode()).hexdigest()[:16] + '.json'
            data = api(source,'en.wikipedia.org',params,cache)
            for member in data['query']['categorymembers']:
                if member['ns'] == 0:
                    articles[member['pageid']] = member
                elif member['ns'] == 14 and depth < 1 and re.search(r'Booking Holdings|Expedia Group|Trip.com Group', member['title']):
                    queue.append((member['title'], depth+1))
            if 'continue' not in data:
                break
            continuation = data['continue']
    qids = {}
    for index in range(0,len(articles),50):
        ids = list(articles)[index:index+50]
        data = api(source,'en.wikipedia.org',{'action':'query','prop':'pageprops','ppprop':'wikibase_item','pageids':'|'.join(map(str,ids))},f'pageprops-{index//50:03}.json')
        for page in data['query']['pages'].values():
            if page.get('pageprops',{}).get('wikibase_item'):
                qids[page['pageprops']['wikibase_item']] = page
    receipts = []
    for query in ('"online travel agency"', '"online travel agent"', '"online travel marketplace"'):
        offset, found, total = 0,set(),0
        while True:
            params = {'action':'query','list':'search','srsearch':query,'srnamespace':0,'srlimit':50,'sroffset':offset,'srprop':'','srsort':'create_timestamp_asc'}
            cache = 'search-' + hashlib.sha256(json.dumps(params,sort_keys=True).encode()).hexdigest()[:16] + '.json'
            data = api(source,'www.wikidata.org',params,cache)
            total = data.get('query',{}).get('searchinfo',{}).get('totalhits',0)
            found.update(row['title'] for row in data.get('query',{}).get('search',[]) if re.fullmatch(r'Q\d+',row['title']))
            if 'continue' not in data:
                break
            offset = data['continue']['sroffset']
            if offset > 2000:
                raise ValueError('OTA search scope exceeded; no silent truncation')
        for qid in found:
            qids.setdefault(qid,None)
        receipts.append({'query':query,'reported_hits':total,'unique_ids':len(found),'complete_for_query':len(found)==total})
    entities = {}
    extra = api(source,'en.wikipedia.org',{'action':'query','prop':'pageprops','ppprop':'wikibase_item','titles':'Traveloka|Klook|Civitatis|MakeMyTrip|Booking.com|Trip.com'},'extra-pageprops.json')
    for page in extra['query']['pages'].values():
        if page.get('pageprops',{}).get('wikibase_item'):
            qids[page['pageprops']['wikibase_item']] = page
    for index in range(0,len(qids),50):
        ids = sorted(qids)[index:index+50]
        cache = 'entities-' + hashlib.sha256('|'.join(ids).encode()).hexdigest()[:16] + '.json'
        data = api(source,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'labels|descriptions|claims','languages':'en|it|fr|de|es'},cache)
        entities.update(data['entities'])
    source.save('entities.json',entities)
    source.save('discovery.json',{'categories':categories,'articles':len(articles),'queries':receipts,'candidate_entities':len(entities),'pages_by_qid':qids})
    summary = []
    for qid,entity in entities.items():
        label = next((entity.get('labels',{}).get(lang,{}).get('value') for lang in ('en','it','fr','de','es') if entity.get('labels',{}).get(lang)), '')
        description = entity.get('descriptions',{}).get('en',{}).get('value','')
        summary.append({'qid':qid,'name':label,'description':description,'explicit_ota':explicit_ota_role(description),'countries':[v.get('id') for v in values(entity,'P17') if isinstance(v,dict)],'types':[v.get('id') for v in values(entity,'P31') if isinstance(v,dict)],'dissolved':bool(values(entity,'P576')),'website':next((url for v in values(entity,'P856') if (url:=public_url(v))),None)})
    source.save('summary.json',summary)
    stage(source,entities,qids,args.official_facts,args.existing)
    print(json.dumps({'candidate_entities':len(entities),'explicit_ota':sum(r['explicit_ota'] for r in summary),'categories':len(categories),'queries':receipts}),flush=True)


if __name__ == '__main__':
    main()
