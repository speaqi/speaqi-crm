// LeadOcean keyword phrases, not official industry classifications. Multiple
// phrases are ORed by the provider and results need human qualification.
type LeadOceanCategory = { id: string; label: string; keywords: readonly string[] }
type LeadOceanCategoryGroup = { label: string; categories: readonly LeadOceanCategory[] }

export const LEADOCEAN_CATEGORY_GROUPS: readonly LeadOceanCategoryGroup[] = [
  { label: 'Viaggi e distribuzione', categories: [
    { id: 'tour-operator', label: 'Tour operator', keywords: ['tour operator', 'tour organizer', 'tour organiser'] },
    { id: 'dmc', label: 'Destination management · DMC', keywords: ['destination management company', 'destination management'] },
    { id: 'travel-agency', label: 'Agenzie di viaggio', keywords: ['travel agency', 'travel agent', 'travel agencies'] },
    { id: 'ota', label: 'Portali di viaggio · OTA', keywords: ['online travel agency', 'travel booking platform'] },
    { id: 'travel-wholesale', label: 'Grossisti di viaggi', keywords: ['travel wholesaler', 'travel wholesale', 'travel trade'] },
    { id: 'travel-advisor', label: 'Consulenti di viaggio', keywords: ['travel advisor', 'travel consultant'] },
    { id: 'group-travel', label: 'Viaggi di gruppo', keywords: ['group travel', 'group tours'] },
    { id: 'incoming', label: 'Turismo incoming', keywords: ['incoming tourism', 'inbound tour operator'] },
  ] },
  { label: 'Navigazione e trasporti', categories: [
    { id: 'cruise', label: 'Compagnie di crociera', keywords: ['cruise line', 'cruise operator'] },
    { id: 'ferry', label: 'Traghetti', keywords: ['ferry operator', 'ferry company', 'ferry service'] },
    { id: 'river-cruise', label: 'Crociere fluviali', keywords: ['river cruise', 'river cruises'] },
    { id: 'shore-excursion', label: 'Escursioni per croceristi', keywords: ['shore excursion', 'shore excursions'] },
    { id: 'maritime-tourism', label: 'Turismo nautico', keywords: ['boat tours', 'boat excursions', 'yacht charter'] },
    { id: 'airline', label: 'Compagnie aeree', keywords: ['airline', 'air carrier'] },
    { id: 'train', label: 'Ferrovie turistiche', keywords: ['tourist railway', 'scenic railway'] },
    { id: 'coach', label: 'Bus turistici', keywords: ['sightseeing bus', 'tour coach', 'hop on hop off'] },
  ] },
  { label: 'Destinazioni e cultura', categories: [
    { id: 'tourism-board', label: 'Enti del turismo', keywords: ['tourism board', 'tourist board', 'tourism office'] },
    { id: 'dmo', label: 'Enti destinazione · DMO', keywords: ['destination marketing organization', 'destination management organization', 'destination marketing organisation'] },
    { id: 'tourism-consortium', label: 'Consorzi turistici', keywords: ['tourism consortium', 'tourist consortium', 'consorzio turistico'] },
    { id: 'visitor-centre', label: 'Centri visitatori', keywords: ['visitor center', 'visitor centre', 'tourist information center'] },
    { id: 'museums', label: 'Musei e patrimonio', keywords: ['museum', 'cultural heritage'] },
    { id: 'attractions', label: 'Attrazioni e parchi', keywords: ['tourist attraction', 'visitor attraction', 'theme park'] },
    { id: 'tour-guides', label: 'Guide ed escursioni', keywords: ['tour guide', 'guided tours', 'walking tours'] },
    { id: 'experiences', label: 'Esperienze e attività', keywords: ['travel experiences', 'tours and activities', 'tourism experiences'] },
  ] },
  { label: 'Partner e tecnologia', categories: [
    { id: 'travel-tech', label: 'Tecnologia per il turismo', keywords: ['travel technology', 'tourism technology', 'travel tech'] },
    { id: 'booking-tech', label: 'Prenotazioni e distribuzione', keywords: ['booking technology', 'reservation system', 'travel distribution'] },
    { id: 'travel-association', label: 'Associazioni turistiche', keywords: ['travel association', 'tourism association', 'travel trade association'] },
    { id: 'travel-media', label: 'Media e editoria di viaggio', keywords: ['travel media', 'travel publisher', 'travel magazine'] },
    { id: 'mice', label: 'Eventi e viaggi MICE', keywords: ['destination management events', 'incentive travel', 'meeting and events'] },
    { id: 'tourism-marketing', label: 'Marketing turistico', keywords: ['tourism marketing', 'destination marketing', 'travel marketing'] },
    { id: 'travel-insurance', label: 'Assicurazioni viaggio', keywords: ['travel insurance'] },
    { id: 'local-development', label: 'Sviluppo turistico locale', keywords: ['tourism development', 'local tourism development'] },
  ] },
]

export const LEADOCEAN_CATEGORIES = LEADOCEAN_CATEGORY_GROUPS.flatMap(group => group.categories)

export function categoryKeywords(ids: readonly string[]): string[] {
  const selected = new Set(ids)
  return [...new Set(LEADOCEAN_CATEGORIES.filter(category => selected.has(category.id)).flatMap(category => [...category.keywords]))]
}

export function categorySearchFilters(kind: 'companies' | 'people', query: string, ids: readonly string[]): Record<string, unknown> {
  const keywords = categoryKeywords(ids)
  if (kind === 'companies') {
    const terms = [...new Set([...(query ? [query] : []), ...keywords])]
    return terms.length ? { keywords: terms } : {}
  }
  return { ...(query ? { q: query } : {}), ...(keywords.length ? { companyKeywords: keywords } : {}) }
}
