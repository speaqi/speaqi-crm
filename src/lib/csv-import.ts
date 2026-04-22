export type ParsedCsvRow = Record<string, string>

export type CsvImportField =
  | 'legacy_id'
  | 'name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'company'
  | 'role'
  | 'country'
  | 'province'
  | 'category'
  | 'priority'
  | 'note'
  | 'source'
  | 'status'
  | 'next_followup_at'
  | 'responsible'
  | 'value'
  | 'event_tag'
  | 'list_name'

export interface CsvColumnDetection {
  headers: string[]
  mapping: Partial<Record<CsvImportField, string>>
  unmatchedHeaders: string[]
}

const FIELD_ALIASES: Record<CsvImportField, string[]> = {
  legacy_id: ['legacyid', 'legacy_id', 'uid', 'recordid', 'externalid'],
  name: ['name', 'fullname', 'full_name', 'nominativo', 'contatto', 'contactname'],
  first_name: ['firstname', 'first_name', 'nome', 'givenname'],
  last_name: ['lastname', 'last_name', 'cognome', 'surname', 'familyname'],
  email: ['email', 'e-mail', 'mail', 'emailaddress', 'postaelettronica'],
  phone: ['phone', 'telefono', 'cellulare', 'mobile', 'tel', 'telephone', 'whatsapp'],
  company: ['company', 'azienda', 'organisation', 'organization', 'organizzazione', 'ente'],
  role: ['role', 'ruolo', 'title', 'jobtitle', 'qualifica', 'position'],
  country: ['country', 'nazione', 'paese'],
  province: ['province', 'provincia', 'prov', 'state', 'city'],
  category: ['category', 'categoria', 'tipo', 'segment', 'segmento'],
  priority: ['priority', 'priorita', 'prioritalead', 'leadpriority'],
  note: ['note', 'notes', 'comment', 'commento', 'commenti', 'annotazioni', 'memo'],
  source: ['source', 'origine', 'origin'],
  status: ['status', 'stato', 'pipeline', 'stage'],
  next_followup_at: ['nextfollowupat', 'next_followup_at', 'followup', 'follow-up', 'nextstep', 'nextactiondate'],
  responsible: ['responsible', 'responsabile', 'owner', 'assignedto', 'assignee'],
  value: ['value', 'valore', 'amount'],
  event_tag: ['event', 'evento', 'eventtag', 'event_tag'],
  list_name: ['list', 'lista', 'listname', 'list_name', 'nomelista'],
}

const DETECTION_ORDER: CsvImportField[] = [
  'legacy_id',
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'company',
  'role',
  'country',
  'province',
  'category',
  'priority',
  'note',
  'source',
  'status',
  'next_followup_at',
  'responsible',
  'value',
  'event_tag',
  'list_name',
]

export function parseCsvText(text: string) {
  const rows: string[][] = []
  const normalized = text.replace(/^\uFEFF/, '')
  let currentRow: string[] = []
  let currentCell = ''
  let inQuotes = false

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]

    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          currentCell += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        currentCell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      currentRow.push(currentCell)
      currentCell = ''
      continue
    }

    if (char === '\n') {
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ''
      continue
    }

    if (char === '\r') continue
    currentCell += char
  }

  if (currentCell || currentRow.length) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  if (!rows.length) return []

  const headers = rows[0].map((value) => value.trim())
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) =>
      headers.reduce<ParsedCsvRow>((record, header, index) => {
        record[header] = row[index] ?? ''
        return record
      }, {})
    )
}

export function normalizeCsvHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function detectCsvColumns(rows: ParsedCsvRow[]): CsvColumnDetection {
  const headers = Object.keys(rows[0] || {})
  const usedHeaders = new Set<string>()
  const mapping: Partial<Record<CsvImportField, string>> = {}

  for (const field of DETECTION_ORDER) {
    const aliases = new Set(FIELD_ALIASES[field].map(normalizeCsvHeader))
    const match = headers.find((header) => !usedHeaders.has(header) && aliases.has(normalizeCsvHeader(header)))

    if (match) {
      mapping[field] = match
      usedHeaders.add(match)
    }
  }

  return {
    headers,
    mapping,
    unmatchedHeaders: headers.filter((header) => !usedHeaders.has(header)),
  }
}

export function getMappedValue(
  row: ParsedCsvRow,
  mapping: Partial<Record<CsvImportField, string>>,
  field: CsvImportField
) {
  const header = mapping[field]
  if (!header) return ''
  return row[header] ?? ''
}

export function cleanCsvCell(value: unknown) {
  return String(value || '').trim()
}

export function splitMultiValue(value: unknown) {
  return cleanCsvCell(value)
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function normalizePhoneDigits(value: unknown) {
  return cleanCsvCell(value).replace(/\D+/g, '')
}

export function extractPrimaryEmail(value: unknown) {
  return splitMultiValue(value).find((entry) => entry.includes('@')) || null
}

export function extractPrimaryPhone(value: unknown) {
  return splitMultiValue(value).find((entry) => normalizePhoneDigits(entry).length >= 6) || null
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? '')
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function stringifyCsvRows(rows: ParsedCsvRow[], preferredHeaders: string[] = []) {
  if (!rows.length) {
    return preferredHeaders.join(',')
  }

  const headerSet = new Set<string>()
  for (const header of preferredHeaders) {
    if (header) headerSet.add(header)
  }
  for (const row of rows) {
    for (const header of Object.keys(row)) {
      if (header) headerSet.add(header)
    }
  }

  const headers = Array.from(headerSet)
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? '')).join(',')),
  ]

  return lines.join('\n')
}
