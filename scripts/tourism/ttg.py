#!/usr/bin/env python3
"""Compare a dated public TTG acquisition with the current Tourism catalog.

The workspace fair table is a cached acquisition, not proof of today's live
directory completeness. Commercial notes, people and inferred scores are never
copied. Uncertain identities and invalid countries remain in the review export.
"""
import argparse
import collections
import csv
import datetime as dt
import json
import pathlib
import re
import urllib.parse

from acquire import Acquisition, name_key, public_url, institutional_email, domain


def legal_name_key(value):
    tokens = name_key(value).split()
    suffixes = {'srl','spa','srls','scarl','ltd','limited','llc','inc','incorporated','gmbh','bv','b v','plc','co','company'}
    while tokens and tokens[-1] in suffixes:
        tokens.pop()
    return re.sub(r'\b(?:s r l s|s r l|s p a|s c a r l|b v|l l c)$','', ' '.join(tokens)).strip()


def classify_ttg(name, category):
    label = name_key(name)
    category = (category or '').upper()
    if re.search(r'\bdmc\b|destination management company',label):
        return 'dmc','explicit_company_name'
    if re.search(r'\b(?:hotel|hotels|resort|resorts|hostel|hostels|glamping|camping|albergo|alberghi)\b',label):
        return 'accommodation','explicit_accommodation_name'
    if re.search(r'\bcamera di commercio\b|\bchamber of commerce\b',label):
        return 'chamber','explicit_organization_name'
    if re.search(r'\bconsorzio\b',label):
        return 'consortium','explicit_organization_name'
    if re.search(r'\bfondazione\b|\bfoundation\b',label):
        return 'foundation','explicit_organization_name'
    if re.search(r'\bgal\b|gruppo di azione locale',label):
        return 'gal','explicit_organization_name'
    if re.search(r'\b(?:ministero|ministry|ministere)\b',label):
        return 'ministry','explicit_organization_name'
    if re.search(r'ente (?:parco|gestore del parco)|national park|parco nazionale',label):
        return 'park','explicit_organization_name'
    if 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO' in category:
        if re.search(r'\b(?:nazionale|national)\b',label):
            return 'nto','published_destination_category_and_national_name'
        if re.search(r'\b(?:regionale|regional|regione|region of)\b',label):
            return 'rto','published_destination_category_and_regional_name'
        if 'CONVENTION BUREAU' in category and re.search(r'convention.{0,20}bureau',label):
            return 'cvb','published_category_and_name'
        if 'CONSORZI' in category and not re.search(r'RAPPRESENTANZE (?:ALBERGHIERE|TURISTICHE)',category):
            return 'consortium','published_consortium_category'
        if re.search(r'ENTI (?:ITALIANI DI PROMOZIONE TURISTICA|DEL TURISMO ESTERI)',category):
            return 'dmo','self_reported_destination_category'
    if re.search(r'\bDMC\b|TOUR OPERATOR INCOMING',category) or re.search(r'\bincoming\b|\binbound\b',label):
        if not re.search(r'SOFTWARE HOUSE|SERVIZI IT|COMPAGNIE AEREE',category):
            return 'dmc','published_incoming_or_dmc_role'
    if 'STRUTTURE RICETTIVE' in category:
        return 'accommodation','published_accommodation_category'
    if 'TOUR OPERATOR' in category:
        return 'tour_operator','published_tour_operator_category'
    if 'AGENZIE DI VIAGGI' in category:
        return 'travel_agency','published_travel_agency_category'
    if 'TECNOLOGIA/WEB' in category:
        # Online booking software is not evidence of being an OTA.
        return 'technology','published_technology_category'
    if 'TRASPORTI' in category:
        return 'transport','published_transport_category'
    if 'PARCHI TEMATICI' in category and not re.search(r'\bassociazione\b|\bassociation\b',label):
        return 'attraction','published_theme_park_category'
    if 'ASSOCIAZIONI' in category:
        return 'association','published_association_category'
    if re.search(r'CULTURA/ENTERTAINMENT|SPORT/BENESSERE/TEMPO LIBERO|TURISMO ENOGASTRONOMICO|TURISMO NAUTICO',category):
        return 'attraction','published_experience_category'
    if re.search(r'SERVIZI|MARKETING/COMUNICAZIONE|RAPPRESENTANZA|MEDIA/EDITORIA|FORMAZIONE/LAVORO/RICERCA',category):
        return 'tourism_supplier','published_supplier_category'
    return 'other','exhibitor_identity_only_requires_classification'


def build_indexes(catalog):
    names, legal, domains, global_names, profiles = (collections.defaultdict(set) for _ in range(5))
    by_id = {r['id']:r for r in catalog}
    for row in catalog:
        if row.get('external_ids',{}).get('ttg_2026'):
            profiles[row['external_ids']['ttg_2026']].add(row['id'])
        for n in [row['name']]+row.get('aliases',[]):
            if name_key(n):
                names[(row['country_code'],name_key(n))].add(row['id'])
                global_names[name_key(n)].add(row['id'])
                legal[(row['country_code'],legal_name_key(n))].add(row['id'])
        host = domain(row.get('website'))
        if host:
            domains[host].add(row['id'])
    return names,legal,domains,global_names,profiles,by_id


def match_identity(row, code, indexes):
    names,legal,domains,global_names,profiles,by_id = indexes
    source_profile = urllib.parse.parse_qs(urllib.parse.urlsplit(row.get('source_url') or '').query).get('digitalProfileId',[])
    known_profiles = profiles.get(source_profile[0],set()) if len(source_profile)==1 else set()
    if known_profiles:
        if len(known_profiles)>1 or (code and any(by_id[i]['country_code']!=code for i in known_profiles)):
            return 'review','ambiguous_or_country_conflicting_ttg_profile',known_profiles
        return 'existing','stable_ttg_2026_profile_id',known_profiles
    exact = names.get((code,name_key(row['name'])),set()) if code else set()
    host = domain(row.get('website'))
    if len(exact)==1:
        entity = by_id[next(iter(exact))]
        known_host = domain(entity.get('website'))
        if host and known_host and host!=known_host:
            return 'review','same_name_different_website',exact
        return 'existing','exact_name_or_sourced_alias_country',exact
    if exact:
        return 'review','ambiguous_exact_name',exact
    possible = set(legal.get((code,legal_name_key(row['name'])),set())) if code else set()
    if host:
        possible.update(domains.get(host,set()))
    possible.update(global_names.get(name_key(row['name']),set()))
    if possible:
        return 'review','possible_legal_name_domain_or_country_conflict',possible
    if not code:
        return 'review','missing_or_invalid_country',set()
    return 'new','no_catalog_identity_found',set()


def csv_cell(value):
    value = str(value or '')
    return "'"+value if value.lstrip().startswith(('=','+','-','@')) else value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input',default='backups/tourism-acquisition/ttg/catalog-before-ttg.json')
    parser.add_argument('--countries',default='backups/tourism-acquisition/ttg/italian-country-names.json')
    parser.add_argument('--out',default='backups/tourism-acquisition/ttg')
    parser.add_argument('--scope',choices=['destination'],default='destination')
    parser.add_argument('--facts',default='docs/tourism-intelligence/ttg-source-facts.json')
    args = parser.parse_args()
    source = Acquisition(args.out)
    snapshot = json.loads(pathlib.Path(args.input).read_text())
    facts = {name_key(r['name']):r for r in json.loads(pathlib.Path(args.facts).read_text())}
    names = {name_key(k):v for k,v in json.loads(pathlib.Path(args.countries).read_text()).items()}
    names.update(source.country_names)
    indexes = build_indexes(snapshot['catalog'])
    dispositions, candidates, existing_sources, seen = [],[],[],{}
    for row in sorted(snapshot['ttg'],key=lambda r:r['name'].casefold()):
        url = public_url(row.get('source_url'))
        parsed = urllib.parse.urlsplit(url or '')
        profile = urllib.parse.parse_qs(parsed.query).get('digitalProfileId',[])
        if parsed.hostname!='www.ttgexpo.it' or len(profile)!=1 or not re.fullmatch(r'\d+',profile[0]):
            raise ValueError('TTG source identity is missing or ambiguous')
        if profile[0] in seen:
            raise ValueError('Duplicate TTG profile ID; reconcile the source acquisition')
        seen[profile[0]] = row
        code = names.get(name_key(row.get('country')))
        category,rule = classify_ttg(row['name'],row.get('category'))
        fact = facts.get(name_key(row['name']))
        if fact:
            category,rule = fact['type_code'],'official_ota_service_source'
        state,match_rule,matches = match_identity(row,code,indexes)
        if state=='new' and not 2<=len(row['name'])<=200:
            state,match_rule = 'review','invalid_name_length'
        if state=='new' and category not in {'ministry','nto','rto','dmo','dmc','ota','cvb','gal','consortium','foundation','association','park','chamber'}:
            state,match_rule = 'outside_scope','outside_selected_destination_scope'
        record = {'source_profile_id':profile[0],'name':row['name'],'country_code':code or '', 'country_raw':row.get('country') or '', 'type_code':category,'classification_rule':rule,'disposition':state,'match_rule':match_rule,'catalog_ids':sorted(matches),'catalog_names':[indexes[-1][i]['name'] for i in sorted(matches)],'website':public_url(row.get('website')),'source_url':url,'source_created_at':row.get('created_at'),'source_updated_at':row.get('updated_at'),'source_category':row.get('category') or ''}
        dispositions.append(record)
        generic_email = institutional_email(row.get('email'))
        fields = ['name','country_code']+(['type_code'] if category!='other' and not fact else [])+(['website'] if record['website'] else [])+(['email'] if generic_email else [])
        evidence = {'source_url':url,'title':'TTG Travel Experience 2026 — '+row['name'][:170],'excerpt':('Dated TTG public acquisition already in the workspace fair table. Original import: '+str(row.get('created_at'))+'. Workspace last update: '+str(row.get('updated_at'))+'. This is not a fresh fetch of the live profile. Published categories: '+str(row.get('category') or 'not available'))[:2000],'fields':fields,'method':'import'}
        if state=='existing':
            entity = indexes[-1][next(iter(matches))]
            preserved = {**evidence,'fields':['name']+(['country_code'] if code else [])+(['website'] if entity.get('website')==record['website'] and record['website'] else [])+(['type_code'] if category==entity['type_code'] and category!='other' else [])}
            existing_sources.append({'entity_id':entity['id'],'evidence':preserved})
        elif state=='new':
            candidates.append({'kind':'organization','name':row['name'],'country_code':code,'type_code':category,'website':record['website'],'email':institutional_email(row.get('email')),'phone':None,'aliases':[],'external_ids':{'ttg_2026':profile[0]},'details':{'description':('Espositore TTG Travel Experience 2026. Categorie pubblicate: '+str(row.get('category') or 'non disponibili')+'. Dati acquisiti in precedenza nel CRM; identità e classificazione da verificare.')[:2000],'language':'it','acquisition':{'source':'ttg:2026-cached','classification_rule':rule,'self_reported':True,'event_edition_id':'ttg-2026'}},'evidence':evidence,'source_evidence':[evidence]})
            if fact:
                candidates[-1]['source_evidence'].append({'source_url':fact['source_url'],'title':'Official OTA service — '+row['name'][:170],'excerpt':fact['note'],'fields':['name','type_code'],'method':'import'})
    # Different TTG profiles with one identical country/name remain for review;
    # source identities are never silently collapsed into a single legal entity.
    duplicate_keys = collections.Counter((r['country_code'],legal_name_key(r['name'])) for r in candidates)
    duplicates = {k for k,n in duplicate_keys.items() if n>1}
    if duplicates:
        for r in dispositions:
            if r['disposition']=='new' and (r['country_code'],legal_name_key(r['name'])) in duplicates:
                r['disposition'],r['match_rule']='review','distinct_ttg_profiles_same_country_legal_name'
        candidates = [r for r in candidates if (r['country_code'],legal_name_key(r['name'])) not in duplicates]
    source.save('candidates.json',candidates)
    source.save('comparison.json',dispositions)
    source.save('existing-source-evidence.json',existing_sources)
    report = {'checked_at':source.now,'source':'TTG 2026 dated workspace acquisition','source_directory':'https://www.ttgexpo.it/it/elenco-espositori','source_rows':len(snapshot['ttg']),'unique_source_profiles':len(seen),'scope':args.scope,'dispositions':dict(collections.Counter(r['disposition'] for r in dispositions)),'review_reasons':dict(collections.Counter(r['match_rule'] for r in dispositions if r['disposition']=='review')),'new_organizations':len(candidates),'new_countries':len({r['country_code'] for r in candidates}),'new_types':dict(collections.Counter(r['type_code'] for r in candidates)),'existing_organizations':len({r['entity_id'] for r in existing_sources}),'live_directory_reconciled':False,'source_freshness':'Original imports and workspace update dates preserved per row; no live refetch established','verified':False}
    source.save('report.json',report)
    headers = ['name','country_code','country_raw','type_code','disposition','match_rule','catalog_names','website','source_url','source_updated_at']
    for file,rows in [('ttg-confronto-completo.csv',dispositions),('ttg-mancanti.csv',[r for r in dispositions if r['disposition']=='new']),('ttg-da-rivedere.csv',[r for r in dispositions if r['disposition']=='review'])]:
        with (source.root/file).open('w',encoding='utf-8-sig',newline='') as f:
            writer = csv.DictWriter(f,fieldnames=headers);writer.writeheader()
            for r in rows:
                writer.writerow({h:csv_cell(' | '.join(r[h]) if isinstance(r[h],list) else r[h]) for h in headers})
    print(json.dumps(report),flush=True)


if __name__=='__main__':
    main()
