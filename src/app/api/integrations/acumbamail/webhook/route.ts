import { NextRequest } from 'next/server'
import { normalizeLeadRecord, logLeadActivity } from '@/lib/server/ai-ready'
import { ensurePipelineStages } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

type AcumbamailEventName =
  | 'opens'
  | 'clicks'
  | 'unsubscribes'
  | 'delivered'
  | 'hard_bounces'
  | 'soft_bounces'
  | 'complaints'

type ContactRow = {
  id: string
  user_id: string
  name: string
  email?: string | null
  phone?: string | null
  status: string
  source?: string | null
  priority?: number | null
  category?: string | null
  company?: string | null
  country?: string | null
  language?: string | null
  score?: number | null
  assigned_agent?: string | null
  email_open_count?: number | null
  email_click_count?: number | null
  last_email_open_at?: string | null
  last_email_click_at?: string | null
  email_unsubscribed_at?: string | null
  email_unsubscribe_source?: string | null
  last_contact_at?: string | null
  next_action_at?: string | null
  next_followup_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type NormalizedWebhookEvent = {
  event: AcumbamailEventName
  email: string
  occurredAt: string
  raw: Record<string, unknown>
}

const HANDLED_EVENTS = new Set<AcumbamailEventName>([
  'opens',
  'clicks',
  'unsubscribes',
  'delivered',
  'hard_bounces',
  'soft_bounces',
  'complaints',
])

function unauthorized() {
  return Response.json({ error: 'Unauthorized webhook' }, { status: 401 })
}

function normalizeEmail(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized || null
}

function normalizeTimestamp(value: unknown) {
  if (value === null || value === undefined || value === '') return new Date().toISOString()

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value
    return new Date(millis).toISOString()
  }

  const text = String(value).trim()
  if (!text) return new Date().toISOString()

  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    if (Number.isFinite(numeric)) {
      const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
      return new Date(millis).toISOString()
    }
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

function extractRawEvents(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }

  if (!payload || typeof payload !== 'object') return []

  const objectPayload = payload as Record<string, unknown>
  const nested = objectPayload.events || objectPayload.data || objectPayload.batch
  if (Array.isArray(nested)) {
    return nested.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
  }

  if (objectPayload.event || objectPayload.type) {
    return [objectPayload]
  }

  return []
}

function normalizeWebhookEvent(raw: Record<string, unknown>): NormalizedWebhookEvent | null {
  const eventName = String(raw.event || raw.type || '')
    .trim()
    .toLowerCase() as AcumbamailEventName

  if (!HANDLED_EVENTS.has(eventName)) return null

  const subscriberFields =
    raw.subscriber_fields && typeof raw.subscriber_fields === 'object'
      ? (raw.subscriber_fields as Record<string, unknown>)
      : null

  const email = normalizeEmail(raw.email || subscriberFields?.email)
  if (!email) return null

  return {
    event: eventName,
    email,
    occurredAt: normalizeTimestamp(raw.timestamp || raw.occurred_at || raw.created_at),
    raw,
  }
}

function inferContactName(email: string) {
  const localPart = email.split('@')[0] || 'Lead'
  const words = localPart
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (!words.length) return email

  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function defaultNextActionAt() {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
}

function activityTypeForEvent(event: AcumbamailEventName) {
  switch (event) {
    case 'opens':
      return 'email_open'
    case 'clicks':
      return 'email_click'
    case 'unsubscribes':
      return 'unsubscribe'
    default:
      return 'note'
  }
}

function contentForEvent(event: NormalizedWebhookEvent) {
  switch (event.event) {
    case 'opens':
      return 'Email aperta rilevata da Acumbamail.'
    case 'clicks':
      return 'Click email rilevato da Acumbamail.'
    case 'unsubscribes':
      return 'Disiscrizione rilevata da Acumbamail.'
    case 'delivered':
      return 'Consegna email confermata da Acumbamail.'
    case 'hard_bounces':
      return 'Hard bounce rilevato da Acumbamail.'
    case 'soft_bounces':
      return 'Soft bounce rilevato da Acumbamail.'
    case 'complaints':
      return 'Reclamo email rilevato da Acumbamail.'
    default:
      return `Evento ${event.event} ricevuto da Acumbamail.`
  }
}

async function findContactsByEmail(supabase: any, email: string, userId?: string | null) {
  let query = supabase
    .from('contacts')
    .select('*')
    .ilike('email', email)
    .order('created_at', { ascending: false })

  if (userId) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query.limit(25)
  if (error) throw error
  return (data || []) as ContactRow[]
}

async function createContactFromWebhook(
  supabase: any,
  userId: string,
  event: NormalizedWebhookEvent
) {
  await ensurePipelineStages(supabase, userId)

  const shouldSuppressFollowup = event.event === 'unsubscribes'
  const nextActionAt = shouldSuppressFollowup ? null : defaultNextActionAt()
  const status = shouldSuppressFollowup ? 'Lost' : 'New'
  const summary = contentForEvent(event)

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      user_id: userId,
      name: inferContactName(event.email),
      email: event.email,
      status,
      source: 'acumbamail',
      priority: event.event === 'clicks' ? 3 : 2,
      note: `Creato automaticamente da webhook Acumbamail (${event.event}).`,
      last_activity_summary: summary,
      next_action_at: nextActionAt,
      next_followup_at: nextActionAt,
      email_open_count: 0,
      email_click_count: 0,
      last_email_open_at: null,
      last_email_click_at: null,
      email_unsubscribed_at: null,
      email_unsubscribe_source: null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as ContactRow
}

async function markPendingTasksDone(supabase: any, userId: string, contactId: string) {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')

  if (error) throw error
}

async function applyEventToContact(
  supabase: any,
  contact: ContactRow,
  event: NormalizedWebhookEvent
) {
  const activity = await logLeadActivity(supabase, contact.user_id, {
    leadId: contact.id,
    type: activityTypeForEvent(event.event),
    content: contentForEvent(event),
    metadata: {
      provider: 'acumbamail',
      provider_event: event.event,
      occurred_at: event.occurredAt,
      payload: event.raw,
    },
  })

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (event.event === 'opens') {
    updates.email_open_count = Math.max(0, Number(contact.email_open_count || 0)) + 1
    updates.last_email_open_at = event.occurredAt
  }

  if (event.event === 'clicks') {
    updates.email_click_count = Math.max(0, Number(contact.email_click_count || 0)) + 1
    updates.last_email_click_at = event.occurredAt
  }

  if (event.event === 'unsubscribes') {
    updates.email_unsubscribed_at = event.occurredAt
    updates.email_unsubscribe_source = 'acumbamail'
    updates.status = contact.status === 'Closed' ? contact.status : 'Lost'
    updates.next_action_at = null
    updates.next_followup_at = null
    await markPendingTasksDone(supabase, contact.user_id, contact.id)
  }

  const { data: updated, error } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', contact.id)
    .eq('user_id', contact.user_id)
    .select('*')
    .single()

  if (error) throw error

  return {
    activity,
    contact: normalizeLeadRecord(updated as ContactRow),
  }
}

function resolveScopedUserId(request: NextRequest, payload: unknown) {
  const bodyUserId =
    payload && typeof payload === 'object' && 'user_id' in payload ? String((payload as { user_id?: unknown }).user_id || '').trim() : ''
  return (
    request.nextUrl.searchParams.get('user_id') ||
    bodyUserId ||
    process.env.ACUMBAMAIL_WEBHOOK_USER_ID ||
    null
  )
}

function isAuthorizedWebhook(request: NextRequest) {
  const expectedToken = process.env.ACUMBAMAIL_WEBHOOK_TOKEN
  if (!expectedToken) return true

  const providedToken =
    request.nextUrl.searchParams.get('token') ||
    request.headers.get('x-webhook-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''

  return providedToken === expectedToken
}

export async function GET() {
  return Response.json({
    status: 'ok',
    route: '/api/integrations/acumbamail/webhook',
    accepted_events: Array.from(HANDLED_EVENTS),
    notes: [
      'Invia una POST JSON con uno o piu eventi Acumbamail.',
      'Per installazioni multi-account aggiungi ?user_id=<uuid> al callback URL.',
      'Puoi proteggere il webhook con ?token=... se imposti ACUMBAMAIL_WEBHOOK_TOKEN nel deploy.',
    ],
  })
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedWebhook(request)) {
    return unauthorized()
  }

  try {
    const payload = await request.json().catch(() => null)
    const events = extractRawEvents(payload).map(normalizeWebhookEvent).filter(Boolean) as NormalizedWebhookEvent[]

    if (!events.length) {
      return Response.json({ error: 'No supported Acumbamail events found in payload' }, { status: 400 })
    }

    const scopedUserId = resolveScopedUserId(request, payload)
    const supabase = createServiceRoleClient()

    let matchedContacts = 0
    let createdContacts = 0
    let skippedEvents = 0
    const processed: Array<{
      event: string
      email: string
      created_contact: boolean
      contact_ids: string[]
    }> = []

    for (const event of events) {
      let contacts = await findContactsByEmail(supabase, event.email, scopedUserId)
      let createdContact = false

      if (!contacts.length && scopedUserId && ['opens', 'clicks', 'unsubscribes'].includes(event.event)) {
        contacts = [await createContactFromWebhook(supabase, scopedUserId, event)]
        createdContact = true
        createdContacts += 1
      }

      if (!contacts.length) {
        skippedEvents += 1
        continue
      }

      matchedContacts += contacts.length

      const contactIds: string[] = []
      for (const contact of contacts) {
        const result = await applyEventToContact(supabase, contact, event)
        contactIds.push(result.contact.id)
      }

      processed.push({
        event: event.event,
        email: event.email,
        created_contact: createdContact,
        contact_ids: contactIds,
      })
    }

    return Response.json({
      ok: true,
      scoped_user_id: scopedUserId,
      received_events: events.length,
      processed_events: processed.length,
      matched_contacts: matchedContacts,
      created_contacts: createdContacts,
      skipped_events: skippedEvents,
      processed,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to process Acumbamail webhook') }, { status: 500 })
  }
}
