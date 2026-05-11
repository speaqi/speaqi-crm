import { NextRequest } from 'next/server'
import { ensurePipelineStages, createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { isClosedStatus } from '@/lib/data'

type EngagementSummary = {
  count: number
  lastAt: string | null
  name?: string | null
}

type ContactRow = {
  id: string
  user_id: string
  name: string
  email?: string | null
  status: string
  source?: string | null
  contact_scope?: 'crm' | 'holding' | 'personal' | null
  priority?: number | null
  responsible?: string | null
  assigned_agent?: string | null
  list_name?: string | null
  event_tag?: string | null
  email_open_count?: number | null
  email_click_count?: number | null
  last_email_open_at?: string | null
  last_email_click_at?: string | null
  next_action_at?: string | null
  next_followup_at?: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeEmail(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return EMAIL_RE.test(normalized) ? normalized : null
}

function normalizeContactScope(value: unknown) {
  const scope = String(value || '').trim().toLowerCase()
  if (scope === 'holding') return 'holding'
  return 'crm'
}

function normalizeTimestamp(value: unknown) {
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

function laterTimestamp(left: string | null, right: string | null) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

function collectEmailEvents(
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
      const count = isRecord(valueRecord) ? eventCountFromRecord(valueRecord) : 1
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

function inferContactName(email: string) {
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

function shouldReplaceWithImportedName(currentName: string, email: string, importedName: string) {
  const current = normalizeText(currentName)?.toLowerCase() || ''
  const imported = normalizeText(importedName)?.toLowerCase() || ''
  if (!imported || imported === current) return false
  const genericNames = new Set(['contatto senza nome', 'lead legacy', 'import csv'])
  if (genericNames.has(current)) return true
  if (current.includes('@')) return true
  if (current === email.toLowerCase()) return true
  return false
}

function defaultFollowupAt(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function chunk<T>(items: T[], size = 100) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

async function fetchAcumbamailFunction(functionName: string, authToken: string, campaignId: string) {
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

async function findContactsByEmail(supabase: any, userId: string, emails: string[]) {
  const byEmail = new Map<string, ContactRow[]>()
  for (const batch of chunk(emails, 200)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .in('email', batch)

    if (error) throw error

    for (const contact of (data || []) as ContactRow[]) {
      const email = normalizeEmail(contact.email)
      if (!email) continue
      const rows = byEmail.get(email) || []
      rows.push(contact)
      byEmail.set(email, rows)
    }
  }
  return byEmail
}

async function readAlreadySyncedEvents(
  supabase: any,
  userId: string,
  campaignId: string,
  contacts: ContactRow[]
) {
  const result = new Set<string>()
  for (const batch of chunk(contacts.map((contact) => contact.id), 200)) {
    const { data, error } = await supabase
      .from('activities')
      .select('contact_id,type,metadata')
      .eq('user_id', userId)
      .in('contact_id', batch)
      .in('type', ['email_open', 'email_click'])

    if (error) throw error

    for (const row of data || []) {
      const metadata = isRecord(row.metadata) ? row.metadata : {}
      if (String(metadata.provider || '') !== 'acumbamail_api') continue
      if (String(metadata.campaign_id || '') !== campaignId) continue
      result.add(`${row.contact_id}:${row.type}`)
    }
  }
  return result
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin puo sincronizzare campagne Acumbamail' }, { status: 403 })

  try {
    const token = process.env.ACUMBAMAIL_AUTH_TOKEN
    if (!token) {
      return Response.json({ error: 'ACUMBAMAIL_AUTH_TOKEN non configurato in Railway Variables' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const campaignId = normalizeText(body.campaign_id || body.campaignId)
    if (!campaignId) return Response.json({ error: 'campaign_id obbligatorio' }, { status: 400 })

    const responsible = normalizeText(body.responsible)
    const assignedAgent = normalizeText(body.assigned_agent)
    const listName = normalizeText(body.list_name) || `Acumbamail ${campaignId}`
    const eventTag = normalizeText(body.event_tag)
    const source = normalizeText(body.source) || 'acumbamail'
    const contactScope = normalizeContactScope(body.contact_scope)
    const createMissing = body.create_missing !== false

    const [openersPayload, clicksPayload] = await Promise.all([
      fetchAcumbamailFunction('getCampaignOpeners', token, campaignId),
      fetchAcumbamailFunction('getCampaignClicks', token, campaignId),
    ])

    const openers = collectEmailEvents(openersPayload)
    const clickers = collectEmailEvents(clicksPayload)
    const allEmails = Array.from(new Set([...openers.keys(), ...clickers.keys()])).sort()

    await ensurePipelineStages(auth.supabase, auth.workspaceUserId)

    const contactsByEmail = await findContactsByEmail(auth.supabase, auth.workspaceUserId, allEmails)
    let createdContacts = 0

    if (createMissing) {
      const missingEmails = allEmails.filter((email) => !contactsByEmail.has(email))
      for (const batch of chunk(missingEmails, 100)) {
        const payload = batch.map((email) => {
          const hasClick = clickers.has(email)
          const inferredName = clickers.get(email)?.name || openers.get(email)?.name || inferContactName(email)
          return {
            user_id: auth.workspaceUserId,
            name: inferredName,
            email,
            status: hasClick ? 'Interested' : 'Contacted',
            source,
            contact_scope: contactScope,
            priority: hasClick ? 3 : 2,
            responsible,
            assigned_agent: assignedAgent,
            list_name: listName,
            event_tag: eventTag,
            note: `Creato da sync Acumbamail campagna ${campaignId}.`,
            last_activity_summary: hasClick
              ? `Click rilevato nella campagna Acumbamail ${campaignId}.`
              : `Apertura rilevata nella campagna Acumbamail ${campaignId}.`,
            next_action_at: contactScope === 'crm' ? defaultFollowupAt(hasClick ? 1 : 3) : null,
            next_followup_at: contactScope === 'crm' ? defaultFollowupAt(hasClick ? 1 : 3) : null,
          }
        })

        const { data, error } = await auth.supabase.from('contacts').insert(payload).select('*')
        if (error) throw error
        createdContacts += (data || []).length
        for (const contact of (data || []) as ContactRow[]) {
          const email = normalizeEmail(contact.email)
          if (!email) continue
          contactsByEmail.set(email, [contact])
        }
      }
    }

    const contacts = Array.from(contactsByEmail.values()).flat()
    const alreadySynced = await readAlreadySyncedEvents(auth.supabase, auth.workspaceUserId, campaignId, contacts)

    let updatedContacts = 0
    let loggedActivities = 0
    let skippedDuplicates = 0
    const activities: Parameters<typeof createActivities>[1] = []

    for (const email of allEmails) {
      const targets = contactsByEmail.get(email) || []
      if (!targets.length) continue

      const open = openers.get(email) || null
      const click = clickers.get(email) || null

      for (const contact of targets) {
        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          source: contact.source || source,
          contact_scope: contact.contact_scope === 'personal' ? contact.contact_scope : contactScope,
        }

        if (responsible) updates.responsible = responsible
        if (assignedAgent) updates.assigned_agent = assignedAgent
        if (listName) updates.list_name = listName
        if (eventTag) updates.event_tag = eventTag
        let changed = false
        const importedName = click?.name || open?.name || null
        if (
          importedName &&
          shouldReplaceWithImportedName(contact.name || '', email, importedName)
        ) {
          updates.name = importedName
          changed = true
        }
        const openKey = `${contact.id}:email_open`
        if (open && !alreadySynced.has(openKey)) {
          updates.email_open_count = Math.max(0, Number(contact.email_open_count || 0)) + open.count
          updates.last_email_open_at = laterTimestamp(contact.last_email_open_at || null, open.lastAt)
          updates.priority = Math.max(Number(contact.priority || 0), 2)
          if (!isClosedStatus(contact.status) && contact.status === 'New') updates.status = 'Contacted'
          activities.push({
            user_id: auth.workspaceUserId,
            contact_id: contact.id,
            type: 'email_open',
            content: `${email} ha aperto la campagna Acumbamail ${campaignId}.`,
            metadata: {
              provider: 'acumbamail_api',
              provider_event: 'opens',
              campaign_id: campaignId,
              count: open.count,
              last_at: open.lastAt,
            },
          })
          changed = true
          loggedActivities += 1
        } else if (open) {
          skippedDuplicates += 1
        }

        const clickKey = `${contact.id}:email_click`
        if (click && !alreadySynced.has(clickKey)) {
          updates.email_click_count = Math.max(0, Number(contact.email_click_count || 0)) + click.count
          updates.last_email_click_at = laterTimestamp(contact.last_email_click_at || null, click.lastAt)
          updates.priority = 3
          if (!isClosedStatus(contact.status)) updates.status = 'Interested'
          activities.push({
            user_id: auth.workspaceUserId,
            contact_id: contact.id,
            type: 'email_click',
            content: `${email} ha cliccato la campagna Acumbamail ${campaignId}.`,
            metadata: {
              provider: 'acumbamail_api',
              provider_event: 'clicks',
              campaign_id: campaignId,
              count: click.count,
              last_at: click.lastAt,
            },
          })
          changed = true
          loggedActivities += 1
        } else if (click) {
          skippedDuplicates += 1
        }

        if (changed || responsible || listName || eventTag) {
          const { error } = await auth.supabase
            .from('contacts')
            .update(updates)
            .eq('user_id', auth.workspaceUserId)
            .eq('id', contact.id)

          if (error) throw error
          updatedContacts += 1
        }
      }
    }

    await createActivities(auth.supabase, activities)

    return Response.json({
      ok: true,
      campaign_id: campaignId,
      openers: openers.size,
      clickers: clickers.size,
      total_emails: allEmails.length,
      created_contacts: createdContacts,
      updated_contacts: updatedContacts,
      logged_activities: loggedActivities,
      skipped_duplicates: skippedDuplicates,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Sync Acumbamail non riuscita') }, { status: 500 })
  }
}
