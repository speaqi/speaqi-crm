// Profilo commerciale di un'azienda di Tourism Intelligence, senza leggere il sito.
//
// Si parte da quello che c'è già nel catalogo: tipo, nome, descrizione (categorie
// pubblicate in fiera, testo di LeadOcean o dell'espositore), settori, sede, email.
// Ne escono cosa fa l'azienda, a chi vende, in quali destinazioni lavora, cosa le
// possiamo offrire e il passo dopo. Il sito si legge solo dove i dati non bastano
// e l'azienda varrebbe la lettura (`next = 'read_site'`), o per trovare l'email.
// Puro: nessuna rete, nessun modello.

export type Activity =
  | 'incoming' // tour operator incoming, DMC
  | 'experiences' // escursioni, barca, cucina, vino, bici, trekking, guide turistiche
  | 'transport' // traghetti, bus, NCC, transfer, noleggio, treni
  | 'mice' // congressi, incentive, eventi, location
  | 'education' // viaggi d'istruzione, gruppi scuola
  | 'outgoing' // agenzie leisure, viaggi all'estero, network
  | 'promoter' // enti, consorzi, convention bureau, strade del vino
  | 'attraction' // musei, siti, parchi tematici
  | 'tech' // booking, software, OTA
  | 'media'
  | 'hosting' // property manager, affitti brevi: ospiti a cui girare la guida
  | 'other'

export type Audience = 'foreign' | 'domestic' | 'corporate' | 'unknown'
export type Offer = 'resale' | 'packages' | 'destination' | 'partnership' | 'none'
export type Coverage = 'online' | 'planned' | 'missing'
export type NextStep = 'write' | 'find_email' | 'read_site' | 'guide_needed' | 'destination_body' | 'no_contact' | 'skip'

export type ProfileInput = {
  name: string
  type_code: string | null
  description?: string | null
  industries?: unknown
  employees?: string | null
  hq_city?: string | null
  province?: string | null
  email?: string | null
  website?: string | null
}

export type PlaceHit = { key: string; label: string; coverage: Coverage; guide?: string; from: 'text' | 'hq' }

export type PartnerProfile = {
  activities: Activity[]
  audience: Audience
  places: PlaceHit[]
  offers: Offer[]
  /** Lavora in tutta Italia senza nominare un posto: può vendere ogni guida online. */
  national: boolean
  value: number
  next: NextStep
  why: string[]
  /** I dati non dicono abbastanza: descrizione assente o generica. */
  thin: boolean
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ——— Cosa fanno ———

const ACTIVITY_RULES: Array<[Activity, RegExp]> = [
  ['incoming', /\b(incoming|dmc|destination management|receptive|inbound|tailor[- ]made (tours|itineraries|trips)|tours? (in|of|across|throughout) italy|italy tours?|viaggi su misura in italia|wholesaler)\b/],
  ['experiences', /\b(escursion\w*|excursion\w*|boat (tours?|trips?)|in barca|charter nautico|cooking (class|school)|scuola di cucina|wine (tours?|tasting)|degustazion\w*|strade del vino|cicloturismo|bike tours?|cycling|e-?bike|trekking|hiking|walking (tours?|holidays)|turismo attivo|active holidays?|guided tours?|visite guidate|guide(\/| e )?accompagnatori|tour guides?|food tours?|esperienze (in|di|enogastronomiche)|(local|authentic|unique) experiences|attrazioni turistiche|(private|walking|city|food|wine|golf cart|vespa|segway|bike|boat|day) tours?|tours|experiences|tours? (of|in|around) [a-z]+|visite? (guidat\w*|della citta))\b/],
  ['transport', /\b(compagnie di navigazione|navigazione|ferr(y|ies)|traghett\w*|aliscaf\w*|bus operator|bus|autobus|autolinee|pullman|coach|noleggio (auto )?con conducente|ncc|transfers?|chauffeur|autonoleggi\w*|car rental|servizi di noleggio|ferrovi\w*|railways?|trenitalia|italo|limousine)\b/],
  ['mice', /\b(meeting industry|mice|incentive( house)?|congress\w*|convegn\w*|eventi aziendali|corporate events?|location per eventi|pco|team building|destination wedding|weddings?)\b/],
  ['education', /\b(viaggi d.istruzione|gite scolastiche|turismo scolastico|school (trips?|tours?)|student travel|educational tours?)\b/],
  ['outgoing', /\b(agenzi[ae] di viaggi?|travel agenc(y|ies)|agenzie di viaggi leisure|network di agenzie|business travel|olta|biglietteria|outgoing|viaggi nel mondo|crocier\w*|viaggi)\b/],
  ['promoter', /\b(promozione del territorio|enti italiani di promozione|consorzi turistici|club di prodotto|convention bureau|visitors? bureau|consorzio|pro loco|assessorat\w*|istituzioni\/enti pubblici|ente del turismo|tourism board|dmo)\b/],
  ['attraction', /\b(musei|museo|museum|siti archeologici|parchi tematici|theme park|acquario|zoo)\b/],
  ['tech', /\b(software|booking & prenotazioni|booking engine|gds|crs|servizi it|tecnologia\/web|channel manager|saas|platform|piattaforma|app)\b/],
  ['media', /\b(media\/editoria|editoria|magazine|rivista|blog|publisher|travel media)\b/],
]

const TYPE_ACTIVITY: Record<string, Activity> = {
  dmc: 'incoming', tour_operator: 'incoming', travel_agency: 'outgoing', ota: 'tech', technology: 'tech',
  transport: 'transport', ferry_operator: 'transport', airline: 'transport', cruise_line: 'transport',
  consortium: 'promoter', dmo: 'promoter', rto: 'promoter', cvb: 'promoter', nto: 'promoter', municipality: 'promoter',
  local_office: 'promoter', ministry: 'promoter', chamber: 'promoter', park: 'attraction', attraction: 'attraction',
  travel_media: 'media', experience_marketplace: 'tech', property_manager: 'hosting',
}

/** Strutture ricettive: per ora fuori dal giro (decisione del titolare). */
const LODGING = /\b(hotel|relais|resort|campeggio|camping|villaggio turistico|agriturismo|b&b|bed and breakfast|apartments?|residence|ostello|hostel)\b/

const GENERIC = /categorie pubblicate: non disponibili/

// ——— Dove lavorano ———

type Place = { key: string; label: string; coverage: Coverage; guide?: string; aliases: string[] }

/** Guide online oggi (catalogo del negozio guide). */
const ONLINE: Place[] = [
  { key: 'roma', label: 'Roma', coverage: 'online', guide: 'roma', aliases: ['roma', 'rome', 'vaticano', 'vatican'] },
  { key: 'milano', label: 'Milano', coverage: 'online', guide: 'milano', aliases: ['milano', 'milan'] },
  { key: 'venezia', label: 'Venezia', coverage: 'online', guide: 'venezia', aliases: ['venezia', 'venice', 'murano', 'burano'] },
  { key: 'firenze', label: 'Firenze', coverage: 'online', guide: 'firenze', aliases: ['firenze', 'florence'] },
  { key: 'napoli', label: 'Napoli', coverage: 'online', guide: 'napoli', aliases: ['napoli', 'naples'] },
  { key: 'bologna', label: 'Bologna', coverage: 'online', guide: 'bologna', aliases: ['bologna'] },
  { key: 'capri', label: 'Capri', coverage: 'online', guide: 'capri', aliases: ['capri', 'anacapri'] },
  { key: 'costiera-amalfitana', label: 'Costiera Amalfitana', coverage: 'online', guide: 'costiera-amalfitana',
    aliases: ['costiera amalfitana', 'amalfi coast', 'amalfi', 'positano', 'ravello', 'maiori', 'minori', 'praiano'] },
  { key: 'pompei', label: 'Pompei', coverage: 'online', guide: 'pompei', aliases: ['pompei', 'pompeii', 'ercolano', 'herculaneum'] },
]

/** Città nella lista di produzione di StudioMap (world-cities), non ancora online. */
const PLANNED: Place[] = [
  ['torino', 'Torino', ['torino', 'turin']], ['verona', 'Verona', ['verona']], ['genova', 'Genova', ['genova', 'genoa']],
  ['palermo', 'Palermo', ['palermo']], ['catania', 'Catania', ['catania', 'etna']], ['bari', 'Bari', ['bari']],
  ['matera', 'Matera', ['matera']], ['trieste', 'Trieste', ['trieste']], ['cagliari', 'Cagliari', ['cagliari']],
  ['lecce', 'Lecce', ['lecce', 'salento']], ['siracusa', 'Siracusa', ['siracusa', 'syracuse', 'ortigia']],
  ['bergamo', 'Bergamo', ['bergamo']], ['padova', 'Padova', ['padova', 'padua']], ['ravenna', 'Ravenna', ['ravenna']],
  ['perugia', 'Perugia', ['perugia']],
].map(([key, label, aliases]) => ({ key: key as string, label: label as string, coverage: 'planned' as const, aliases: aliases as string[] }))

/** Destinazioni che ci chiedono e non abbiamo in programma: servono a decidere le prossime guide. */
const MISSING: Place[] = [
  ['sorrento', 'Sorrento', ['sorrento', 'penisola sorrentina', 'sorrentine peninsula']], ['ischia', 'Ischia', ['ischia']],
  ['procida', 'Procida', ['procida']], ['taormina', 'Taormina', ['taormina']], ['cinque-terre', 'Cinque Terre', ['cinque terre', 'portofino']],
  ['lago-garda', 'Lago di Garda', ['lago di garda', 'lake garda', 'garda', 'sirmione', 'desenzano']],
  ['lago-como', 'Lago di Como', ['lago di como', 'lake como', 'bellagio']], ['dolomiti', 'Dolomiti', ['dolomiti', 'dolomites', 'cortina']],
  ['siena', 'Siena', ['siena', 'san gimignano', 'chianti', 'val d.orcia', 'montepulciano']], ['pisa', 'Pisa', ['pisa']],
  ['lucca', 'Lucca', ['lucca']], ['assisi', 'Assisi', ['assisi']], ['langhe', 'Langhe', ['langhe', 'barolo', 'alba']],
  ['modena', 'Modena', ['modena', 'motor valley']], ['parma', 'Parma', ['parma']], ['rimini', 'Rimini', ['rimini', 'riviera romagnola']],
  ['puglia', 'Puglia', ['puglia', 'apulia', 'alberobello', 'polignano', 'monopoli', 'ostuni']],
  ['sicilia', 'Sicilia', ['sicilia', 'sicily', 'agrigento', 'eolie', 'aeolian', 'lipari', 'cefalu', 'trapani', 'marsala']],
  ['sardegna', 'Sardegna', ['sardegna', 'sardinia', 'olbia', 'costa smeralda', 'alghero', 'cagliari']],
  ['toscana', 'Toscana', ['toscana', 'tuscany']], ['umbria', 'Umbria', ['umbria']], ['marche', 'Marche', ['marche']],
  ['calabria', 'Calabria', ['calabria', 'tropea']], ['abruzzo', 'Abruzzo', ['abruzzo']], ['liguria', 'Liguria', ['liguria']],
  ['piemonte', 'Piemonte', ['piemonte', 'piedmont']], ['trentino', 'Trentino-Alto Adige', ['trentino', 'alto adige', 'south tyrol', 'sudtirol']],
  ['veneto', 'Veneto', ['veneto']], ['campania', 'Campania', ['campania']], ['cilento', 'Cilento', ['cilento', 'paestum']],
].map(([key, label, aliases]) => ({ key: key as string, label: label as string, coverage: 'missing' as const, aliases: aliases as string[] }))

const PLACES: Place[] = [...ONLINE, ...PLANNED, ...MISSING]
const PLACE_PATTERNS = PLACES.map((p) => ({ place: p, re: new RegExp(`(^|[^a-z])(${p.aliases.map((a) => a.replace(/ /g, '\\s+')).join('|')})([^a-z]|$)`) }))

export function findPlaces(text: string): Place[] {
  const t = fold(text)
  const out: Place[] = []
  for (const { place, re } of PLACE_PATTERNS) if (re.test(t) && !out.some((p) => p.key === place.key)) out.push(place)
  // «Cagliari» sta sia in Sardegna sia nella lista di produzione: vale la città.
  return out.filter((p) => !(p.key === 'sardegna' && out.some((q) => q.key === 'cagliari') && !/sardegna|sardinia/.test(t)))
}

// ——— A chi vendono ———

const NATIONAL = /\b(all over italy|throughout italy|across italy|whole of italy|in italy|italy tours?|tours? (of|in) italy|tutta italia|in italia|italia intera|italian destinations)\b/
const FOREIGN = /\b(incoming|inbound|international|foreign (guests|visitors|clients)|stranieri|from abroad|discover italy|in italy|across italy|tours? of italy|receptive)\b/
const DOMESTIC = /\b(italiani|clientela italiana|gite|weekend|scuole|fuori porta)\b/
const CORPORATE = /\b(corporate|aziende|business travel|incentive|mice|congress\w*|meeting)\b/
const ENGLISH = /\b(the|and|with|our|we|tours|travel)\b/g

function audienceOf(t: string, activities: Activity[]): Audience {
  if (FOREIGN.test(t) || activities.includes('incoming')) return 'foreign'
  if ((t.match(ENGLISH) || []).length >= 4) return 'foreign'
  if (CORPORATE.test(t) && activities.includes('mice')) return 'corporate'
  if (DOMESTIC.test(t) || activities.includes('outgoing') || activities.includes('education')) return 'domestic'
  return 'unknown'
}

// ——— Cosa offrire ———

const OFFERS: Record<Activity, Offer[]> = {
  incoming: ['resale', 'packages'], experiences: ['resale'], transport: ['resale'], mice: ['packages'], education: ['packages'],
  outgoing: ['packages'], hosting: ['resale'], promoter: ['destination'], attraction: ['resale'], tech: ['partnership'], media: ['partnership'], other: [],
}

const BASE: Record<Activity, number> = {
  incoming: 35, experiences: 32, transport: 30, mice: 22, education: 22, promoter: 25, hosting: 24, attraction: 18, outgoing: 12, media: 10, tech: 8, other: 4,
}

export function profilePartner(input: ProfileInput): PartnerProfile {
  const description = String(input.description || '')
  const industries = Array.isArray(input.industries) ? input.industries.join(' ') : String(input.industries || '')
  const text = `${input.name} ${description} ${industries}`
  const t = fold(text)
  const why: string[] = []

  const activities: Activity[] = []
  for (const [activity, re] of ACTIVITY_RULES) if (re.test(t)) activities.push(activity)
  const typed = input.type_code ? TYPE_ACTIVITY[input.type_code] : undefined
  if (typed && !activities.includes(typed)) activities.push(typed)
  // Un tour operator che fa anche escursioni resta prima di tutto un tour operator.
  activities.sort((a, b) => BASE[b] - BASE[a])
  if (!activities.length) activities.push('other')

  const textPlaces = findPlaces(`${input.name} ${description}`).map<PlaceHit>((p) => ({ key: p.key, label: p.label, coverage: p.coverage, guide: p.guide, from: 'text' }))
  const hq = input.hq_city ? findPlaces(input.hq_city) : []
  const places = [...textPlaces]
  for (const p of hq) if (!places.some((q) => q.key === p.key)) places.push({ key: p.key, label: p.label, coverage: p.coverage, guide: p.guide, from: 'hq' })

  const national = !places.some((p) => p.from === 'text') && NATIONAL.test(t)
  const audience = audienceOf(t, activities)
  const offers = [...new Set(activities.flatMap((a) => OFFERS[a]))].filter((o) => o !== 'none') as Offer[]
  if (!offers.length) offers.push('none')
  const thin = description.trim().length < 40 || GENERIC.test(fold(description).trim())

  // Valore: quanto l'azienda può portare guide a chi viaggia.
  let value = BASE[activities[0]]
  if (activities.length > 1) value += Math.min(8, 4 * (activities.length - 1))
  if (audience === 'foreign') { value += 15; why.push('vende a stranieri') } else if (audience === 'corporate') value += 6
  else if (audience === 'domestic') value += 4
  const online = places.filter((p) => p.coverage === 'online')
  const onlineText = online.filter((p) => p.from === 'text')
  if (onlineText.length) { value += 25; why.push(`lavora a ${onlineText.map((p) => p.label).join(', ')}`) }
  else if (national) { value += 20; why.push('lavora in tutta Italia') }
  else if (online.length) { value += 14; why.push(`sede a ${online[0].label}`) }
  else if (places.some((p) => p.coverage === 'planned')) value += 10
  else if (places.length) value += 5
  if (input.email) value += 10
  else if (input.website) value += 4
  if (/51|201|501|1001|5001|10001/.test(String(input.employees || ''))) value += 8
  else if (/11-50/.test(String(input.employees || ''))) value += 5
  if (thin) value -= 8
  value = Math.max(0, Math.min(100, value))

  const main = activities[0]
  const fits = ['incoming', 'experiences', 'transport', 'mice', 'education', 'attraction', 'outgoing', 'hosting'].includes(main)
  const reachable = online.length > 0 || national
  let next: NextStep
  const lodging = LODGING.test(fold(input.name)) && !['incoming', 'transport', 'promoter'].includes(main)
  if (lodging) { next = 'skip'; why.push('struttura ricettiva') }
  else if (main === 'promoter') next = 'destination_body'
  else if (!fits) next = 'skip'
  else if (thin && !places.some((p) => p.from === 'text')) next = input.website && value >= 30 ? 'read_site' : 'skip'
  else if (reachable) next = input.email ? 'write' : input.website ? 'find_email' : 'no_contact'
  else if (places.length) next = 'guide_needed'
  else next = input.website && value >= 40 ? 'read_site' : 'skip'
  if (next === 'write' && value < 35) next = 'skip'

  if (next === 'guide_needed') why.push(`chiede ${places.filter((p) => p.coverage !== 'online').map((p) => p.label).join(', ')}`)
  if (thin) why.push('dati scarsi')
  return { activities, audience, places, offers, national, value, next, why, thin }
}

export const ACTIVITY_LABELS: Record<Activity, string> = {
  incoming: 'Tour operator / DMC incoming', experiences: 'Escursioni ed esperienze', transport: 'Trasporti', mice: 'Eventi e congressi',
  education: 'Viaggi scolastici', outgoing: 'Agenzie e outgoing', promoter: 'Enti e consorzi', attraction: 'Attrazioni', tech: 'Tecnologia e OTA',
  media: 'Media', hosting: 'Property manager e affitti brevi', other: 'Altro',
}
export const OFFER_LABELS: Record<Offer, string> = {
  resale: 'Rivendita guide (link, QR, 20%)', packages: 'Codici prepagati nei pacchetti', destination: 'Guida della destinazione per l’ente',
  partnership: 'Partnership (integrazione o contenuti)', none: 'Niente da proporre',
}
export const NEXT_LABELS: Record<NextStep, string> = {
  write: 'Scrivere: guida online e email', find_email: 'Guida online, manca l’email: leggere solo la pagina contatti',
  read_site: 'Leggere il sito: dati scarsi, potenziale alto', guide_needed: 'Lavora dove non abbiamo la guida',
  destination_body: 'Ente: proposta di guida della destinazione', no_contact: 'Guida online, ma senza sito né email', skip: 'Per ora no',
}
