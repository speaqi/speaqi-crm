const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EngagementSummary = {
  count: number
  lastAt: string | null
  name?: string | null
}

export function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function normalizeContactScope(value: unknown) {
  const scope = String(value || '').trim().toLowerCase()
  if (scope === 'holding') return 'holding'
  return 'crm'
}

export function normalizeEmail(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return EMAIL_RE.test(normalized) ? normalized : null
}

export function normalizeTimestamp(value: unknown) {
  if (value === null || value === undefined || value === '') return new Date().toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString()
  }
  const raw = String(value).trim()
  if (!raw) return new Date().toISOString()
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric).toISOString()
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export function laterTimestamp(left: string | null, right: string | null) {
  if (!left) return right
  if (!right) return left
  return new Date(right).getTime() > new Date(left).getTime() ? right : left
}

function normalizePositiveInt(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.round(parsed)
  return normalized > 0 ? normalized : null
}

function eventCountFromRecord(record: Record<string, unknown>) {
  return (
    normalizePositiveInt(
      firstValue(record, [
        'count',
        'total',
        'opens',
        'open_count',
        'clicks',
        'click_count',
        'times_opened',
        'times_clicked',
      ])
    ) || 1
  )
}

function eventNameFromRecord(record: Record<string, unknown>) {
  return normalizeText(
    firstValue(record, [
      'name',
      'full_name',
      'subscriber_name',
      'subscriber_full_name',
      'nombre',
      'nombre_completo',
    ])
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function addSummaryWithMeta(
  map: Map<string, EngagementSummary>,
  email: string,
  occurredAt: string | null,
  count: number,
  name?: string | null
) {
  const current = map.get(email) || { count: 0, lastAt: null, name: null }
  current.count += Math.max(1, count)
  current.lastAt = laterTimestamp(current.lastAt, occurredAt || new Date().toISOString())
  if (!current.name && name) current.name = name
  map.set(email, current)
}

export function collectEmailEvents(
  payload: unknown,
  out = new Map<string, EngagementSummary>(),
  seen = new WeakSet<object>()
) {
  if (Array.isArray(payload)) {
    for (const item of payload) collectEmailEvents(item, out, seen)
    return out
  }

  if (!isRecord(payload)) return out
  if (seen.has(payload)) return out
  seen.add(payload)

  const directEmail = normalizeEmail(
    firstValue(payload, ['email', 'mail', 'subscriber_email', 'email_address', 'recipient'])
  )
  if (directEmail) {
    const occurredAt = normalizeTimestamp(
      firstValue(payload, ['date', 'timestamp', 'created_at', 'occurred_at', 'click_date', 'open_date'])
    )
    addSummaryWithMeta(out, directEmail, occurredAt, eventCountFromRecord(payload), eventNameFromRecord(payload))
    return out
  }

  let handledEmailKeys = false
  for (const [key, value] of Object.entries(payload)) {
    const keyEmail = normalizeEmail(key)
    if (keyEmail) {
      const occurredAt = isRecord(value)
        ? normalizeTimestamp(firstValue(value, ['date', 'timestamp', 'created_at', 'occurred_at', 'click_date', 'open_date']))
        : normalizeTimestamp(value)
      const valueRecord = isRecord(value) ? value : {}
      const count = isRecord(value)
        ? (eventCountFromRecord(value) || 1)
        : (typeof value === 'number' && Number.isFinite(value)
          ? Math.max(1, Math.round(value))
          : (Number(String(value).replace(',', '.')) || 1))
      const name = isRecord(valueRecord) ? eventNameFromRecord(valueRecord) : null
      addSummaryWithMeta(out, keyEmail, occurredAt, count, name)
      handledEmailKeys = true
      continue
    }
    collectEmailEvents(value, out, seen)
  }

  if (handledEmailKeys) {
    return out
  }

  return out
}

export async function fetchAcumbamailFunction(functionName: string, authToken: string, campaignId: string) {
  const params = new URLSearchParams()
  params.set('auth_token', authToken)
  params.set('campaign_id', campaignId)
  params.set('response_type', 'json')

  const response = await fetch(`https://acumbamail.com/api/1/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    cache: 'no-store',
  })

  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }

  if (!response.ok) {
    throw new Error(`Acumbamail ${functionName} failed (${response.status})`)
  }

  return payload
}

export function inferContactName(email: string) {
  const local = email.split('@')[0] || email
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  if (!cleaned || ['info', 'admin', 'office', 'sales', 'marketing', 'commerciale'].includes(cleaned.toLowerCase())) {
    return email
  }
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function slugify(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
