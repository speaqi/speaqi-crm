import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { detectCsvColumns, extractPrimaryEmail, extractPrimaryPhone, getMappedValue, normalizePhoneDigits, parseCsvText, splitMultiValue } from '@/lib/csv-import'
import { isClosedStatus } from '@/lib/data'
import { createActivities, ensurePipelineStages, formatActivityDate } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

const ALLOWED_STATUSES = new Set([
  'New',
  'Contacted',
  'Interested',
  'Supertop',
  'Call booked',
  'Quote',
  'Lost',
  'Closed',
  'Paid',
])
const INVALID_LEGACY_IDS = new Set(['#REF!', '#N/A', 'N/A', 'NULL', 'null', 'NaN', 'nan'])
const UNSTABLE_IMPORT_LEGACY_ID = /^csv-import-\d+$/i

type ImportedRecord = {
  user_id: string
  legacy_id: string
  legacy_match_candidates: string[]
  name: string
  email: string | null
  phone: string | null
  category: string | null
  company: string | null
  event_tag: string | null
  list_name: string | null
  country: string | null
  status: string
  source: string
  contact_scope: 'crm' | 'holding'
  priority: number
  responsible: string | null
  value: number | null
  note: string | null
  last_activity_summary: string
  next_action_at: string | null
  next_followup_at: string | null
}

type ExistingContact = {
  id: string
  legacy_id?: string | null
  name: string
  email?: string | null
  phone?: string | null
  category?: string | null
  company?: string | null
  event_tag?: string | null
  list_name?: string | null
  country?: string | null
  status: string
  source?: string | null
  contact_scope?: 'crm' | 'holding' | null
  priority?: number | null
  responsible?: string | null
  value?: number | null
  note?: string | null
  last_activity_summary?: string | null
  next_followup_at?: string | null
  next_action_at?: string | null
}

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

function normalizeNumber(value: unknown) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const parsed = Number(normalized.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePriority(value: unknown) {
  const normalized = normalizeKey(value)
  if (!normalized) return 0

  if (['top', 'alta', 'high', 'hot', 'urgent', 'urgente'].includes(normalized)) return 3
  if (['media', 'medium', 'medio'].includes(normalized)) return 2
  if (['bassa', 'low', 'basso'].includes(normalized)) return 1
  if (['nessuna', 'none', 'n/a', 'na'].includes(normalized)) return 0

  const parsed = Number(normalized.replace(',', '.'))
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(3, Math.round(parsed)))
}

function normalizeStatus(value: unknown) {
  const raw = normalizeText(value)
  if (!raw) return 'New'

  const normalized = normalizeKey(raw)
  if (normalized === 'nuovo' || normalized === 'new') return 'New'
  if (normalized === 'contattato' || normalized === 'contacted') return 'Contacted'
  if (normalized === 'interessato' || normalized === 'interested') return 'Interested'
  if (normalized === 'supertop' || normalized === 'super' || normalized === 'top') return 'Supertop'
  if (normalized === 'callbooked' || normalized === 'callfissata' || normalized === 'callscheduled') return 'Call booked'
  if (normalized === 'preventivo' || normalized === 'quote') return 'Quote'
  if (normalized === 'perso' || normalized === 'lost' || normalized === 'notinterested') return 'Lost'
  if (normalized === 'chiuso' || normalized === 'closed') return 'Closed'
  if (normalized === 'pagato' || normalized === 'paid') return 'Paid'

  return ALLOWED_STATUSES.has(raw) ? raw : 'New'
}

function normalizeContactScope(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'holding' ? 'holding' : 'crm'
}

function normalizeDate(value: unknown) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function defaultFollowupAt() {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
}

function chunk<T>(items: T[], size = 100) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function buildNameCompanyKey(name?: string | null, company?: string | null) {
  const normalizedName = normalizeKey(name)
  const normalizedCompany = normalizeKey(company)
  if (!normalizedName || !normalizedCompany) return null
  return `${normalizedName}::${normalizedCompany}`
}

function shouldReplaceName(currentName?: string | null, importedName?: string | null, currentCompany?: string | null) {
  const nextName = normalizeText(importedName)
  if (!nextName) return false

  const current = normalizeText(currentName)
  if (!current) return true
  if (current === nextName) return false

  const normalizedCurrent = normalizeKey(current)
  return (
    normalizedCurrent.startsWith('lead legacy ') ||
    normalizedCurrent.startsWith('import csv ') ||
    normalizedCurrent === normalizeKey(currentCompany) ||
    normalizedCurrent === 'contatto senza nome'
  )
}

function mergeNotes(current?: string | null, incoming?: string | null) {
  const base = normalizeText(current)
  const extra = normalizeText(incoming)
  if (!base) return extra
  if (!extra || base.includes(extra)) return base
  return `${base}\n\n${extra}`
}

function makeUniqueLegacyId(baseValue: string, seen: Set<string>) {
  if (!seen.has(baseValue)) {
    seen.add(baseValue)
    return baseValue
  }

  let attempt = 2
  let candidate = `${baseValue}-${attempt}`
  while (seen.has(candidate)) {
    attempt += 1
    candidate = `${baseValue}-${attempt}`
  }
  seen.add(candidate)
  return candidate
}

function makeLegacyId(
  explicitValue: unknown,
  fingerprint: { email?: string | null; phone?: string | null; name?: string | null; company?: string | null; list_name?: string | null },
  index: number,
  seen: Set<string>
) {
  const normalizedExplicit = normalizeText(explicitValue)
  if (normalizedExplicit && !INVALID_LEGACY_IDS.has(normalizedExplicit)) {
    return makeUniqueLegacyId(normalizedExplicit, seen)
  }

  const seed = [
    normalizeKey(fingerprint.email),
    normalizePhoneDigits(fingerprint.phone),
    normalizeKey(fingerprint.name),
    normalizeKey(fingerprint.company),
    normalizeKey(fingerprint.list_name),
  ]
    .filter(Boolean)
    .join('|')

  const base =
    seed
      ? `csv-${createHash('sha1').update(seed).digest('hex').slice(0, 16)}`
      : `csv-row-${index + 1}`

  return makeUniqueLegacyId(base, seen)
}

function isStableLegacyId(value: unknown) {
  const normalized = normalizeText(value)
  if (!normalized) return false
  return !UNSTABLE_IMPORT_LEGACY_ID.test(normalized)
}

function findMatchingContact(record: ImportedRecord, contacts: ExistingContact[]) {
  const emailKey = normalizeKey(record.email)
  const phoneKey = normalizePhoneDigits(record.phone)
  const nameCompanyKey = buildNameCompanyKey(record.name, record.company)

  const legacyMatch =
    record.legacy_match_candidates.length
      ? contacts.find(
          (contact) =>
            isStableLegacyId(contact.legacy_id) &&
            record.legacy_match_candidates.includes(String(contact.legacy_id))
        )
      : null
  if (legacyMatch) return { contact: legacyMatch, reason: 'legacy_id' as const }

  const emailMatch =
    emailKey
      ? contacts.find((contact) => normalizeKey(contact.email) === emailKey)
      : null
  if (emailMatch) return { contact: emailMatch, reason: 'email' as const }

  const phoneMatch =
    phoneKey
      ? contacts.find((contact) => normalizePhoneDigits(contact.phone) === phoneKey)
      : null
  if (phoneMatch) return { contact: phoneMatch, reason: 'phone' as const }

  const nameCompanyMatch =
    nameCompanyKey
      ? contacts.find((contact) => buildNameCompanyKey(contact.name, contact.company) === nameCompanyKey)
      : null
  if (nameCompanyMatch) return { contact: nameCompanyMatch, reason: 'name_company' as const }

  return null
}

function buildImportedRecord(params: {
  row: Record<string, string>
  index: number
  userId: string
  defaultCategory: string | null
  defaultSource: string | null
  defaultResponsible: string | null
  contactScope: 'crm' | 'holding'
  defaultListName: string | null
  seenLegacyIds: Set<string>
  mapping: ReturnType<typeof detectCsvColumns>['mapping']
}) {
  const { row, index, userId, defaultCategory, defaultSource, defaultResponsible, contactScope, defaultListName, seenLegacyIds, mapping } = params

  const company = normalizeText(getMappedValue(row, mapping, 'company'))
  const explicitName = normalizeText(getMappedValue(row, mapping, 'name'))
  const firstName = normalizeText(getMappedValue(row, mapping, 'first_name'))
  const lastName = normalizeText(getMappedValue(row, mapping, 'last_name'))
  const fullName = explicitName || normalizeText([firstName, lastName].filter(Boolean).join(' ')) || company || `Import CSV ${index + 1}`

  const emailValues = splitMultiValue(getMappedValue(row, mapping, 'email'))
  const phoneValues = splitMultiValue(getMappedValue(row, mapping, 'phone'))
  const email = normalizeText(extractPrimaryEmail(emailValues.join(';')))
  const phone = normalizeText(extractPrimaryPhone(phoneValues.join(';')))
  const role = normalizeText(getMappedValue(row, mapping, 'role'))
  const province = normalizeText(getMappedValue(row, mapping, 'province'))
  const rawNote = normalizeText(getMappedValue(row, mapping, 'note'))
  const listName = normalizeText(getMappedValue(row, mapping, 'list_name')) || defaultListName
  const eventTag = normalizeText(getMappedValue(row, mapping, 'event_tag')) || (contactScope === 'holding' ? listName : null)
  const status = normalizeStatus(getMappedValue(row, mapping, 'status'))
  const nextFollowupAt = normalizeDate(getMappedValue(row, mapping, 'next_followup_at'))
  const effectiveFollowupAt =
    contactScope === 'holding'
      ? null
      : nextFollowupAt || (isClosedStatus(status) ? null : defaultFollowupAt())
  const note = [
    rawNote,
    role ? `Ruolo: ${role}` : null,
    province ? `Località: ${province}` : null,
    emailValues.length > 1 ? `Email aggiuntive: ${emailValues.slice(1).join(', ')}` : null,
    phoneValues.length > 1 ? `Telefoni aggiuntivi: ${phoneValues.slice(1).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const explicitLegacyValue = normalizeText(getMappedValue(row, mapping, 'legacy_id'))
  const legacyId = makeLegacyId(
    explicitLegacyValue,
    { email, phone, name: fullName, company, list_name: listName },
    index,
    seenLegacyIds
  )
  const legacyMatchCandidates = [legacyId]

  return {
    user_id: userId,
    legacy_id: legacyId,
    legacy_match_candidates: legacyMatchCandidates,
    name: fullName,
    email,
    phone,
    category: normalizeText(getMappedValue(row, mapping, 'category')) || defaultCategory,
    company,
    event_tag: eventTag,
    list_name: listName,
    country: normalizeText(getMappedValue(row, mapping, 'country')),
    status,
    source: normalizeText(getMappedValue(row, mapping, 'source')) || defaultSource || 'import',
    contact_scope: contactScope,
    priority: normalizePriority(getMappedValue(row, mapping, 'priority')),
    responsible: defaultResponsible || normalizeText(getMappedValue(row, mapping, 'responsible')),
    value: normalizeNumber(getMappedValue(row, mapping, 'value')),
    note: normalizeText(note),
    last_activity_summary:
      contactScope === 'holding'
        ? `Import CSV in lista separata (${status})`
        : `Import CSV (${status})`,
    next_action_at: effectiveFollowupAt,
    next_followup_at: effectiveFollowupAt,
  } satisfies ImportedRecord
}

function buildInsertPayload(record: ImportedRecord) {
  const { legacy_match_candidates, ...payload } = record
  return payload
}

function buildUpdatePayload(record: ImportedRecord, current: ExistingContact) {
  const effectiveScope = (current.contact_scope || 'crm') === 'crm' ? 'crm' : record.contact_scope
  const effectiveFollowupAt =
    effectiveScope === 'holding'
      ? null
      : current.next_followup_at || record.next_followup_at

  return {
    legacy_id: current.legacy_id || record.legacy_id,
    name: shouldReplaceName(current.name, record.name, current.company) ? record.name : current.name,
    email: current.email || record.email,
    phone: current.phone || record.phone,
    category: record.category || current.category || null,
    company: record.company || current.company || null,
    event_tag: record.event_tag || current.event_tag || null,
    list_name: record.list_name || current.list_name || null,
    country: record.country || current.country || null,
    source: current.source || record.source,
    contact_scope: effectiveScope,
    priority: Math.max(Number(current.priority || 0), Number(record.priority || 0)),
    responsible: current.responsible || record.responsible,
    value: current.value ?? record.value,
    note: mergeNotes(current.note, record.note),
    last_activity_summary: record.note || current.last_activity_summary || current.note || record.last_activity_summary,
    next_followup_at: effectiveFollowupAt,
    next_action_at:
      effectiveScope === 'holding'
        ? null
        : current.next_action_at || current.next_followup_at || record.next_action_at,
  }
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if ('message' in error && (error as { message?: unknown }).message) {
      return String((error as { message?: unknown }).message)
    }
    if ('details' in error && (error as { details?: unknown }).details) {
      return String((error as { details?: unknown }).details)
    }
    if ('hint' in error && (error as { hint?: unknown }).hint) {
      return String((error as { hint?: unknown }).hint)
    }
  }
  return fallback
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const csvText = String(body.csv_text || '')
    if (!csvText.trim()) {
      return Response.json({ error: 'Il contenuto CSV è obbligatorio' }, { status: 400 })
    }

    await ensurePipelineStages(auth.supabase, auth.user.id)

    const parsedRows = parseCsvText(csvText)
    if (!parsedRows.length) {
      return Response.json({ error: 'Il CSV non contiene righe importabili' }, { status: 400 })
    }

    const detection = detectCsvColumns(parsedRows)
    const defaultCategory = normalizeText(body.default_category)
    const defaultSource = normalizeText(body.default_source)
    const defaultResponsible = normalizeText(body.default_responsible)
    const contactScope = normalizeContactScope(body.contact_scope)
    const fileName = normalizeText(body.file_name)?.replace(/\.[^.]+$/, '')
    const requestedListName = normalizeText(body.list_name)
    const defaultListName =
      requestedListName || fileName || (contactScope === 'holding' ? defaultSource || 'Import CSV' : null)

    const seenLegacyIds = new Set<string>()
    const records = parsedRows.map((row, index) =>
      buildImportedRecord({
        row,
        index,
        userId: auth.user.id,
        defaultCategory,
        defaultSource,
        defaultResponsible,
        contactScope,
        defaultListName,
        seenLegacyIds,
        mapping: detection.mapping,
      })
    )

    const { data: existingRows, error: existingError } = await auth.supabase
      .from('contacts')
      .select('id, legacy_id, name, email, phone, category, company, event_tag, list_name, country, status, source, contact_scope, priority, responsible, value, note, last_activity_summary, next_followup_at, next_action_at')
      .eq('user_id', auth.user.id)

    if (existingError) throw existingError

    const existingContacts = [...(existingRows || [])] as ExistingContact[]
    const persistedContacts: Array<ExistingContact & { id: string }> = []
    const importResults: Array<{ contact: ExistingContact & { id: string }; created: boolean; matchReason: string | null }> = []
    let createdContacts = 0
    let updatedContacts = 0
    let matchedContacts = 0

    for (const record of records) {
      const matched = findMatchingContact(record, existingContacts)

      if (matched) {
        const payload = buildUpdatePayload(record, matched.contact)
        const { data, error } = await auth.supabase
          .from('contacts')
          .update(payload)
          .eq('user_id', auth.user.id)
          .eq('id', matched.contact.id)
          .select('*')
          .single()

        if (error) throw error

        updatedContacts += 1
        matchedContacts += matched.reason === 'legacy_id' ? 0 : 1
        const updated = data as ExistingContact & { id: string }
        const existingIndex = existingContacts.findIndex((contact) => contact.id === updated.id)
        if (existingIndex >= 0) existingContacts[existingIndex] = updated
        else existingContacts.push(updated)
        persistedContacts.push(updated)
        importResults.push({ contact: updated, created: false, matchReason: matched.reason })
        continue
      }

      const { data, error } = await auth.supabase
        .from('contacts')
        .insert(buildInsertPayload(record))
        .select('*')
        .single()

      if (error) throw error

      createdContacts += 1
      const created = data as ExistingContact & { id: string }
      existingContacts.push(created)
      persistedContacts.push(created)
      importResults.push({ contact: created, created: true, matchReason: null })
    }

    const contacts = persistedContacts

    const shouldCreateFollowups = contactScope !== 'holding'
    const openContacts = shouldCreateFollowups
      ? contacts.filter((contact) => !isClosedStatus(contact.status) && contact.next_followup_at)
      : []
    const existingTaskContactIds = new Set<string>()

    for (const batch of chunk(openContacts.map((contact) => contact.id))) {
      if (!batch.length) continue
      const { data, error } = await auth.supabase
        .from('tasks')
        .select('contact_id')
        .eq('user_id', auth.user.id)
        .eq('type', 'follow-up')
        .eq('status', 'pending')
        .in('contact_id', batch)

      if (error) throw error
      for (const row of data || []) {
        if (row.contact_id) existingTaskContactIds.add(row.contact_id)
      }
    }

    const pendingTasks = openContacts
      .filter((contact) => !existingTaskContactIds.has(contact.id))
      .map((contact) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'follow-up',
        action: 'call',
        due_date: contact.next_action_at || contact.next_followup_at,
        priority: Number(contact.priority || 0) >= 3 ? 'high' : Number(contact.priority || 0) >= 2 ? 'medium' : 'low',
        status: 'pending',
        note: `Follow-up importato da CSV${contact.category ? ` [${contact.category}]` : ''} per ${contact.name}`,
      }))

    const createdTaskContactIds = new Set(pendingTasks.map((task) => task.contact_id))
    let createdTasks = 0
    for (const batch of chunk(pendingTasks)) {
      if (!batch.length) continue
      const { data, error } = await auth.supabase.from('tasks').insert(batch).select('id')
      if (error) throw error
      createdTasks += data?.length || 0
    }

    await createActivities(
      auth.supabase,
      importResults.map(({ contact, created, matchReason }) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'import',
        content: [
          created ? 'Contatto creato da import CSV.' : 'Contatto aggiornato da import CSV.',
          matchReason === 'email' ? 'Match eseguito per email.' : null,
          matchReason === 'phone' ? 'Match eseguito per telefono.' : null,
          matchReason === 'name_company' ? 'Match eseguito per nome + azienda.' : null,
          `Stato: ${contact.status}.`,
          contact.contact_scope === 'holding'
            ? `Lista separata: ${contact.list_name || contact.event_tag || 'senza nome'}.`
            : 'Lista: CRM operativo.',
          contact.category ? `Categoria: ${contact.category}.` : null,
          contact.company ? `Azienda: ${contact.company}.` : null,
          contact.phone ? `Telefono: ${contact.phone}.` : null,
          contact.email ? `Email: ${contact.email}.` : null,
          contact.next_followup_at ? `Follow-up: ${formatActivityDate(contact.next_followup_at)}.` : null,
          createdTaskContactIds.has(contact.id) ? 'Task di follow-up creato automaticamente.' : null,
        ]
          .filter(Boolean)
          .join(' '),
      }))
    )

    return Response.json({
      parsed_rows: parsedRows.length,
      imported_contacts: contacts.length,
      created_contacts: createdContacts,
      updated_contacts: updatedContacts,
      matched_contacts: matchedContacts,
      created_tasks: createdTasks,
      contact_scope: contactScope,
      list_name: defaultListName,
      detected_mapping: detection.mapping,
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to import CSV') },
      { status: 500 }
    )
  }
}
