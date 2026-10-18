#!/usr/bin/env python3
"""Extract institutional identities from captured public directory text.

The web connector supplies the captures when the execution network cannot reach
the publisher. These are discovery records, not attestations of current names.
Only countries missing from the base catalog are included in this expansion.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re

from acquire import Acquisition, name_key

UN_URL = 'https://www.untourism.int/member-states'
ETC_URL = 'https://etc-corporate.org/our-members/'
ALIASES = {'antigua and barbuda':'AG','democratic republic of the congo':'CD','congo':'CG','central african republic':'CF','fiji republic of':'FJ','lao people s democratic republic':'LA','papua new guinea independent state of':'PG','union of the comoros':'KM','vanuatu republic of':'VU','sao tome and principe':'ST'}
ROLE = re.compile(r'^(?:Minist|Department|Secretar|Instituto|Autoridad|Tourism Council)',re.I)


def capture_lines(paths):
    lines={}
    for path in paths:
        for line in pathlib.Path(path).read_text().splitlines():
            match=re.match(r'^L(\d+):\s?(.*)$',line)
            if match:
                number=int(match[1])
                # A capture can contain several pages; stop before ETC starts.
                if number in lines and lines[number]!=match[2]:
                    raise ValueError('Conflicting captured page lines; separate publishers')
                lines[number]=match[2]
    if not lines or sorted(lines)!=list(range(min(lines),max(lines)+1)):
        raise ValueError('Directory capture has missing lines')
    return [lines[index] for index in sorted(lines)]


def organization_names(lines):
    result=[]
    for line in lines:
        if ROLE.match(line) and re.search(r'touris|turis|turiz',line,re.I) and not re.search(r'^(?:Minister of|Ministre |Ministro )',line,re.I):
            result.append(line)
        for match in re.finditer(r'【\d+†([^†]+)†([^】]+)】',line):
            label=match[1]
            if ROLE.match(label) and re.search(r'touris|turis|turiz',label,re.I):
                result.append(label)
    return list(dict.fromkeys(result))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base',required=True)
    parser.add_argument('--un-capture',nargs='+',required=True)
    parser.add_argument('--out',default='backups/tourism-acquisition/official-directories')
    args=parser.parse_args()
    source=Acquisition(args.out)
    base=json.loads(pathlib.Path(args.base).read_text())
    known={r['country_code'] for r in base if r['kind']=='organization'}
    lines=capture_lines(args.un_capture)
    content='\n'.join(lines).split('## Associate Members')[0]
    blocks=re.split(r'\[Button: ([^\]]+)\]',content)
    records,held=[],[]
    for offset in range(1,len(blocks),2):
        country,body=blocks[offset],blocks[offset+1]
        code=ALIASES.get(name_key(country)) or source.country_code(country) or source.country_code(country.split(',')[0])
        if not code:
            held.append({'country':country,'reason':'country_label_not_resolved'})
            continue
        if code in known:
            continue
        names=organization_names(body.splitlines())
        if not names:
            held.append({'country':country,'reason':'no_explicit_tourism_organization_name'})
        for name in names:
            if len(name)>200:
                held.append({'country':country,'reason':'name_exceeds_application_limit'})
                continue
            category='ministry' if re.match(r'Minist|Secretar',name,re.I) else 'other'
            evidence={'source_url':UN_URL,'title':'UN Tourism: member-state institutional directory — '+country,'excerpt':'Institution named under '+country+': '+name+'. The directory can retain historical institutional names; current identity and remit require verification.','fields':['name','country_code','type_code'],'method':'import'}
            records.append({'kind':'organization','name':name,'country_code':code,'type_code':category,'website':None,'email':None,'phone':None,'aliases':[],'external_ids':{},'details':{'description':'Institution listed by UN Tourism. Current name and mandate require verification.','acquisition':{'source':'official:un-tourism','classification_rule':'explicit_institution_name_under_member_country','self_reported':False}},'evidence':evidence,'source_evidence':[evidence]})
    source.save('candidates.json',records)
    report={'source':'official:un-tourism','source_url':UN_URL,'checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'member_blocks':(len(blocks)-1)//2,'organization_rows':len(records),'new_countries':len({r['country_code'] for r in records}),'captures':[{'path':str(path),'sha256':hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()} for path in args.un_capture],'held':held,'worldwide_completeness':'Unknown','currency':'Unverified; directory contains historical names and contact details. Personal and unconfirmed contact fields omitted.'}
    source.save('report.json',report)
    print(json.dumps({k:v for k,v in report.items() if k not in ('held','captures')}))


if __name__=='__main__':
    main()
