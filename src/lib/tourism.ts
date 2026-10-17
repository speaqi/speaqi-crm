import { parseCsvText } from './csv-import'

export const TOURISM_TYPES = {
  ministry: 'Ministero',
  nto: 'Ente nazionale / NTO',
  rto: 'Agenzia regionale / RTO',
  dmo: 'DMO',
  dmc: 'DMC · commerciale',
  cvb: 'Convention & Visitors Bureau',
  gal: 'GAL',
  municipal_union: 'Unione di comuni',
  consortium: 'Consorzio',
  wine_route: 'Strada del vino',
  foundation: 'Fondazione',
  association: 'Associazione / Pro Loco',
  park: 'Ente parco',
  district: 'Distretto / cluster',
  chamber: 'Camera di commercio',
  local_office: 'Ufficio turistico',
  network: 'Rete / partnership',
  development_authority: 'Autorità di sviluppo',
  other: 'Da classificare'
} as const
export const ENTITY_KINDS = [
  'organization',
  'place',
  'brand',
  'portal',
  'person'
] as const
export const ENTITY_STATUSES = [
  'DISCOVERED',
  'UNVERIFIED',
  'VERIFIED',
  'NEEDS_REVIEW',
  'INACTIVE',
  'DUPLICATE'
] as const
export const STATUS_LABELS: Record<string, string> = {
  DISCOVERED: 'Scoperta',
  UNVERIFIED: 'Da verificare',
  VERIFIED: 'Identità verificata',
  NEEDS_REVIEW: 'Da rivedere',
  INACTIVE: 'Inattiva',
  DUPLICATE: 'Duplicato'
}
export const KIND_LABELS: Record<string, string> = {
  organization: 'Organizzazione',
  place: 'Territorio',
  brand: 'Brand',
  portal: 'Portale',
  person: 'Persona'
}
export const RELATION_LABELS = {
  PART_OF: 'parte di',
  COVERS: 'copre',
  MANAGES: 'gestisce',
  PROMOTES: 'promuove',
  OPERATES_BRAND: 'opera il brand',
  OPERATES_PORTAL: 'opera il portale',
  MEMBER_OF: 'membro di',
  PARTNER_OF: 'partner di',
  WORKS_FOR: 'lavora per'
} as const

export const SCORE_FACTORS = {
  tourism_relevance: { label: 'Rilevanza turistica', weight: 15 },
  destination_scale: { label: 'Destinazioni rappresentate', weight: 10 },
  organization_size: { label: 'Dimensione organizzativa', weight: 5 },
  digital_need: { label: 'Esigenza di digitalizzazione', weight: 10 },
  map_need: { label: 'Esigenza di mappe', weight: 15 },
  multilingual_need: { label: 'Esigenza multilingua', weight: 15 },
  ai_need: { label: 'Esigenza AI Concierge', weight: 10 },
  investment_capacity: { label: 'Capacità di investimento', weight: 5 },
  contact_access: { label: 'Accessibilità referenti', weight: 5 },
  product_fit: { label: 'Compatibilità Speaqi', weight: 10 }
} as const
export type FactorKey = keyof typeof SCORE_FACTORS
export type Indicator = { value: number; source_url: string; rationale: string }
export type EntityDetails = {
  description?: string
  language?: string
  place_level?: string
  latitude?: number
  longitude?: number
  indicators?: Partial<Record<FactorKey, Indicator>>
}
export type TourismEntity = {
  id: string
  kind: (typeof ENTITY_KINDS)[number]
  name: string
  name_key: string
  country_code: string
  type_code: keyof typeof TOURISM_TYPES | null
  website: string | null
  email: string | null
  phone: string | null
  aliases: string[]
  details: EntityDetails
  external_ids: Record<string, string>
  status: (typeof ENTITY_STATUSES)[number]
  version: number
  created_at: string
  updated_at: string
}
export type Evidence = {
  id: string
  entity_id: string
  source_url: string
  title: string
  excerpt: string
  fields: string[]
  method: string
  status: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED'
  acquired_at: string
  verified_at: string | null
  verified_by: string | null
}
export type Relation = {
  id: string
  from_id: string
  to_id: string
  relation: keyof typeof RELATION_LABELS
  evidence_id: string
}
export type DiscoveryJob = {
  id: string
  query: string
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  attempts: number
  created_at: string
  lease_until: string | null
  error: string | null
  result: ImportRecord[]
  usage: Record<string, number | string | null>
}
export type ImportRecord = Pick<
  TourismEntity,
  | 'kind'
  | 'name'
  | 'country_code'
  | 'type_code'
  | 'website'
  | 'email'
  | 'phone'
  | 'aliases'
  | 'details'
  | 'external_ids'
> & {
  evidence: Pick<
    Evidence,
    'source_url' | 'title' | 'excerpt' | 'fields' | 'method'
  >
}

export class TourismInputError extends Error {}
function fail(message: string): never {
  throw new TourismInputError(message)
}
export function textValue(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
export function nameKey(value: string) {
  return value
    .toLowerCase()
    .replace(
      /[àáâäãåèéêëìíîïòóôöõùúûüñç]/g,
      (c) => 'aaaaaaeeeeiiiiooooouuuunc'['àáâäãåèéêëìíîïòóôöõùúûüñç'.indexOf(c)]
    )
    .replace(new RegExp('[^\\p{L}\\p{N}]+', 'gu'), ' ')
    .trim()
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  )
}
export function safePublicUrl(value: unknown): string | null {
  const input = textValue(value, 2000)
  if (!input) return null
  try {
    const url = new URL(input)
    const host = url.hostname.toLowerCase()
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !host.includes('.') ||
      host.includes(':') ||
      /^\d+\./.test(host) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
    )
      return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
const FIELDS = [
  'name',
  'country_code',
  'type_code',
  'website',
  'email',
  'phone',
  'aliases',
  'description',
  'coordinates',
  'coverage',
  'relationship',
  ...Object.keys(SCORE_FACTORS).map((k) => `indicator:${k}`)
]

export function normalizeEvidence(
  raw: unknown,
  method = 'manual'
): ImportRecord['evidence'] {
  const e =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const source_url =
    safePublicUrl(e.source_url) ||
    fail('Fonte: inserire un URL pubblico http/https valido')
  const title = textValue(e.title, 300)
  if (title.length < 2) fail('Titolo della fonte obbligatorio')
  const fields = Array.isArray(e.fields)
    ? [
        ...new Set(
          e.fields.filter(
            (f): f is string => typeof f === 'string' && FIELDS.includes(f)
          )
        )
      ]
    : []
  if (!fields.length) fail('Specificare gli attributi documentati dalla fonte')
  return {
    source_url,
    title,
    fields,
    excerpt: textValue(e.excerpt, 2000),
    method
  }
}

export function normalizeRecord(raw: unknown, method = 'import'): ImportRecord {
  if (!raw || typeof raw !== 'object') return fail('Record non valido')
  const r = raw as Record<string, unknown>
  const kind = (r.kind || 'organization') as TourismEntity['kind']
  if (!ENTITY_KINDS.includes(kind)) fail('Tipo di entità non valido')
  // Personal data ingestion requires a dedicated lawful-basis/retention workflow first.
  if (kind === 'person') fail('Importazione persone non abilitata nel pilota')
  const name = textValue(r.name, 200)
  if (name.length < 2 || !nameKey(name))
    fail('Denominazione obbligatoria (2-200 caratteri)')
  const country_code = textValue(r.country_code, 80).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country_code) && !(kind === 'place' && !country_code))
    fail('Paese richiesto nel formato ISO a due lettere')
  const type_code =
    kind === 'organization'
      ? (textValue(r.type_code, 60) as keyof typeof TOURISM_TYPES)
      : null
  if (
    kind === 'organization' &&
    (!type_code || !Object.hasOwn(TOURISM_TYPES, type_code))
  )
    fail('Categoria organizzativa non valida')
  const website = safePublicUrl(r.website)
  if (r.website && !website) fail('Sito web non valido')
  const email = textValue(r.email, 254).toLowerCase() || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    fail('Email istituzionale non valida')
  const d =
    r.details && typeof r.details === 'object'
      ? (r.details as Record<string, unknown>)
      : {}
  const details: EntityDetails = {
    description: textValue(d.description || r.description, 2000),
    language: textValue(d.language, 12),
    place_level: textValue(d.place_level, 60)
  }
  if (d.latitude !== undefined || d.longitude !== undefined) {
    if (
      typeof d.latitude !== 'number' ||
      typeof d.longitude !== 'number' ||
      !Number.isFinite(d.latitude) ||
      !Number.isFinite(d.longitude) ||
      Math.abs(d.latitude) > 90 ||
      Math.abs(d.longitude) > 180
    )
      fail('Coordinate non valide')
    details.latitude = d.latitude
    details.longitude = d.longitude
  }
  if (d.indicators && typeof d.indicators === 'object') {
    details.indicators = {}
    for (const [k, value] of Object.entries(d.indicators)) {
      if (
        !Object.hasOwn(SCORE_FACTORS, k) ||
        !value ||
        typeof value !== 'object'
      )
        fail('Indicatore non valido')
      const v = value as Record<string, unknown>
      if (
        typeof v.value !== 'number' ||
        !Number.isFinite(v.value) ||
        v.value < 0 ||
        v.value > 100
      )
        fail('Indicatore fuori intervallo 0-100')
      const source_url =
        safePublicUrl(v.source_url) ||
        fail('Ogni indicatore richiede una fonte')
      const rationale = textValue(v.rationale, 500)
      if (!rationale) fail('Ogni indicatore richiede una motivazione')
      details.indicators[k as FactorKey] = {
        value: v.value,
        source_url,
        rationale
      }
    }
  }
  const external_ids: Record<string, string> = {}
  if (r.external_ids && typeof r.external_ids === 'object')
    for (const [k, v] of Object.entries(r.external_ids)) {
      if (['wikidata', 'geonames', 'osm', 'iso', 'speaqi'].includes(k))
        external_ids[k] = textValue(v, 150)
    }
  return {
    kind,
    name,
    country_code,
    type_code,
    website,
    email,
    phone: textValue(r.phone, 80) || null,
    aliases: Array.isArray(r.aliases)
      ? r.aliases
          .map((a) => textValue(a, 200))
          .filter(Boolean)
          .slice(0, 30)
      : [],
    details,
    external_ids,
    evidence: normalizeEvidence(r.evidence, method)
  }
}

export function parseTourismImport(text: string) {
  if (text.length > 1_000_000) fail('File troppo grande (massimo 1 MB)')
  let raw: unknown[]
  if (text.trim().startsWith('[')) {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return fail('Il JSON deve contenere un array')
    raw = parsed
  } else {
    raw = parseCsvText(text).map((row) => ({
      ...row,
      evidence: {
        source_url: row.source_url,
        title: row.source_title || row.name,
        excerpt: row.source_note || '',
        fields: [
          'name',
          'country_code',
          'type_code',
          ...(row.website ? ['website'] : []),
          ...(row.email ? ['email'] : []),
          ...(row.phone ? ['phone'] : [])
        ]
      }
    }))
  }
  if (raw.length > 200)
    fail('Massimo 200 righe per importazione; suddividere il file in batch')
  const records: ImportRecord[] = []
  const errors: { row: number; message: string }[] = []
  raw.forEach((r, index) => {
    try {
      records.push(normalizeRecord(r))
    } catch (e) {
      errors.push({
        row: index + 1,
        message: e instanceof Error ? e.message : 'Riga non valida'
      })
    }
  })
  return { records, errors, total: raw.length }
}

/** Unknown factors never count as absence of a service, nor as zero. */
export function opportunityScore(
  entity: Pick<TourismEntity, 'details'>,
  evidence: Evidence[],
  weights: Partial<Record<FactorKey, number>> = {}
) {
  let known = 0
  let total = 0
  let points = 0
  const factors = (
    Object.entries(SCORE_FACTORS) as [
      FactorKey,
      (typeof SCORE_FACTORS)[FactorKey]
    ][]
  ).map(([key, f]) => {
    const weight =
      typeof weights[key] === 'number' &&
      Number.isFinite(weights[key]) &&
      weights[key]! >= 0
        ? weights[key]!
        : f.weight
    total += weight
    const indicator = entity.details.indicators?.[key]
    const verified =
      !!indicator &&
      typeof indicator.value === 'number' &&
      Number.isFinite(indicator.value) &&
      indicator.value >= 0 &&
      indicator.value <= 100 &&
      evidence.some(
        (e) =>
          e.status === 'VERIFIED' &&
          e.source_url === indicator.source_url &&
          e.fields.includes(`indicator:${key}`)
      )
    if (verified) {
      known += weight
      points += indicator!.value * weight
    }
    return {
      key,
      label: f.label,
      weight,
      value: verified ? indicator!.value : null,
      rationale: indicator?.rationale || '',
      source_url: indicator?.source_url || null
    }
  })
  const coverage = total ? Math.round((100 * known) / total) : 0
  const score = known ? Math.round(points / known) : null
  const priority =
    coverage < 60 || score === null
      ? 'NOT QUALIFIED'
      : score >= 75
        ? 'PRIORITY A'
        : score >= 50
          ? 'PRIORITY B'
          : 'PRIORITY C'
  return { score, coverage, priority, factors, formula: 'weighted-verified-v1' }
}

export function duplicateHints(
  entity: Pick<TourismEntity, 'name' | 'country_code' | 'website' | 'email'>,
  candidates: TourismEntity[]
) {
  return candidates
    .map((candidate) => {
      const reasons: string[] = []
      if (
        nameKey(entity.name) === nameKey(candidate.name) &&
        entity.country_code === candidate.country_code
      )
        reasons.push('Nome e paese coincidenti')
      if (
        entity.website &&
        candidate.website &&
        new URL(entity.website).hostname.replace(/^www\./, '') ===
          new URL(candidate.website).hostname.replace(/^www\./, '')
      )
        reasons.push('Dominio condiviso: controllare identità e brand')
      if (
        entity.email &&
        candidate.email &&
        entity.email.toLowerCase() === candidate.email.toLowerCase()
      )
        reasons.push('Email condivisa')
      return { candidate, reasons }
    })
    .filter((h) => h.reasons.length)
}

export function exportCsv(
  rows: Pick<
    TourismEntity,
    'name' | 'country_code' | 'type_code' | 'website' | 'status'
  >[]
) {
  const columns = [
    'name',
    'country_code',
    'type_code',
    'website',
    'status'
  ] as const
  const escape = (v: string) =>
    '"' +
    (/^\s*[=+@-]|^[\t\r\n]/.test(v) ? "'" + v : v).replace(/"/g, '""') +
    '"'
  return [
    columns.join(','),
    ...rows.map((r) => columns.map((k) => escape(String(r[k] || ''))).join(','))
  ].join('\r\n')
}
