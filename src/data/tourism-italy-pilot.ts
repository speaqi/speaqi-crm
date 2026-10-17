// Source-backed research fixture, reviewed 2026-10-17. Import is intentionally UNVERIFIED.
const identity = ['name', 'country_code', 'type_code', 'website', 'coverage']
function org(
  name: string,
  type_code: string,
  website: string,
  source_url: string,
  description: string,
  email?: string,
  phone?: string
) {
  return {
    kind: 'organization',
    name,
    country_code: 'IT',
    type_code,
    website,
    email: email || null,
    phone: phone || null,
    details: { description },
    evidence: {
      source_url,
      title: `Identità e attività · ${name}`,
      excerpt: description,
      fields: [
        ...identity,
        ...(email ? ['email'] : []),
        ...(phone ? ['phone'] : [])
      ]
    }
  }
}
function place(name: string, source_url: string, description: string) {
  return {
    kind: 'place',
    name,
    country_code: 'IT',
    details: { description },
    evidence: {
      source_url,
      title: `Territorio · ${name}`,
      excerpt: description,
      fields: ['name', 'country_code', 'coverage']
    }
  }
}
const records = [
  org(
    'ENIT S.p.A.',
    'nto',
    'https://www.enit.it/',
    'https://www.enit.it/it/chi-siamo',
    'Organizzazione nazionale che promuove l’offerta turistica italiana.'
  ),
  org(
    'Toscana Promozione Turistica',
    'rto',
    'https://www.toscanapromozione.it/',
    'https://www.toscanapromozione.it/agenzia/',
    'Agenzia regionale che promuove destinazioni e prodotti turistici della Toscana.',
    'info@toscanapromozione.it',
    '+39 055 462801'
  ),
  org(
    'Visit Piemonte S.c.r.l.',
    'dmo',
    'https://www.visitpiemonte-dmo.org/',
    'https://www.visitpiemonte-dmo.org/chi-siamo/',
    'DMO del Piemonte, società in house della Regione Piemonte e di Unioncamere Piemonte.'
  ),
  org(
    'GAL Cilento ReGeneratio',
    'gal',
    'https://www.galcilento.it/',
    'https://www.galcilento.it/storia/',
    'Gruppo di Azione Locale con territorio di riferimento negli STS Alto Calore, Alento Monte Stella e Gelbison Cervati. La copertura non coincide con tutto il Cilento.',
    'info@galcilento.it'
  ),
  org(
    'Trentino Marketing S.r.l.',
    'rto',
    'https://www.trentinomarketing.org/',
    'https://www.trentinomarketing.org/it/chi-siamo',
    'Agenzia di marketing turistico territoriale della Provincia autonoma di Trento.',
    'direzione@trentinomarketing.org'
  ),
  org(
    'Ente Parco Nazionale delle Cinque Terre',
    'park',
    'https://www.parconazionale5terre.it/',
    'https://www.parconazionale5terre.it/contatti.php',
    'Ente di gestione del Parco Nazionale delle Cinque Terre. Il perimetro del parco e la destinazione Cinque Terre sono entità distinte.',
    'infopoint@parconazionale5terre.it'
  ),
  org(
    'Italy Creative',
    'dmc',
    'https://www.italycreative.it/',
    'https://www.italycreative.it/',
    'DMC e operatore incoming indipendente che opera in Italia. La presenza commerciale non implica governance territoriale.'
  ),
  org(
    'Fondazione Bologna Welcome',
    'foundation',
    'https://www.fondazionebolognawelcome.org/',
    'https://www.fondazionebolognawelcome.org/it/informazioni/oggetto-sociale',
    'Fondazione che svolge attività di promozione, informazione e accoglienza nel territorio di Bologna. Non confondere con le altre società che usano il brand Bologna Welcome.'
  ),
  place(
    'Italia',
    'https://www.enit.it/it/chi-siamo',
    'Paese rappresentato da ENIT.'
  ),
  place(
    'Toscana',
    'https://www.toscanapromozione.it/agenzia/',
    'Regione oggetto dell’attività dell’agenzia regionale.'
  ),
  place(
    'Piemonte',
    'https://www.visitpiemonte-dmo.org/chi-siamo/',
    'Regione oggetto dell’attività della DMO Visit Piemonte.'
  ),
  place(
    'Trentino',
    'https://www.trentinomarketing.org/it/chi-siamo',
    'Territorio della Provincia autonoma di Trento; non equivale alla regione Trentino-Alto Adige.'
  ),
  place(
    'Territorio STS A2 A3 A4 · GAL Cilento',
    'https://www.galcilento.it/storia/',
    'Area di riferimento dichiarata dal GAL: Alto Calore, Alento Monte Stella e Gelbison Cervati.'
  ),
  place(
    'Parco Nazionale delle Cinque Terre',
    'https://www.parconazionale5terre.it/pagina.php?id=334',
    'Area protetta: estensione e comuni elencati nelle FAQ dell’ente. Confine geometrico non importato.'
  ),
  place(
    'Bologna · territorio metropolitano',
    'https://www.fondazionebolognawelcome.org/it/informazioni/oggetto-sociale',
    'Territorio turistico citato nell’oggetto sociale della Fondazione.'
  ),
  {
    kind: 'brand',
    name: 'Trentino',
    country_code: 'IT',
    evidence: {
      source_url: 'https://www.trentinomarketing.org/it/chi-siamo',
      title: 'Brand Trentino',
      excerpt:
        'Il sito istituzionale descrive l’attività di rafforzamento del Brand Trentino.',
      fields: ['name', 'relationship']
    }
  },
  {
    kind: 'portal',
    name: 'VisitTrentino.info',
    country_code: 'IT',
    website: 'https://www.visittrentino.info/',
    evidence: {
      source_url: 'https://www.trentinomarketing.org/it/brand-communication',
      title: 'Asset digitali Trentino Marketing',
      excerpt:
        'La pagina Brand & Communication elenca il sito VisitTrentino.info tra gli asset digitali curati dall’unità.',
      fields: ['name', 'website', 'relationship']
    }
  }
]
const relations = [
  { from_index: 0, to_index: 8, relation: 'PROMOTES' },
  { from_index: 1, to_index: 9, relation: 'PROMOTES' },
  { from_index: 2, to_index: 10, relation: 'PROMOTES' },
  { from_index: 3, to_index: 12, relation: 'COVERS' },
  { from_index: 4, to_index: 11, relation: 'PROMOTES' },
  { from_index: 4, to_index: 15, relation: 'OPERATES_BRAND' },
  // The contacts page identifies the park authority; the separate park/territory link requires its own evidence.
  { from_index: 7, to_index: 14, relation: 'PROMOTES' }
]
export default {
  records,
  relations,
  metadata: {
    reviewed_at: '2026-10-17',
    organizations: 8,
    method:
      'Ricerca assistita su fonti ufficiali; revisione del workspace ancora richiesta',
    contact_data: 'Nessun dato personale o recapito dedotto',
    license:
      'Solo denominazioni e descrizioni fattuali originali; nessuna riproduzione massiva delle pagine'
  }
}
