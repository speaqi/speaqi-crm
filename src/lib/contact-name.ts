const GENERIC_MAILBOX_ALIASES = new Set([
  'admin',
  'amministrazione',
  'booking',
  'bookings',
  'commerciale',
  'comunicazione',
  'contact',
  'contacts',
  'contatti',
  'hello',
  'help',
  'hospitality',
  'info',
  'mail',
  'office',
  'ordini',
  'orders',
  'prenotazioni',
  'reservations',
  'sales',
  'segreteria',
  'support',
  'team',
])

const SECOND_LEVEL_TLDS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org'])

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeKey(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function extractEmailParts(email?: string | null) {
  const normalized = normalizeText(email)
  if (!normalized || !normalized.includes('@')) return null

  const [localRaw, domainRaw] = normalized.split('@')
  const local = normalizeKey(localRaw)
  const domain = normalizeKey(domainRaw).replace(/^www\./, '')
  if (!local || !domain) return null

  return { local, domain }
}

export function isGenericMailboxAlias(value?: string | null) {
  const normalized = normalizeKey(value).replace(/[^a-z0-9]+/g, '')
  return !!normalized && GENERIC_MAILBOX_ALIASES.has(normalized)
}

export function deriveOrganizationNameFromEmail(email?: string | null) {
  const parts = extractEmailParts(email)
  if (!parts) return null

  const labels = parts.domain.split('.').filter(Boolean)
  if (!labels.length) return null

  let rootIndex = Math.max(labels.length - 2, 0)
  if (
    labels.length >= 3 &&
    SECOND_LEVEL_TLDS.has(labels[labels.length - 2])
  ) {
    rootIndex = labels.length - 3
  }

  const root = labels[rootIndex] || labels[0]
  const pretty = root
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return pretty ? toTitleCase(pretty) : null
}

export function isRepairableGenericName(name?: string | null, email?: string | null) {
  const normalizedName = normalizeKey(name)
  if (!normalizedName) return false

  if (isGenericMailboxAlias(normalizedName)) return true

  const parts = extractEmailParts(email)
  if (!parts) return false

  return normalizedName === parts.local && isGenericMailboxAlias(parts.local)
}

export function chooseBestContactName(input: {
  explicitName?: string | null
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  email?: string | null
  fallback?: string
}) {
  const explicitName = normalizeText(input.explicitName)
  const firstName = normalizeText(input.firstName)
  const lastName = normalizeText(input.lastName)
  const personName = normalizeText([firstName, lastName].filter(Boolean).join(' '))
  const company = normalizeText(input.company)
  const emailDerived = deriveOrganizationNameFromEmail(input.email)

  if (explicitName && !isRepairableGenericName(explicitName, input.email)) return explicitName
  if (personName) return personName
  if (company) return company
  if (emailDerived) return emailDerived
  if (explicitName) return explicitName
  return input.fallback || 'Contatto senza nome'
}

export function inferRepairName(input: {
  currentName?: string | null
  company?: string | null
  email?: string | null
}) {
  if (!isRepairableGenericName(input.currentName, input.email)) return null
  return chooseBestContactName({
    explicitName: null,
    company: input.company,
    email: input.email,
  })
}
