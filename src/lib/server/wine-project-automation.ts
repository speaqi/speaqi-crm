import { createActivities } from '@/lib/server/crm'
import { toCallableSlot } from '@/lib/sla'

export type WineProjectAutomationSettings = {
  enabled: boolean
  campaign_name: string
  acumbamail_list_id: string | null
  acumbamail_campaign_id: string | null
  first_followup_days: number
  second_followup_days: number
  third_followup_days: number
}

export const DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS: WineProjectAutomationSettings = {
  enabled: true,
  campaign_name: 'Wine Project — Vinitaly',
  acumbamail_list_id: '1465520',
  acumbamail_campaign_id: null,
  first_followup_days: 1,
  second_followup_days: 5,
  third_followup_days: 12,
}

type WineContact = {
  id: string
  user_id: string
  name: string
  email?: string | null
  phone?: string | null
  status?: string | null
  email_unsubscribed_at?: string | null
}

function text(value: unknown, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function isMissingTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase()
  return message.includes('wine_project_') && (message.includes('schema cache') || message.includes('does not exist'))
}

export function normalizeWineProjectAutomationSettings(input: Partial<WineProjectAutomationSettings>) {
  const first = integer(input.first_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.first_followup_days, 1, 14)
  const secondCandidate = integer(input.second_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.second_followup_days, 2, 30)
  const second = Math.max(first + 1, secondCandidate)
  const thirdCandidate = integer(input.third_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.third_followup_days, 3, 60)
  const third = Math.max(second + 1, thirdCandidate)
  if (third > 60) throw new Error('Il terzo follow-up deve essere entro 60 giorni.')

  return {
    enabled: input.enabled !== false,
    campaign_name: text(input.campaign_name, 160) || DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.campaign_name,
    acumbamail_list_id: text(input.acumbamail_list_id, 80) || null,
    acumbamail_campaign_id: text(input.acumbamail_campaign_id, 80) || null,
    first_followup_days: first,
    second_followup_days: second,
    third_followup_days: third,
  } satisfies WineProjectAutomationSettings
}

export async function loadWineProjectAutomationSettings(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('wine_project_automation_settings')
    .select('enabled, campaign_name, acumbamail_list_id, acumbamail_campaign_id, first_followup_days, second_followup_days, third_followup_days')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) return DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS
    throw error
  }
  return normalizeWineProjectAutomationSettings(data || DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS)
}

export function wineFollowupDueAt(days: number, from = new Date()) {
  return toCallableSlot(new Date(from.getTime() + days * 24 * 60 * 60 * 1000)).toISOString()
}

export async function planWineProjectFollowups(
  supabase: any,
  contact: WineContact,
  settings: WineProjectAutomationSettings,
  from = new Date()
) {
  if (!settings.enabled) return { planned: 0, firstDueAt: null }

  const rows = [
    { sequence: 1, due_at: wineFollowupDueAt(settings.first_followup_days, from) },
    { sequence: 2, due_at: wineFollowupDueAt(settings.second_followup_days, from) },
    { sequence: 3, due_at: wineFollowupDueAt(settings.third_followup_days, from) },
  ].map((item) => ({ ...item, user_id: contact.user_id, contact_id: contact.id }))

  const { error } = await supabase
    .from('wine_project_followup_events')
    .upsert(rows, { onConflict: 'contact_id,sequence', ignoreDuplicates: true })
  if (error) {
    if (isMissingTable(error)) return { planned: 0, firstDueAt: rows[0].due_at }
    throw error
  }
  return { planned: rows.length, firstDueAt: rows[0].due_at }
}

export async function backfillWineProjectFollowups(supabase: any) {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, user_id, name, email, phone, status, email_unsubscribed_at')
    .eq('event_tag', 'wine-project')
    .is('email_unsubscribed_at', null)
    .not('status', 'in', '(Closed,Paid,Lost)')
    .limit(500)
  if (error) throw error

  const settingsByUser = new Map<string, WineProjectAutomationSettings>()
  let planned = 0
  for (const contact of contacts || []) {
    let settings = settingsByUser.get(contact.user_id)
    if (!settings) {
      settings = await loadWineProjectAutomationSettings(supabase, contact.user_id)
      settingsByUser.set(contact.user_id, settings)
    }
    const result = await planWineProjectFollowups(supabase, contact, settings)
    planned += result.planned
  }
  return { contacts: contacts?.length || 0, planned }
}

function stoppedReason(contact: WineContact, hasReply: boolean) {
  if (contact.email_unsubscribed_at) return 'disiscritto'
  if (['Closed', 'Paid', 'Lost'].includes(String(contact.status || ''))) return 'trattativa chiusa'
  if (hasReply) return 'risposta ricevuta'
  return null
}

function eventNote(contact: WineContact, sequence: number) {
  if (sequence === 1) return `Wine Project: contatta ${contact.name} dopo la richiesta della demo.`
  if (sequence === 2) return `Wine Project: prepara il secondo messaggio per ${contact.name}. Non inviare se è arrivata una risposta.`
  return `Wine Project: prepara l'ultimo messaggio per ${contact.name}. Non inviare se è arrivata una risposta.`
}

export async function queueDueWineProjectFollowups(supabase: any, userId?: string) {
  let eventsQuery = supabase
    .from('wine_project_followup_events')
    .select('id, user_id, contact_id, sequence, due_at, created_at, contacts!inner(id, user_id, name, email, phone, status, email_unsubscribed_at, event_tag)')
    .eq('status', 'scheduled')
    .lte('due_at', new Date().toISOString())
    .eq('contacts.event_tag', 'wine-project')
    .order('due_at', { ascending: true })
    .limit(100)
  if (userId) eventsQuery = eventsQuery.eq('user_id', userId)

  const { data: events, error } = await eventsQuery
  if (error) {
    if (isMissingTable(error)) return { queued: 0, skipped: 0 }
    throw error
  }

  let queued = 0
  let skipped = 0
  const settingsByUser = new Map<string, WineProjectAutomationSettings>()
  for (const event of events || []) {
    const contact = Array.isArray(event.contacts) ? event.contacts[0] : event.contacts
    if (!contact) continue
    let settings = settingsByUser.get(contact.user_id)
    if (!settings) {
      settings = await loadWineProjectAutomationSettings(supabase, contact.user_id)
      settingsByUser.set(contact.user_id, settings)
    }
    if (!settings.enabled) continue
    const { count, error: replyError } = await supabase
      .from('gmail_messages')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)
      .eq('direction', 'inbound')
      .gte('sent_at', event.created_at || '1970-01-01T00:00:00.000Z')
    if (replyError) throw replyError

    const reason = stoppedReason(contact, Boolean(count))
    if (reason) {
      const { error: skipError } = await supabase
        .from('wine_project_followup_events')
        .update({ status: 'skipped', skipped_at: new Date().toISOString(), skip_reason: reason })
        .eq('id', event.id)
        .eq('status', 'scheduled')
      if (skipError) throw skipError
      skipped += 1
      continue
    }

    const action = Number(event.sequence) === 1 ? 'call' : 'send_email'
    const { error: taskError } = await supabase.from('tasks').insert({
      user_id: contact.user_id,
      contact_id: contact.id,
      type: action === 'call' ? 'follow-up' : 'email',
      action,
      due_date: new Date().toISOString(),
      priority: Number(event.sequence) === 3 ? 'high' : 'medium',
      status: 'pending',
      note: eventNote(contact, Number(event.sequence)),
      idempotency_key: `wine-project:${contact.id}:${event.sequence}`,
    })
    if (taskError && !String(taskError.message || '').includes('duplicate')) throw taskError

    const now = new Date().toISOString()
    const { error: updateContactError } = await supabase
      .from('contacts')
      .update({ next_action_at: now, next_followup_at: now, updated_at: now })
      .eq('id', contact.id)
    if (updateContactError) throw updateContactError
    const { error: queueError } = await supabase
      .from('wine_project_followup_events')
      .update({ status: 'queued', queued_at: now })
      .eq('id', event.id)
      .eq('status', 'scheduled')
    if (queueError) throw queueError
    await createActivities(supabase, [{
      user_id: contact.user_id,
      contact_id: contact.id,
      type: 'wine_followup_queued',
      content: eventNote(contact, Number(event.sequence)),
      metadata: { sequence: Number(event.sequence), source: 'wine-project-automation' },
    }])
    queued += 1
  }

  return { queued, skipped }
}
