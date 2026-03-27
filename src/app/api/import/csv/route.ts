import { NextRequest } from 'next/server'
import { createActivities, ensurePipelineStages, formatActivityDate } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

const ALLOWED_STATUSES = new Set(['New', 'Contacted', 'Interested', 'Call booked', 'Closed'])

function parseCsvText(text: string) {
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
      headers.reduce<Record<string, string>>((record, header, index) => {
        record[header] = row[index] ?? ''
        return record
      }, {})
    )
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizePriority(value: unknown) {
  const normalized = Number(normalizeText(value) || 0)
  if (!Number.isFinite(normalized)) return 0
  return Math.max(0, Math.min(3, Math.round(normalized)))
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

    const records = parsedRows.map((row, index) => {
      const status = normalizeText(row.status)
      const nextFollowupAt = normalizeText(row.next_followup_at)
      return {
        user_id: auth.user.id,
        legacy_id: normalizeText(row.legacy_id) || `csv-import-${index + 1}`,
        name: normalizeText(row.name) || `Lead legacy ${index + 1}`,
        email: normalizeText(row.email),
        phone: normalizeText(row.phone),
        status: status && ALLOWED_STATUSES.has(status) ? status : 'New',
        source: normalizeText(row.source) || 'legacy-kanban',
        priority: normalizePriority(row.priority),
        responsible: normalizeText(row.responsible),
        value: normalizeNumber(row.value),
        note: normalizeText(row.note),
        last_activity_summary: `Import CSV legacy (${status && ALLOWED_STATUSES.has(status) ? status : 'New'})`,
        next_followup_at: nextFollowupAt || (status === 'Closed' ? null : defaultFollowupAt()),
      }
    })

    const knownLegacyIds = new Set<string>()
    for (const batch of chunk(records.map((record) => record.legacy_id).filter(Boolean))) {
      if (!batch.length) continue
      const { data, error } = await auth.supabase
        .from('contacts')
        .select('legacy_id')
        .eq('user_id', auth.user.id)
        .in('legacy_id', batch)

      if (error) throw error
      for (const row of data || []) {
        if (row.legacy_id) knownLegacyIds.add(row.legacy_id)
      }
    }

    const contacts: Array<{
      id: string
      legacy_id?: string | null
      name: string
      status: string
      source?: string | null
      phone?: string | null
      email?: string | null
      next_followup_at?: string | null
    }> = []
    for (const batch of chunk(records)) {
      const { data, error } = await auth.supabase
        .from('contacts')
        .upsert(batch, { onConflict: 'user_id,legacy_id' })
        .select('id, legacy_id, name, status, source, phone, email, next_followup_at')

      if (error) throw error
      contacts.push(...(data || []))
    }

    const openContacts = contacts.filter((contact) => contact.status !== 'Closed' && contact.next_followup_at)
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
        due_date: contact.next_followup_at,
        status: 'pending',
        note: `Follow-up importato da CSV per ${contact.name}`,
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
      contacts.map((contact) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'import',
        content: [
          `Contatto ${knownLegacyIds.has(contact.legacy_id || '') ? 'aggiornato' : 'creato'} da import CSV.`,
          `Stato: ${contact.status}.`,
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
      created_tasks: createdTasks,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to import CSV' },
      { status: 500 }
    )
  }
}
