/**
 * SPEAQI OPPORTUNITY SCORE (SOS) — lead scoring B2B, riusabile per ogni fiera.
 *
 * Risponde a tre domande: quanto e' adatta questa organizzazione a Speaqi
 * Guides, quanto e' probabile che compri o distribuisca le mappe, quanto
 * conviene investire tempo per incontrarla.
 *
 * Regola di fondo: un dato che non si conosce NON e' uno zero. Ogni criterio e'
 * `null` (sconosciuto) finche' non lo dice il testo dell'espositore o una
 * persona; lo zero e' solo "verificato: nessuno". Budget, volumi e intenzioni
 * d'acquisto non si deducono mai da soli: restano da qualificare a mano.
 *
 * Solo logica pura, condivisa fra rotta e pagina.
 */

export const FACTOR_KEYS = [
  'organization_type',
  'distribution_reach',
  'map_need',
  'budget_capacity',
  'commercial_potential',
  'international_audience',
  'decision_maker_access',
  'strategic_synergy',
] as const
export type FactorKey = (typeof FACTOR_KEYS)[number]

export type FactorOption = { id: string; label: string; points: number }
export type FactorDef = { key: FactorKey; label: string; max: number; question: string; options: FactorOption[] }

export const FACTOR_DEFS: FactorDef[] = [
  {
    key: 'organization_type', label: 'Tipologia organizzazione', max: 20,
    question: 'Quanto il settore è compatibile con Speaqi Guides',
    options: [
      { id: 'dmo', label: 'DMO / APT / agenzia di promozione turistica', points: 20 },
      { id: 'consorzio', label: 'Consorzio turistico territoriale', points: 20 },
      { id: 'assoc_territoriale', label: 'Associazione territoriale di operatori', points: 18 },
      { id: 'navigazione', label: 'Compagnia di navigazione / crociere', points: 18 },
      { id: 'dmc', label: 'DMC / incoming tour operator', points: 18 },
      { id: 'tour_operator', label: 'Tour operator', points: 15 },
      { id: 'catena', label: 'Catena alberghiera / resort', points: 15 },
      { id: 'trasporto', label: 'Aeroporto / società di trasporto', points: 14 },
      { id: 'attrazione', label: 'Museo / parco / attrazione', points: 14 },
      { id: 'assoc_categoria', label: 'Associazione di categoria', points: 12 },
      { id: 'hotel', label: 'Hotel indipendente', points: 8 },
      { id: 'agenzia_viaggi', label: 'Agenzia viaggi tradizionale', points: 7 },
      { id: 'tecnologico', label: 'Fornitore tecnologico / servizi turistici', points: 5 },
      { id: 'non_turistica', label: 'Azienda non turistica', points: 0 },
    ],
  },
  {
    key: 'distribution_reach', label: 'Capacità di distribuzione', max: 20,
    question: 'Quanti turisti può raggiungere davvero (rete accessibile, non arrivi della regione)',
    options: [
      { id: 'gt100k', label: 'Oltre 100.000 turisti/anno', points: 20 },
      { id: '20_100k', label: '20.000–100.000 turisti/anno', points: 16 },
      { id: '5_20k', label: '5.000–20.000 turisti/anno', points: 12 },
      { id: '1_5k', label: '1.000–5.000 turisti/anno', points: 8 },
      { id: 'lt1k', label: 'Meno di 1.000 turisti/anno', points: 4 },
      { id: 'none', label: 'Nessun contatto diretto con turisti', points: 0 },
    ],
  },
  {
    key: 'map_need', label: 'Necessità di mappe e guide', max: 15,
    question: 'Quanto il prodotto risolve un problema reale',
    options: [
      { id: 'paper', label: 'Distribuisce mappe cartacee o guide tradizionali', points: 15 },
      { id: 'digital_improvable', label: 'Guida digitale con limiti concreti', points: 12 },
      { id: 'itineraries', label: 'Promuove itinerari e punti di interesse', points: 10 },
      { id: 'generic_info', label: 'Informazioni turistiche generiche', points: 6 },
      { id: 'none', label: 'Necessità non identificata', points: 0 },
    ],
  },
  {
    key: 'budget_capacity', label: 'Capacità di spesa', max: 15,
    question: 'Budget plausibile per Speaqi (non il fatturato)',
    options: [
      { id: 'dedicated', label: 'Budget dedicato a turismo, digitale o promozione', points: 15 },
      { id: 'buys_digital', label: 'Acquista regolarmente servizi digitali', points: 12 },
      { id: 'structured', label: 'Azienda strutturata, acquisto plausibile', points: 8 },
      { id: 'small', label: 'Piccola organizzazione, budget limitato', points: 4 },
      { id: 'none', label: 'Nessuna capacità di acquisto', points: 0 },
    ],
  },
  {
    key: 'commercial_potential', label: 'Potenziale commerciale', max: 10,
    question: 'Ricavi ricorrenti o acquisti multipli',
    options: [
      { id: 'multi', label: 'Più destinazioni e acquisti ricorrenti', points: 10 },
      { id: 'one_many', label: 'Una destinazione con molti utenti', points: 8 },
      { id: 'annual', label: 'Una guida con possibile rinnovo annuale', points: 6 },
      { id: 'single', label: 'Progetto singolo', points: 3 },
      { id: 'none', label: 'Nessun modello economico individuato', points: 0 },
    ],
  },
  {
    key: 'international_audience', label: 'Turismo internazionale', max: 10,
    question: 'Importanza delle lingue straniere',
    options: [
      { id: 'intl_many', label: 'Pubblico internazionale, molte lingue', points: 10 },
      { id: 'intl', label: 'Turismo internazionale significativo', points: 8 },
      { id: 'national_some', label: 'Prevalentemente nazionale, con quota estera', points: 5 },
      { id: 'local', label: 'Quasi esclusivamente locale', points: 2 },
      { id: 'none', label: 'Il multilingua non conta', points: 0 },
    ],
  },
  {
    key: 'decision_maker_access', label: 'Accesso al decisore', max: 5,
    question: 'Possibilità di avviare una trattativa',
    options: [
      { id: 'direct', label: 'Contatto diretto con il decisore', points: 5 },
      { id: 'referent', label: 'Referente commerciale identificato', points: 4 },
      { id: 'at_ttg', label: 'Presente in fiera, interlocutore non identificato', points: 2 },
      { id: 'none', label: 'Nessun contatto disponibile', points: 0 },
    ],
  },
  {
    key: 'strategic_synergy', label: 'Sinergie strategiche', max: 5,
    question: 'Referenze, partnership, nuove opportunità',
    options: [
      { id: 'client', label: 'Cliente o partner già attivo', points: 5 },
      { id: 'intro', label: 'Introduzione tramite cliente/partner', points: 4 },
      { id: 'partnership', label: 'Possibilità concreta di partnership', points: 3 },
      { id: 'indirect', label: 'Opportunità indiretta', points: 1 },
      { id: 'none', label: 'Nessuna sinergia', points: 0 },
    ],
  },
]

const DEF_BY_KEY = Object.fromEntries(FACTOR_DEFS.map((def) => [def.key, def])) as Record<FactorKey, FactorDef>

export function factorOption(key: FactorKey, optionId: string | null | undefined) {
  return DEF_BY_KEY[key].options.find((option) => option.id === optionId) || null
}

// ---------------------------------------------------------------------------
// Input e stato manuale
// ---------------------------------------------------------------------------

export type SosFlags = {
  /** Il decisore e' in fiera: +10 sul punteggio d'azione. */
  decision_maker_present?: boolean
  /** Introduzione diretta tramite SNAV o un partner: +10, e sinergia "introduzione". */
  partner_intro?: boolean
  /** Cliente o partner gia' attivo: sinergia massima. */
  existing_client?: boolean
}

export type MeetingOutcome = {
  interest?: 'yes' | 'maybe' | 'no' | null
  budget_plausible?: boolean | null
  next_step?: string | null
  at?: string | null
}

export type SosManual = Partial<Record<FactorKey, { option: string; at: string }>>

export type SosInput = {
  name: string
  category?: string | null
  description?: string | null
  country?: string | null
  stand?: string | null
  hall?: string | null
  email?: string | null
  phone?: string | null
  contact_person?: string | null
  status?: string | null
  sos_manual?: SosManual | null
  ttg_flags?: SosFlags | null
  meeting_outcome?: MeetingOutcome | null
}

export type FactorSource = 'manual' | 'data' | 'category' | 'type' | 'text' | 'name'

/** Quanto ci si fida di un dato: un nome che sembra un hotel vale meno di una scelta fatta a mano. */
const RELIABILITY: Record<FactorSource, number> = { manual: 1, data: 1, category: 1, type: 0.75, text: 0.75, name: 0.5 }

export const SOURCE_LABELS: Record<FactorSource, string> = {
  manual: 'impostato a mano',
  data: 'dai dati dell’espositore',
  category: 'dalla categoria TTG',
  type: 'dedotto dalla tipologia',
  text: 'dalla descrizione',
  name: 'dal nome (poco affidabile)',
}

export type FactorResult = {
  key: FactorKey
  label: string
  max: number
  /** null = sconosciuto (non e' uno zero). */
  points: number | null
  option: string | null
  optionLabel: string | null
  source: FactorSource | null
}

export type DataConfidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type LeadClass = 'S' | 'A' | 'B' | 'C' | 'D'

export const CLASS_META: Record<LeadClass, { label: string; action: string; color: string }> = {
  S: { label: 'Strategic', action: 'Incontro prioritario', color: '#7c3aed' },
  A: { label: 'High Priority', action: 'Visitare lo stand', color: '#16a34a' },
  B: { label: 'Qualified', action: 'Visitare se disponibile', color: '#0ea5e9' },
  C: { label: 'Low Priority', action: 'Contatto rapido', color: '#d97706' },
  D: { label: 'Discard', action: 'Non investire tempo', color: '#94a3b8' },
}

export function classFromScore(score: number): LeadClass {
  if (score >= 85) return 'S'
  if (score >= 70) return 'A'
  if (score >= 55) return 'B'
  if (score >= 40) return 'C'
  return 'D'
}

// ---------------------------------------------------------------------------
// Dedurre cio' che il testo dice davvero
// ---------------------------------------------------------------------------

function fold(value: string | null | undefined) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

type OrgRule = { id: string; category: RegExp; name?: RegExp }

const ORG_RULES: OrgRule[] = [
  { id: 'dmo', category: /destinazion|promozione del territorio|enti? del turismo|enti italiani di promozione|rappresentanz[ae] enti|tourism (board|office|authority)|tourist board|\bdmo\b|\bapt\b|azienda di promozione|convention (&|and|e) visitors|assessorato/,
    name: /^(regione|region)\b|\b(tourism|tourist) (board|authority|office)\b|\bente (del )?turismo\b|\bvisit[ -][a-z]+|destination management|\bapt\b|\batl\b|azienda (per il )?turismo|azienda turistica|agenzia regionale|promozione turistica|turismo (di|del|della|de)\b|tourism$/ },
  { id: 'consorzio', category: /consorzi? turistic|club di prodotto/, name: /consorzio turistic/ },
  { id: 'assoc_territoriale', category: /$^/, name: /pro loco|associazione (degli )?operatori|associazione territorial|distretto turistico|unione (dei )?comuni/ },
  { id: 'navigazione', category: /compagnie di navigazione|crocier|cruise|traghett|ferry/, name: /\b(cruises?|crociere|ferries|ferry|snav|moby|grimaldi|tirrenia|gnv|msc crociere)\b/ },
  { id: 'dmc', category: /\bdmc\b|incoming/, name: /\bdmc\b|\bincoming\b/ },
  { id: 'tour_operator', category: /tour operator|wholesaler/, name: /\btour operator\b|\btravel group\b/ },
  { id: 'catena', category: /catene alberghier|villaggi turistic|resort/, name: /\bresorts?\b|hotels? (group|collection)|hotels? & resorts/ },
  { id: 'trasporto', category: /bus operator|trasporti|compagnie aeree|aeroport|ferrovi|treni/, name: /\bairlines?\b|\bairways\b|\bairport\b|aeroport|\baer lingus\b|trenitalia|italo\b|flixbus|\blufthansa\b|\bryanair\b|\bita airways\b/ },
  { id: 'attrazione', category: /musei|siti archeolog|castell|attrazioni turistic|\bparchi?\b|dimore storiche|\bville\b|giardin|acquari/, name: /\bmuse[oi]\b|museum|\bparco\b|\bpark\b|castello|castle|archaeolog/ },
  { id: 'assoc_categoria', category: /associazioni/, name: /\bassociazione\b|federalberghi|fiavet|confcommercio|assoturismo|\bfederazione\b/ },
  { id: 'hotel', category: /struttur[ae] ricettiv|hotel|alberghi|residence|appartament|b&b|agriturism|guest house|bed and breakfast|campeggi|camping|ostell/, name: /\bhotel\b|\bresidence\b|agriturismo|\bb&b\b|\balbergo\b|\binn\b/ },
  { id: 'agenzia_viaggi', category: /agenzie di viaggi|network di agenzie|\bolta\b|agenzie business travel/, name: /agenzia viaggi|\bviaggi\b|travel agency/ },
  { id: 'tecnologico', category: /tecnologia|\bweb\b|software|servizi it|marketing|comunicazione|societa' di servizi|societa' di rappresentanza|noleggio|autonoleggi|conducente/, name: /software|\bsystems?\b|technolog/ },
]

const NOT_TOURISM = /servizi finanziari|assicurazion/
// Se la categoria principale e' questa, e' lei a decidere: "TECNOLOGIA/WEB: ... / TOUR OPERATOR"
// resta un fornitore tecnologico anche se cita i tour operator fra i clienti.
const HEAD_TECH = /^(tecnologia|web)\b/
const HEAD_NON_TOURISM = /^(servizi finanziari)/

function pointsOf(id: string) {
  return factorOption('organization_type', id)?.points ?? 0
}

function inferOrganizationType(input: SosInput): { option: string; source: FactorSource } | null {
  const category = fold(input.category).trim()
  const name = fold(input.name)
  const nameTypes = ORG_RULES.filter((rule) => rule.name?.test(name)).map((rule) => rule.id)
  const best = (ids: string[]) => ids.reduce((top, id) => (pointsOf(id) > pointsOf(top) ? id : top), ids[0])

  if (category) {
    if (HEAD_NON_TOURISM.test(category) || (NOT_TOURISM.test(category) && !/hotel|viaggi|tour/.test(category))) {
      return { option: 'non_turistica', source: 'category' }
    }
    if (HEAD_TECH.test(category)) return { option: 'tecnologico', source: 'category' }
    // Il noleggio non e' una societa' di trasporto: lo togliamo prima di valutare "trasporti".
    const transport = category
      .replace(/trasporti\s*:\s*((servizi di )?noleggio[^/]*|autonoleggi[^/]*)(?=\/|$)/g, ' ')
      .replace(/servizi di noleggio|noleggio auto con conducente|noleggio|autonoleggi/g, ' ')
    const matched = ORG_RULES.filter((rule) => rule.category.test(rule.id === 'trasporto' ? transport : category)).map((rule) => rule.id)
    // L'elenco TTG e' in ordine alfabetico, non d'importanza: non c'e' una categoria "principale".
    // Un solo tipo, o un tipo che anche il nome conferma, e' un dato; piu' tipi senza conferma
    // sono un'ipotesi (il massimo fra tutte le caselle spuntate premierebbe i generalisti).
    const confirmed = matched.filter((id) => nameTypes.includes(id))
    if (confirmed.length) return { option: best(confirmed), source: 'category' }
    if (matched.length === 1) return { option: matched[0], source: 'category' }
    if (matched.length > 1) return { option: best(matched), source: 'type' }
  }
  return nameTypes.length ? { option: best(nameTypes), source: 'name' } : null
}

const FOREIGN_FIRST_TYPES = new Set(['dmc', 'tour_operator', 'navigazione', 'catena', 'attrazione', 'hotel', 'consorzio', 'dmo', 'agenzia_viaggi'])

function inferInternational(input: SosInput, type: string | null): { option: string; source: FactorSource } | null {
  if (!type || type === 'tecnologico' || type === 'non_turistica') return null
  const foreign = Boolean(input.country && !/^ital/i.test(fold(input.country).trim()))
  if (['dmo', 'dmc', 'navigazione', 'catena'].includes(type)) return { option: 'intl_many', source: 'type' }
  if (foreign && FOREIGN_FIRST_TYPES.has(type)) return { option: 'intl', source: 'type' }
  if (['attrazione', 'consorzio', 'assoc_territoriale'].includes(type)) return { option: 'intl', source: 'type' }
  if (['tour_operator', 'agenzia_viaggi', 'hotel', 'trasporto'].includes(type)) return { option: 'national_some', source: 'type' }
  return null
}

function inferMapNeed(input: SosInput, type: string | null): { option: string; source: FactorSource } | null {
  const text = fold([input.description, input.category].filter(Boolean).join(' '))
  if (/mapp[ae] cartace|guid[ae] cartace|brochure|depliant|opuscol/.test(text)) return { option: 'paper', source: 'text' }
  if (/itinerar|punti di interesse|audioguid|guid[ae] turistic|mappa interattiv|percorsi/.test(text)) return { option: 'itineraries', source: 'text' }
  if (type && ['dmo', 'consorzio', 'assoc_territoriale', 'attrazione'].includes(type)) return { option: 'generic_info', source: 'type' }
  return null
}

// ---------------------------------------------------------------------------
// Valutazione
// ---------------------------------------------------------------------------

export type TtgActionPart = { label: string; points: number }

export type Evaluation = {
  factors: FactorResult[]
  /** Punteggio sui soli criteri noti, riportato a 100. null se non se ne conosce nessuno. */
  opportunityScore: number | null
  /** Punti guadagnati / punti massimi dei criteri noti. */
  earned: number
  knownMax: number
  confidence: DataConfidence
  needsQualification: boolean
  /** null finche' i dati sono LOW: meglio "da qualificare" che una bocciatura sulle ipotesi. */
  leadClass: LeadClass | null
  /** Classe che uscirebbe col punteggio d'ordinamento: solo un'indicazione, mai un verdetto. */
  provisionalClass: LeadClass
  ttgActionScore: number
  ttgActionParts: TtgActionPart[]
  /** Punteggio d'ordinamento: i criteri ignoti pesano come una stima neutra. */
  rankScore: number
  ttgPriorityScore: number
  recommendedAction: string
  topFactors: FactorResult[]
  unknown: FactorResult[]
  explanation: string[]
}

/** Quanto pesa un criterio ignoto nell'ordinamento: una stima neutra, mai un voto. */
const NEUTRAL_PRIOR = 30

export function evaluateExhibitor(input: SosInput): Evaluation {
  const flags = input.ttg_flags || {}
  const manual = input.sos_manual || {}
  const auto: Partial<Record<FactorKey, { option: string; source: FactorSource }>> = {}

  const type = inferOrganizationType(input)
  if (type) auto.organization_type = type
  const international = inferInternational(input, type?.option ?? null)
  if (international) auto.international_audience = international
  const mapNeed = inferMapNeed(input, type?.option ?? null)
  if (mapNeed) auto.map_need = mapNeed
  // Ogni espositore e' in fiera: l'interlocutore c'e', anche se ancora senza nome.
  auto.decision_maker_access = input.contact_person?.trim()
    ? { option: 'referent', source: 'data' }
    : { option: 'at_ttg', source: 'data' }
  if (flags.existing_client) auto.strategic_synergy = { option: 'client', source: 'data' }
  else if (flags.partner_intro) auto.strategic_synergy = { option: 'intro', source: 'data' }

  const factors: FactorResult[] = FACTOR_DEFS.map((def) => {
    const chosen = manual[def.key]
    const picked = chosen && factorOption(def.key, chosen.option) ? { option: chosen.option, source: 'manual' as FactorSource } : auto[def.key] || null
    const option = picked ? factorOption(def.key, picked.option) : null
    return {
      key: def.key,
      label: def.label,
      max: def.max,
      points: option ? option.points : null,
      option: option ? option.id : null,
      optionLabel: option ? option.label : null,
      source: option && picked ? picked.source : null,
    }
  })

  const known = factors.filter((factor) => factor.points !== null)
  const earned = known.reduce((sum, factor) => sum + (factor.points || 0), 0)
  const knownMax = known.reduce((sum, factor) => sum + factor.max, 0)
  const weighted = known.reduce((sum, factor) => sum + factor.max * RELIABILITY[factor.source as FactorSource], 0)
  const manualWeight = known.filter((factor) => factor.source === 'manual').reduce((sum, factor) => sum + factor.max, 0)

  const opportunityScore = knownMax > 0 ? Math.round((earned / knownMax) * 100) : null
  const confidence: DataConfidence = weighted >= 85 && manualWeight >= 30 ? 'HIGH' : weighted >= 55 ? 'MEDIUM' : 'LOW'
  const needsQualification = confidence === 'LOW'

  const certainty = Math.min(1, weighted / 100)
  const rankScore = opportunityScore === null ? NEUTRAL_PRIOR : opportunityScore * certainty + NEUTRAL_PRIOR * (1 - certainty)
  const provisionalClass = classFromScore(rankScore)
  const verifiedNotTourism = factors[0].option === 'non_turistica' && factors[0].source === 'manual'
  const leadClass: LeadClass | null = needsQualification ? null : verifiedNotTourism ? 'D' : classFromScore(opportunityScore ?? 0)

  const status = input.status || 'new'
  const outcome = input.meeting_outcome || {}
  const parts: TtgActionPart[] = []
  if (status === 'meeting') parts.push({ label: 'Appuntamento confermato', points: 15 })
  if (flags.decision_maker_present) parts.push({ label: 'Decisore presente in fiera', points: 10 })
  if (input.stand?.trim() && input.contact_person?.trim()) parts.push({ label: 'Stand e referente identificati', points: 5 })
  if (['interested', 'meeting', 'replied'].includes(status) || outcome.interest === 'yes') parts.push({ label: 'Organizzazione già interessata', points: 10 })
  if (flags.partner_intro) parts.push({ label: 'Introduzione tramite SNAV o partner', points: 10 })
  const ttgActionScore = Math.min(50, parts.reduce((sum, part) => sum + part.points, 0))

  const ttgPriorityScore = Math.round((rankScore * 0.8 + ttgActionScore * 0.4) * 10) / 10

  let recommendedAction: string
  if (status === 'not_interested') recommendedAction = 'Chiuso'
  else if (leadClass === null) recommendedAction = 'Da qualificare'
  else if (leadClass === 'D') recommendedAction = 'Non prioritario'
  else recommendedAction = CLASS_META[leadClass].action

  const topFactors = [...known].sort((a, b) => (b.points || 0) - (a.points || 0) || b.max - a.max).slice(0, 3)
  const unknown = factors.filter((factor) => factor.points === null)

  const explanation = [
    ...known.map((factor) => `${factor.label}: ${factor.optionLabel} (${factor.points}/${factor.max}) · ${SOURCE_LABELS[factor.source as FactorSource]}`),
    ...(unknown.length ? [`Da verificare: ${unknown.map((factor) => factor.label.toLowerCase()).join(', ')}`] : []),
    ...parts.map((part) => `Azione TTG: ${part.label} (+${part.points})`),
  ]

  return {
    factors, opportunityScore, earned, knownMax, confidence, needsQualification, leadClass, provisionalClass,
    ttgActionScore, ttgActionParts: parts, rankScore: Math.round(rankScore * 10) / 10, ttgPriorityScore,
    recommendedAction, topFactors, unknown, explanation,
  }
}

/** Colonne da salvare sulla riga: tutto cio' che si filtra o si esporta in SQL. */
export function scoreColumns(input: SosInput, now = new Date()) {
  const ev = evaluateExhibitor(input)
  const byKey = Object.fromEntries(ev.factors.map((factor) => [factor.key, factor.option])) as Record<FactorKey, string | null>
  return {
    ...byKey,
    opportunity_score: ev.opportunityScore,
    ttg_action_score: ev.ttgActionScore,
    ttg_priority_score: ev.ttgPriorityScore,
    lead_class: ev.leadClass,
    data_confidence: ev.confidence,
    recommended_action: ev.recommendedAction,
    score_explanation: ev.explanation,
    score_reasons: ev.topFactors.map((factor) => `${factor.label}: ${factor.optionLabel}`),
    // Il campo storico `score` ordina la lista: ora e' il punteggio di priorita' TTG.
    score: Math.max(0, Math.min(100, Math.round(ev.ttgPriorityScore))),
    last_scored_at: now.toISOString(),
  }
}

/**
 * Priorita' Alta/Media/Bassa. Con la classe (dati MEDIUM/HIGH) decide quella: S e A alta, B media.
 * Senza, decide il punteggio d'ordinamento: finche' non si qualifica niente supera ~40,
 * quindi le soglie sono tarate sull'elenco TTG 2026 (circa un decimo in "Alta").
 */
export const PROVISIONAL_HIGH_FROM = 38
export const PROVISIONAL_MEDIUM_FROM = 33
