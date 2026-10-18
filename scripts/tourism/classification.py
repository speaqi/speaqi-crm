"""Conservative commercial-role checks shared by public-source adapters."""
import re


def explicit_ota_role(description):
    intro = description[:450]
    if re.search(r'\b(?:defunct|dissolved|ceased operations|formerly an? online travel)\b', intro, re.I):
        return False
    role = re.search(r'online (?:travel|tourism) (?:agenc(?:y|ies)|agent)\b', intro, re.I)
    if role:
        prefix = intro[:role.start()]
        return not (re.search(r'\b(?:for|to|with|help|helping|connect|connecting|customers?|clients?|partners?|software|subsidiaries|supply|supplier|suppliers|serve|serving|solutions)\b', prefix, re.I) or re.match(r'\s+(?:software|solutions?|technology|support)\b', intro[role.end():], re.I))
    marketplace = re.search(r'online (?:travel marketplace|(?:marketplace|booking platform).{0,50}(?:book|travel|tours|experiences))|travel platform.{0,250}booking flights', intro, re.I)
    if not marketplace:
        return False
    return not re.search(r'metasearch|meta-search|search engine|comparison (?:website|site|platform)|software|technology (?:provider|company)|solutions? for|services? to|suppl(?:y|ier)|subsidiar|\b(?:build|builds|for)\b', intro[:marketplace.start()], re.I)
