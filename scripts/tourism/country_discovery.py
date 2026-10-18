#!/usr/bin/env python3
"""Country-by-country gap discovery using Wikidata's public structured search.

Only publishes candidates with an explicit country claim and an organization
class path. Buildings, people, topics, facilities and dissolved entities stay out.
Search coverage is never described as a complete real-world census.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import urllib.parse

from acquire import Acquisition, institutional_email, public_url
from wikipedia_agencies import api, values

ROOTS = {'Q43229','Q327333','Q192350','Q783794','Q4830453','Q3689421'}
FACILITIES = {'Q41176','Q1587716','Q18411786','Q5','Q13442814','Q571','Q3918','Q3914','Q2385804'}


def ancestry_reaches(type_id, parents, targets, visited=None):
    visited = set() if visited is None else visited
    if type_id in targets:
        return True
    if type_id in visited:
        return False
    visited.add(type_id)
    return any(ancestry_reaches(parent, parents, targets, visited) for parent in parents.get(type_id, []))


def tourism_organization_role(label, description):
    # Municipalities can have an organization ancestor in Wikidata. A class path
    # alone must not turn a tourist city, a school or a publication into a DMO.
    if re.search(r'^(?:city|town|commune|municipality|village|settlement|island|university|school|college|higher education)\b',description,re.I):
        return False
    if re.search(r'^(?:école|school|university|universit[a-zàé]*|universidad|escuela|hochschule|college|academy|minister of|minister for|ministre de|ministre du|ministro de)\b',label,re.I):
        return False
    if re.search(r'\b(?:university|universit[a-zàé]*|universidad|universidade|school|école|escuela|college|faculty|academy|académie|higher institute|international institute of (?:tourism|hotel)|institute of (?:tourism|hotel management))\b',label,re.I):
        return False
    combined=label+' '+description
    if not (re.search(r'touris|turis|turiz|tourismus|travel|destination (?:marketing|management)|convention.{0,20}(?:visitors|bureau)|\bdmc\b|\bparks?\b|\btours?\b',label,re.I) or re.search(r'(?:touris[mt]|travel).{0,20}(?:agency|authority|board|bureau|organi[sz]ation|company|association|office)|(?:promot|develop|dealing with).{0,60}touris|(?:tour operator|destination (?:marketing|management)|convention.{0,20}(?:visitors|bureau))',description,re.I)):
        return False
    if re.search(r'\b(?:airline|bus company|railway company|railroad company|hotel chain|university|higher education|education organization|academic department|academic institution|scholarly research|vocational)\b',description,re.I):
        return False
    if re.search(r'television station|telecommunication company|internet service provider|software company|news agency',description,re.I):
        return False
    if re.search(r'travel.{0,20}agency|transport(?:ation)?.{0,20}(?:company|agency)|(?:company|agency).{0,20}transport|cable car|\bcompany\b|travel platform',description+' '+label,re.I) and not re.search(r'destination management company|\bdmc\b|(?:inbound|incoming) (?:tour|travel)',combined,re.I):
        return False
    return bool(re.search(r'\b(?:ministry|agency|authority|board|bureau|organi[sz]ation|corporation|company|association|federation|council|department|commission|tour operator|dmc|tourism office|tourist office|travel agency)\b|tourismusverband|office.{0,35}tourisme|ente.{0,35}turismo|ministeri',label+' '+description,re.I))


def identity_text(entity):
    label=next((entity.get('labels',{}).get(lang,{}).get('value') for lang in ('en','it','fr','de','es') if entity.get('labels',{}).get(lang)), '')
    description=next((entity.get('descriptions',{}).get(lang,{}).get('value') for lang in ('en','it') if entity.get('descriptions',{}).get(lang)), '')
    return label,description


def candidate_classes(entities):
    # Apply the same mandatory role/name checks before traversing ontology.
    # This keeps cities and unrelated topics out of the bounded class crawl.
    result=set()
    for entity in entities.values():
        label,description=identity_text(entity)
        types={v['id'] for v in values(entity,'P31') if isinstance(v,dict) and v.get('id')}
        if 2<=len(label)<=200 and tourism_organization_role(label,description) and not values(entity,'P576') and not types & FACILITIES:
            result.update(types)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='backups/tourism-acquisition/candidates-combined-validated.json')
    parser.add_argument('--out', default='backups/tourism-acquisition/country-discovery')
    parser.add_argument('--all-countries', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    source = Acquisition(args.out,args.refresh)
    base = json.loads(pathlib.Path(args.base).read_text())
    known = {r['country_code'] for r in base if r['kind']=='organization'}
    reference = {r['iso']['value']:r for r in json.loads((source.root.parent/'wikidata-countries.json').read_text())['results']['bindings'] if r['iso']['value'] in source.valid_codes}
    country_map = {r['country']['value'].rsplit('/',1)[-1]:code for code,r in reference.items()}
    countries = {code:r for code,r in reference.items() if args.all_countries or code not in known}
    candidates, receipts = set(), []
    for code,row in sorted(countries.items()):
        country_id = row['country']['value'].rsplit('/',1)[-1]
        query = '(tourism OR tourisme OR turismo OR Tourismus OR туризм OR سياحة OR 旅游 OR 観光) haswbstatement:P17='+country_id
        offset, ids, total = 0,set(),None
        while True:
            data = api(source,'www.wikidata.org',{'action':'query','list':'search','srsearch':query,'srnamespace':0,'srlimit':50,'sroffset':offset,'srprop':'','srsort':'create_timestamp_asc'},f'search-{code}-created-{offset:04}.json')
            rows = data.get('query',{}).get('search',[])
            total = data.get('query',{}).get('searchinfo',{}).get('totalhits',0)
            ids.update(r['title'] for r in rows if re.fullmatch(r'Q\d+',r['title']))
            if 'continue' not in data:
                break
            offset = data['continue']['sroffset']
            if offset>5000:
                raise ValueError('Country search unexpectedly large; review before continuation')
        candidates.update(ids)
        receipts.append({'country_code':code,'country_name':row['countryLabel']['value'],'query':query,'sort':'create_timestamp_asc','reported_hits':total,'unique_ids':len(ids),'complete_for_query':len(ids)==total})
        print(json.dumps({'searched_countries':len(receipts),'total_countries':len(countries),'candidate_entities':len(candidates),'country':code}),flush=True)
    entities = {}
    for index in range(0,len(candidates),50):
        ids = sorted(candidates)[index:index+50]
        data = api(source,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'labels|descriptions|claims','languages':'en|it|fr|de|es'},f'entities-{hashlib.sha256("|".join(ids).encode()).hexdigest()[:16]}.json')
        entities.update(data['entities'])
    parents, types_seen = {},set()
    frontier = candidate_classes(entities)
    for depth in range(10):
        frontier -= types_seen | ROOTS | FACILITIES
        if not frontier:
            break
        if len(types_seen)+len(frontier)>2000:
            raise ValueError('Ontology scope exceeded; cannot assert organizational identity')
        next_frontier = set()
        for index in range(0,len(frontier),50):
            ids = sorted(frontier)[index:index+50]
            data = api(source,'www.wikidata.org',{'action':'wbgetentities','ids':'|'.join(ids),'props':'claims','languages':'en'},f'classes-{hashlib.sha256("|".join(ids).encode()).hexdigest()[:16]}.json')
            for qid,entity in data['entities'].items():
                parents[qid]=[v['id'] for v in values(entity,'P279') if isinstance(v,dict) and v.get('id')]
                next_frontier.update(parents[qid])
        types_seen.update(frontier)
        frontier=next_frontier
        print(json.dumps({'ontology_depth':depth+1,'classes_loaded':len(types_seen)}),flush=True)
    records,held,coverage=[],collections.Counter(),[]
    for qid,entity in entities.items():
        label,description=identity_text(entity)
        if not 2<=len(label)<=200:
            held['name_not_available']+=1
            continue
        if not tourism_organization_role(label,description):
            held['tourism_organization_role_not_established']+=1
            continue
        types={v['id'] for v in values(entity,'P31') if isinstance(v,dict) and v.get('id')}
        if values(entity,'P576') or any(ancestry_reaches(t,parents,FACILITIES) for t in types):
            held['person_facility_publication_or_dissolved']+=1
            continue
        if not any(ancestry_reaches(t,parents,ROOTS) for t in types):
            held['organization_class_not_established']+=1
            continue
        country_statements=entity.get('claims',{}).get('P17',[])
        preferred=[s for s in country_statements if s.get('rank')=='preferred']
        country_values=[s.get('mainsnak',{}).get('datavalue',{}).get('value') for s in preferred] if preferred else values(entity,'P17')
        codes=list(dict.fromkeys(country_map[v['id']] for v in country_values if isinstance(v,dict) and v.get('id') in country_map))
        if not codes:
            held['country_claim_not_available']+=1
            continue
        if len(codes)>1:
            held['ambiguous_country_claims']+=1
            continue
        combined=label+' '+description
        category='dmo' if 'Q3689421' in types else 'other'
        if (any(ancestry_reaches(t,parents,{'Q192350','Q2446662'}) for t in types) or re.match(r'^(?:Ministry|Ministries|Ministère|Ministerio|Ministero|Ministério|Ministerium)\b',label,re.I)) and re.search(r'touris|turis',combined,re.I):category='ministry'
        elif re.search(r'national touris[mt] (?:board|organi[sz]ation|agency)',combined,re.I):category='nto'
        elif re.search(r'touris[mt].{0,25}authority',combined,re.I):category='development_authority'
        elif re.search(r'destination management company|\bdmc\b|(?:inbound|incoming) (?:tour|travel)',combined,re.I):category='dmc'
        elif re.search(r'convention.{0,30}bureau',combined,re.I):category='cvb'
        elif category=='other' and re.search(r'office.{0,45}touris|touris[mt].{0,20}office|tourist information (?:office|bureau)',label,re.I):category='local_office'
        elif category=='other' and re.search(r'association|federation|fédération|tourismusverband|pro loco',label,re.I):category='association'
        elif category=='other' and re.search(r'\bparks?\b',label,re.I):category='park'
        website=next((url for v in values(entity,'P856') if (url:=public_url(v))),None)
        email=next((mail for v in values(entity,'P968') if (mail:=institutional_email(str(v).removeprefix('mailto:')))),None)
        aliases=list(dict.fromkeys(v['value'] for v in entity.get('labels',{}).values() if isinstance(v.get('value'),str) and 2<=len(v['value'])<=200 and v['value']!=label))[:20]
        evidence={'source_url':'https://www.wikidata.org/wiki/'+qid,'title':'Wikidata organization and country claims — '+label[:180],'excerpt':('Candidate found through a country-scoped tourism search. Organization class ancestry and country claim checked against Wikidata. '+description)[:2000],'fields':['name','country_code','type_code']+(['website'] if website else [])+(['email'] if email else [])+(['aliases'] if aliases else []),'method':'import'}
        for code in codes:
            records.append({'kind':'organization','name':label,'country_code':code,'type_code':category,'website':website,'email':email,'phone':None,'aliases':aliases,'external_ids':{'wikidata':qid},'details':{'description':description[:2000],'acquisition':{'source':'wikidata:country-discovery','classification_rule':'country_claim_and_organization_class_path','self_reported':False}},'evidence':evidence,'source_evidence':[evidence]})
            for jurisdiction in values(entity,'P1001'):
                if isinstance(jurisdiction,dict) and jurisdiction.get('id') in country_map:coverage.append({'organization_wikidata':qid,'organization_country':code,'covered_country':country_map[jurisdiction['id']],'source_url':evidence['source_url']})
    source.save('candidates.json',records)
    source.save('country-coverage.json',coverage)
    report={'source':'wikidata:country-discovery','checked_at':source.now,'countries_searched':len(countries),'candidate_entities':len(candidates),'classes_loaded':len(types_seen),'organization_rows':len(records),'countries_with_candidates':len({r['country_code'] for r in records}),'held':dict(held),'queries':receipts,'complete_for_queries':all(r['complete_for_query'] for r in receipts),'worldwide_completeness':'Unknown; public-search coverage is not a real-world census','license':'CC0'}
    source.save('report.json',report)
    print(json.dumps({k:v for k,v in report.items() if k!='queries'}),flush=True)


if __name__=='__main__':
    main()
