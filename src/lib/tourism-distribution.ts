// Speaqi Guides — Distribution Opportunities: regole pure (nessuna rete, nessun database).
// Il punteggio vero lo calcola il database (`tourism_distribution_recompute`, migration
// 20261104090000): qui stanno etichette, pesi dichiarati, filtri e CSV, cosi' che la pagina,
// l'API e i test dicano le stesse cose.

export const GUIDE_DESTINATIONS = [
  { slug: 'venezia', label: 'Venezia' },
  { slug: 'bologna', label: 'Bologna' },
  { slug: 'milano', label: 'Milano' },
  { slug: 'roma', label: 'Roma' },
  { slug: 'firenze', label: 'Firenze' },
  { slug: 'napoli', label: 'Napoli' },
  { slug: 'capri', label: 'Capri' },
  { slug: 'costiera-amalfitana', label: 'Costiera Amalfitana' },
  { slug: 'pompei', label: 'Pompei' },
] as const
export type GuideSlug = (typeof GUIDE_DESTINATIONS)[number]['slug']
export const GUIDE_SLUGS: readonly string[] = GUIDE_DESTINATIONS.map((d) => d.slug)
export const guideLabel = (slug: string) => GUIDE_DESTINATIONS.find((d) => d.slug === slug)?.label || slug

export const TIERS = ['A', 'B', 'C', 'D'] as const
export type Tier = (typeof TIERS)[number]
export const TIER_LABELS: Record<Tier, string> = {
  A: 'Tier A · da attivare',
  B: 'Tier B · promettente',
  C: 'Tier C · da coltivare',
  D: 'Tier D · bassa priorità',
}
export const TIER_THRESHOLDS: Record<Tier, number> = { A: 72, B: 58, C: 44, D: 0 }
export const tierOf = (score: number): Tier => (score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 44 ? 'C' : 'D')

/** I pesi dichiarati dall'obiettivo (somma 100). Devono combaciare con la funzione SQL. */
export const SCORE_WEIGHTS = {
  destinations: 20,
  distribution: 25,
  commercial: 20,
  activation: 15,
  contacts: 10,
  complementary: 10,
} as const
export type ScoreComponent = keyof typeof SCORE_WEIGHTS
export const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  destinations: 'Compatibilità destinazioni',
  distribution: 'Potenziale distributivo',
  commercial: 'Compatibilità commerciale',
  activation: 'Facilità di attivazione',
  contacts: 'Accessibilità contatti',
  complementary: 'Servizi complementari',
}
export function weightedScore(components: Partial<Record<ScoreComponent, number>>) {
  let total = 0
  for (const key of Object.keys(SCORE_WEIGHTS) as ScoreComponent[]) {
    const value = Math.max(0, Math.min(100, Number(components[key]) || 0))
    total += (SCORE_WEIGHTS[key] / 100) * value
  }
  return Math.round(total)
}

export const MODELS = ['affiliate', 'resale', 'bundle', 'b2b_guests', 'revenue_share'] as const
export type CommercialModel = (typeof MODELS)[number]
export const MODEL_LABELS: Record<CommercialModel, string> = {
  affiliate: 'Affiliazione con commissioni',
  resale: 'Acquisto e rivendita',
  bundle: 'Bundle con hotel, trasporti o esperienze',
  b2b_guests: 'Distribuzione B2B agli ospiti',
  revenue_share: 'Partnership e revenue sharing',
}
/** Cosa la piattaforma sa già fare per ogni modello (verificato sulla documentazione di Speaqi, ottobre 2026). */
export const MODEL_SUPPORT: Record<CommercialModel, { level: 'supported' | 'partial' | 'missing'; note: string }> = {
  affiliate: {
    level: 'supported',
    note: 'Link affiliato (Referly) e programma partner B2B: l’acquisto conserva `partner_slug` e il partner vede aperture, acquisti e incassato.',
  },
  resale: {
    level: 'partial',
    note: 'Non esistono lotti all’ingrosso: i codici a tempo (28/10/2026) sono stati ritirati. Si può comprare per conto di altri con il regalo di una mappa e con i codici di sblocco SPQ- degli acquisti.',
  },
  bundle: {
    level: 'partial',
    note: 'Esiste il pass territorio (più mappe in un pagamento) e il regalo, ma non un pacchetto con biglietti di terzi: il partner lo compone nel proprio prodotto.',
  },
  b2b_guests: {
    level: 'supported',
    note: 'QR del partner `/go/<partner>` con vetrina `/p/<partner>`: l’ospite arriva alla guida e la vendita è attribuita al partner.',
  },
  revenue_share: {
    level: 'supported',
    note: 'Il programma B2B calcola le commissioni sulle vendite verificate in `map_purchases`; i dettagli si concordano per partner.',
  },
}

export const COMMERCIAL_STATUSES = ['new', 'qualified', 'contacted', 'replied', 'negotiating', 'active', 'not_fit'] as const
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number]
export const STATUS_LABELS: Record<CommercialStatus, string> = {
  new: 'Da valutare',
  qualified: 'Qualificato',
  contacted: 'Contattato',
  replied: 'Ha risposto',
  negotiating: 'In trattativa',
  active: 'Partner attivo',
  not_fit: 'Non adatto',
}
export const VOLUME_LABELS: Record<string, string> = { low: 'Basso', medium: 'Medio', high: 'Alto', very_high: 'Molto alto' }

export type DistributionFilters = {
  slug: string | null
  types: string[]
  countries: string[]
  tiers: Tier[]
  model: CommercialModel | null
  status: CommercialStatus | null
  volume: string | null
  contact: 'email' | 'phone' | 'any' | 'none' | null
  q: string
  minScore: number
  strategic: boolean
  quickWin: boolean
  sort: 'score' | 'name' | 'completeness'
  limit: number
  offset: number
}

const list = (value: string | null) =>
  (value || '').split(',').map((v) => v.trim()).filter(Boolean).slice(0, 40)

/** Filtri dell'URL: ciò che non è riconosciuto si ignora, non si indovina. */
export function parseDistributionFilters(params: URLSearchParams): DistributionFilters {
  const slug = params.get('slug')
  const model = params.get('model')
  const status = params.get('status')
  const contact = params.get('contact')
  const sort = params.get('sort')
  const limit = Number(params.get('limit'))
  const offset = Number(params.get('offset'))
  const min = Number(params.get('min_score'))
  return {
    slug: slug && GUIDE_SLUGS.includes(slug) ? slug : null,
    types: list(params.get('type')).filter((t) => /^[a-z_]{2,40}$/.test(t)),
    countries: list(params.get('country')).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)),
    tiers: list(params.get('tier')).map((t) => t.toUpperCase()).filter((t): t is Tier => (TIERS as readonly string[]).includes(t)),
    model: model && (MODELS as readonly string[]).includes(model) ? (model as CommercialModel) : null,
    status: status && (COMMERCIAL_STATUSES as readonly string[]).includes(status) ? (status as CommercialStatus) : null,
    volume: params.get('volume') && ['low', 'medium', 'high', 'very_high'].includes(params.get('volume')!) ? params.get('volume') : null,
    contact: contact === 'email' || contact === 'phone' || contact === 'any' || contact === 'none' ? contact : null,
    q: (params.get('q') || '').trim().slice(0, 80),
    minScore: Number.isFinite(min) ? Math.max(0, Math.min(100, Math.round(min))) : 0,
    strategic: params.get('strategic') === '1',
    quickWin: params.get('quick_win') === '1',
    sort: sort === 'name' || sort === 'completeness' ? sort : 'score',
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 5000) : 50,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  }
}

export type DistributionRow = {
  entity_id: string
  score: number
  tier: Tier
  components: Partial<Record<ScoreComponent, number>>
  completeness: number
  guide_slugs: string[]
  volume_potential: string
  model: CommercialModel
  model_alt: CommercialModel | null
  strategic: boolean
  quick_win: boolean
  commercial_status: CommercialStatus
  notes: string | null
  entity: {
    name: string
    type_code: string
    country_code: string
    website: string | null
    email: string | null
    phone: string | null
  }
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value)
  // Una cella che comincia come una formula si disinnesca (si apre in Excel).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV per Excel italiano: punto e virgola e BOM. */
export function distributionCsv(rows: DistributionRow[]) {
  const header = [
    'Azienda', 'Categoria', 'Paese', 'Punteggio', 'Tier', 'Guide pertinenti', 'Volume potenziale',
    'Modello consigliato', 'Alternativa', 'Strategico', 'Attivabile subito', 'Stato commerciale',
    'Sito', 'Email', 'Telefono', 'Completezza dati',
  ]
  const lines = rows.map((r) => [
    r.entity.name, r.entity.type_code, r.entity.country_code, r.score, r.tier,
    r.guide_slugs.map(guideLabel).join(', '), VOLUME_LABELS[r.volume_potential] || r.volume_potential,
    MODEL_LABELS[r.model], r.model_alt ? MODEL_LABELS[r.model_alt] : '', r.strategic ? 'sì' : '', r.quick_win ? 'sì' : '',
    STATUS_LABELS[r.commercial_status], r.entity.website || '', r.entity.email || '', r.entity.phone || '', `${r.completeness}%`,
  ])
  return '﻿' + [header, ...lines].map((line) => line.map(csvCell).join(';')).join('\r\n')
}

export type MatrixCell = { slug: string; type: string; total: number; ab: number }
/** Le celle della matrice DESTINAZIONE × CATEGORIA: dove i prospect qualificati mancano è un segmento inesplorato. */
export function coverageGaps(cells: MatrixCell[], types: string[], minQualified = 3) {
  const index = new Map(cells.map((c) => [`${c.slug}|${c.type}`, c]))
  const gaps: { slug: string; type: string; total: number; ab: number }[] = []
  for (const d of GUIDE_DESTINATIONS) {
    for (const type of types) {
      const cell = index.get(`${d.slug}|${type}`)
      const ab = cell?.ab || 0
      if (ab < minQualified) gaps.push({ slug: d.slug, type, total: cell?.total || 0, ab })
    }
  }
  return gaps.sort((a, b) => a.ab - b.ab || a.total - b.total)
}
