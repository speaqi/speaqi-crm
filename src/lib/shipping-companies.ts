// Compagnie di navigazione passeggeri (/navigazione). Modulo puro: lo usano la
// pagina, l'API e lo script di import (scripts/import_shipping_companies.ts),
// cosi' "arriva a Napoli" significa la stessa cosa ovunque.

export type ShippingKind = 'cruise' | 'expedition' | 'river' | 'ferry'
export type ShippingSegment = 'mass' | 'premium' | 'luxury' | 'expedition' | 'river' | 'ferry'
export type ShippingPortFilter = 'all' | 'naples' | 'civitavecchia' | 'both' | 'either' | 'none' | 'unknown'

export interface ShippingContactRef {
  label: string
  value: string
  source?: string | null
}

export interface ShippingItalyOffice {
  city?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

/** Una voce del catalogo (scripts/data/shipping-companies.json), gia' ripulita. */
export interface ShippingCatalogEntry {
  slug: string
  name: string
  kind: ShippingKind
  segment: ShippingSegment | null
  parent_group: string | null
  hq_city: string | null
  hq_country: string | null
  hq_address: string | null
  website: string | null
  phone: string | null
  email: string | null
  italy_office: ShippingItalyOffice | null
  contacts: ShippingContactRef[]
  fleet_size: number | null
  ships: string[]
  calls_naples: boolean | null
  calls_civitavecchia: boolean | null
  ports_note: string | null
  active: boolean
  sources: string[]
}

/** Riga di `shipping_companies` come la restituisce l'API. */
export interface ShippingCompany extends ShippingCatalogEntry {
  id: string
  ports_manual: boolean
  contact_id: string | null
  checked_at: string | null
  created_at: string
  updated_at: string
}

export const SHIPPING_KINDS: ShippingKind[] = ['cruise', 'expedition', 'river', 'ferry']
export const SHIPPING_SEGMENTS: ShippingSegment[] = ['mass', 'premium', 'luxury', 'expedition', 'river', 'ferry']

export const SHIPPING_KIND_LABELS: Record<ShippingKind, string> = {
  cruise: 'Crociere',
  expedition: 'Expedition',
  river: 'Fluviali',
  ferry: 'Traghetti',
}

export const SHIPPING_SEGMENT_LABELS: Record<ShippingSegment, string> = {
  mass: 'Mass market',
  premium: 'Premium',
  luxury: 'Luxury',
  expedition: 'Expedition',
  river: 'Fluviale',
  ferry: 'Traghetti',
}

/** Cartella holding in cui lo script mette i contatti: in /contacts diventa un chip. */
export const SHIPPING_LIST_NAME = 'Compagnie di navigazione'
export const SHIPPING_EVENT_TAG = 'compagnie-navigazione'
export const SHIPPING_SOURCE = 'catalogo_navigazione'
export const SHIPPING_LEGACY_PREFIX = 'shipping-'

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i

function text(value: unknown, max = 500): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const clean = String(value).replace(/\s+/g, ' ').trim()
  if (!clean || /^(n\/?a|null|none|unknown|-)$/i.test(clean)) return null
  return clean.slice(0, max)
}

function bool(value: unknown): boolean | null {
  if (value === true || value === false) return value
  return null
}

export function slugifyShippingName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function normalizeShippingWebsite(value: unknown): string | null {
  const raw = text(value, 300)
  if (!raw) return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function normalizeShippingEmail(value: unknown): string | null {
  const raw = text(value, 200)?.toLowerCase().replace(/^mailto:/, '') || null
  return raw && EMAIL_RE.test(raw) ? raw : null
}

/** Tiene il numero come l'ha scritto la fonte, ma solo se sembra un numero di telefono. */
export function normalizeShippingPhone(value: unknown): string | null {
  const raw = text(value, 60)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 6 || digits.length > 16) return null
  if (!/^[+\d(][\d\s().\-/]*$/.test(raw)) return null
  return raw
}

function normalizeContacts(value: unknown): ShippingContactRef[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: ShippingContactRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const label = text(record.label, 120)
    const refValue = text(record.value, 300)
    if (!label || !refValue) continue
    const key = `${label.toLowerCase()}|${refValue.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ label, value: refValue, source: normalizeShippingWebsite(record.source) })
  }
  return result
}

function normalizeItalyOffice(value: unknown): ShippingItalyOffice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const office: ShippingItalyOffice = {
    city: text(record.city, 120),
    address: text(record.address, 300),
    phone: normalizeShippingPhone(record.phone),
    email: normalizeShippingEmail(record.email),
  }
  return Object.values(office).some(Boolean) ? office : null
}

function stringList(value: unknown, max: number, itemMax = 300): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    const clean = text(item, itemMax)
    if (clean && !result.includes(clean)) result.push(clean)
    if (result.length >= max) break
  }
  return result
}

/**
 * Ripulisce una voce del catalogo. Restituisce l'errore invece di lanciare,
 * cosi' lo script puo' riportare tutte le voci scartate in un colpo solo.
 */
export function normalizeShippingEntry(raw: unknown): { entry: ShippingCatalogEntry } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'voce non valida' }
  const record = raw as Record<string, unknown>
  const name = text(record.name, 160)
  if (!name) return { error: 'nome mancante' }
  const slug = text(record.slug, 80)?.toLowerCase() || slugifyShippingName(name)
  if (!SLUG_RE.test(slug)) return { error: `${name}: slug non valido (${slug})` }
  const kind = SHIPPING_KINDS.includes(record.kind as ShippingKind) ? (record.kind as ShippingKind) : 'cruise'
  const segment = SHIPPING_SEGMENTS.includes(record.segment as ShippingSegment)
    ? (record.segment as ShippingSegment)
    : kind === 'cruise' ? null : (kind as ShippingSegment)
  const note = text(record.ports_note, 600)
  const fleet = Number(record.fleet_size)

  return {
    entry: {
      slug,
      name,
      kind,
      segment,
      parent_group: text(record.parent_group, 160),
      hq_city: text(record.hq_city, 120),
      hq_country: text(record.hq_country, 80),
      hq_address: text(record.hq_address, 300),
      website: normalizeShippingWebsite(record.website),
      phone: normalizeShippingPhone(record.phone),
      email: normalizeShippingEmail(record.email),
      italy_office: normalizeItalyOffice(record.italy_office),
      contacts: normalizeContacts(record.contacts),
      fleet_size: Number.isFinite(fleet) && fleet >= 0 && record.fleet_size !== null ? Math.round(fleet) : null,
      ships: stringList(record.ships ?? record.ships_example, 12, 80),
      calls_naples: bool(record.calls_naples),
      calls_civitavecchia: bool(record.calls_civitavecchia),
      ports_note: note,
      // "CESSATA:" / "CONFLUITA IN" nella nota = marchio che non opera piu'.
      active: record.active === false ? false : !(note && /^(cessata|confluita)/i.test(note)),
      sources: stringList(record.sources, 20).filter((url) => normalizeShippingWebsite(url)),
    },
  }
}

/** Normalizza l'intero catalogo: scarta i doppioni di slug tenendo la prima voce. */
export function normalizeShippingCatalog(raw: unknown) {
  const entries: ShippingCatalogEntry[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(raw) ? raw : []) {
    const result = normalizeShippingEntry(item)
    if ('error' in result) {
      errors.push(result.error)
      continue
    }
    if (seen.has(result.entry.slug)) {
      errors.push(`${result.entry.name}: slug duplicato (${result.entry.slug})`)
      continue
    }
    seen.add(result.entry.slug)
    entries.push(result.entry)
  }
  return { entries, errors }
}

type PortFlags = Pick<ShippingCatalogEntry, 'calls_naples' | 'calls_civitavecchia'>

export function matchesShippingPortFilter(company: PortFlags, filter: ShippingPortFilter) {
  const naples = company.calls_naples === true
  const civitavecchia = company.calls_civitavecchia === true
  switch (filter) {
    case 'naples': return naples
    case 'civitavecchia': return civitavecchia
    case 'both': return naples && civitavecchia
    case 'either': return naples || civitavecchia
    case 'none': return company.calls_naples === false && company.calls_civitavecchia === false
    case 'unknown': return company.calls_naples === null || company.calls_civitavecchia === null
    default: return true
  }
}

/** Priorita' del contatto: chi arriva in entrambi i porti e' la prima telefonata. */
export function shippingContactPriority(company: PortFlags) {
  const ports = Number(company.calls_naples === true) + Number(company.calls_civitavecchia === true)
  return ports === 2 ? 2 : ports
}

export function shippingPortsLabel(company: PortFlags) {
  const ports: string[] = []
  if (company.calls_naples) ports.push('Napoli')
  if (company.calls_civitavecchia) ports.push('Civitavecchia (Roma)')
  if (ports.length) return ports.join(' + ')
  if (company.calls_naples === false && company.calls_civitavecchia === false) return 'Né Napoli né Civitavecchia'
  return 'Scali da verificare'
}

export function shippingCategory(kind: ShippingKind) {
  switch (kind) {
    case 'ferry': return 'Compagnia di traghetti'
    case 'river': return 'Crociere fluviali'
    case 'expedition': return 'Crociere expedition'
    default: return 'Compagnia di crociera'
  }
}

export function shippingHeadquarters(company: Pick<ShippingCatalogEntry, 'hq_city' | 'hq_country'>) {
  return [company.hq_city, company.hq_country].filter(Boolean).join(', ')
}

/** Nota leggibile sul contatto: tutto quello che serve prima di alzare il telefono. */
export function shippingContactNote(company: ShippingCatalogEntry) {
  const lines = [
    `${shippingCategory(company.kind)}${company.parent_group ? ` — gruppo ${company.parent_group}` : ''}`,
    `Sede: ${company.hq_address || shippingHeadquarters(company) || 'n.d.'}`,
    `Scali: ${shippingPortsLabel(company)}${company.ports_note ? ` — ${company.ports_note}` : ''}`,
  ]
  const office = company.italy_office
  if (office) {
    const parts = [office.city, office.address, office.phone, office.email].filter(Boolean)
    if (parts.length) lines.push(`Ufficio Italia: ${parts.join(' · ')}`)
  }
  for (const ref of company.contacts.slice(0, 6)) lines.push(`${ref.label}: ${ref.value}`)
  if (company.ships.length) lines.push(`Navi: ${company.ships.slice(0, 5).join(', ')}`)
  return lines.join('\n')
}

/**
 * Il contatto da creare per una compagnia. Sta in holding, nella cartella
 * "Compagnie di navigazione": fuori dalla pipeline finche' qualcuno non ci
 * lavora, e `marketing_eligibility = review` perche' nessuna campagna
 * automatica deve scrivere all'ufficio stampa di una compagnia di crociera.
 */
export function shippingContactPayload(company: ShippingCatalogEntry, userId: string) {
  const office = company.italy_office
  return {
    user_id: userId,
    legacy_id: `${SHIPPING_LEGACY_PREFIX}${company.slug}`,
    name: company.name,
    company: company.name,
    email: company.email || office?.email || null,
    phone: office?.phone || company.phone || null,
    category: shippingCategory(company.kind),
    industry: 'Navigazione passeggeri',
    country: company.hq_country,
    status: 'New',
    source: SHIPPING_SOURCE,
    priority: shippingContactPriority(company),
    contact_scope: 'holding',
    list_name: SHIPPING_LIST_NAME,
    event_tag: SHIPPING_EVENT_TAG,
    note: shippingContactNote(company),
    last_activity_summary: `Catalogo compagnie di navigazione — ${shippingPortsLabel(company)}`,
    marketing_eligibility: 'review',
    marketing_reason: 'b2b_compagnia_navigazione:contatto_manuale',
    normalized_website: company.website,
  }
}

export function summarizeShipping(companies: Array<PortFlags & Pick<ShippingCatalogEntry, 'kind' | 'active' | 'phone' | 'italy_office'>>) {
  const byKind: Record<ShippingKind, number> = { cruise: 0, expedition: 0, river: 0, ferry: 0 }
  let naples = 0
  let civitavecchia = 0
  let both = 0
  let unknown = 0
  let withPhone = 0
  let inactive = 0
  for (const company of companies) {
    byKind[company.kind] += 1
    if (company.calls_naples) naples += 1
    if (company.calls_civitavecchia) civitavecchia += 1
    if (company.calls_naples && company.calls_civitavecchia) both += 1
    if (company.calls_naples === null || company.calls_civitavecchia === null) unknown += 1
    if (company.phone || company.italy_office?.phone) withPhone += 1
    if (!company.active) inactive += 1
  }
  return { total: companies.length, naples, civitavecchia, both, unknown, withPhone, inactive, byKind }
}
