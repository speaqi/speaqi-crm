import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { CLOSED_WINE_STATUSES } from '@/lib/server/wine-project-automation'
import {
  ID_SCAN_LIMIT,
  contactIdsWithActivity,
  contactIdsWithReply,
} from '@/lib/server/wine-project-engagement'

const ENGAGEMENTS = [
  'all',
  'opened',
  'clicked',
  'landing',
  'form',
  'demo',
  'interested',
  'replied',
  'unsubscribed',
  'excluded',
  'silent',
] as const
type Engagement = (typeof ENGAGEMENTS)[number]

/** Attività che raccontano cosa ha fatto la cantina, in ordine di percorso. */
const JOURNEY_ACTIVITY_TYPES = [
  'wine_followup_sent',
  'email_open',
  'email_click',
  'landing_clicked',
  'demo_form_submitted',
  'demo_ready',
  'reply_interested',
]

/** Le tre attività che di per sé identificano un gruppo di contatti. */
const ACTIVITY_FILTERS: Partial<Record<Engagement, string>> = {
  landing: 'landing_clicked',
  form: 'demo_form_submitted',
  demo: 'demo_ready',
  interested: 'reply_interested',
}

const CONTACT_COLUMNS =
  'id, name, company, email, status, email_open_count, email_click_count, last_email_open_at, last_email_click_at, last_contact_at, email_unsubscribed_at, email_unsubscribe_source'

type ContactRow = {
  id: string
  name: string | null
  company: string | null
  email: string | null
  status: string | null
  email_open_count: number | null
  email_click_count: number | null
  last_email_open_at: string | null
  last_email_click_at: string | null
  last_contact_at: string | null
  email_unsubscribed_at: string | null
  email_unsubscribe_source: string | null
}

type JourneyStep = { key: string; label: string; at: string; detail?: string | null }

function normalizedEmail(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

/** I contatti wine-project disiscritti o con la trattativa chiusa. */
async function contactIdsBlockedByContactRow(supabase: any, userId: string) {
  const ids: string[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('event_tag', 'wine-project')
      .or(`email_unsubscribed_at.not.is.null,status.in.(${CLOSED_WINE_STATUSES.join(',')})`)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    for (const row of data || []) ids.push(String(row.id))
    if (!data || data.length < 1000 || ids.length >= ID_SCAN_LIMIT) break
    from += 1000
  }
  return ids
}

async function fetchContactsByIds(supabase: any, userId: string, ids: string[]) {
  if (ids.length === 0) return [] as ContactRow[]
  const rows: ContactRow[] = []
  // Gli id viaggiano in query string: a lotti, come nel resto del Wine Project.
  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200)
    const { data, error } = await supabase
      .from('contacts')
      .select(CONTACT_COLUMNS)
      .eq('user_id', userId)
      .in('id', slice)
    if (error) throw error
    rows.push(...((data || []) as ContactRow[]))
  }
  const order = new Map(ids.map((id, position) => [id, position]))
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  const url = new URL(request.url)
  const requested = String(url.searchParams.get('engagement') || 'all')
  const engagement: Engagement = (ENGAGEMENTS as readonly string[]).includes(requested)
    ? (requested as Engagement)
    : 'all'
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))

  try {
    const supabase = auth.supabase
    const userId = auth.workspaceUserId
    let contacts: ContactRow[] = []
    let total = 0

    const activityType = ACTIVITY_FILTERS[engagement]
    if (activityType) {
      const ids = await contactIdsWithActivity(supabase, userId, activityType)
      total = ids.length
      contacts = await fetchContactsByIds(supabase, userId, ids.slice(0, limit))
    } else if (engagement === 'replied') {
      const ids = await contactIdsWithReply(supabase, userId)
      total = ids.length
      contacts = await fetchContactsByIds(supabase, userId, ids.slice(0, limit))
    } else if (engagement === 'excluded') {
      // Escluso = fuori dalla sequenza per un motivo, non «senza reazione»:
      // disiscritto, trattativa chiusa o già rispondente. Sono gli stessi tre
      // motivi che fermano l'invio in wineSequenceBlockReason.
      const [blocked, replied] = await Promise.all([
        contactIdsBlockedByContactRow(supabase, userId),
        contactIdsWithReply(supabase, userId),
      ])
      const merged: string[] = []
      const seen = new Set<string>()
      for (const id of [...replied, ...blocked]) {
        if (seen.has(id)) continue
        seen.add(id)
        merged.push(id)
      }
      total = merged.length
      contacts = await fetchContactsByIds(supabase, userId, merged.slice(0, limit))
    } else {
      let query = supabase
        .from('contacts')
        .select(CONTACT_COLUMNS, { count: 'exact' })
        .eq('user_id', userId)
        .eq('event_tag', 'wine-project')

      if (engagement === 'opened') query = query.gt('email_open_count', 0)
      if (engagement === 'clicked') query = query.gt('email_click_count', 0)
      if (engagement === 'unsubscribed') query = query.not('email_unsubscribed_at', 'is', null)
      if (engagement === 'silent') {
        // Nessuna reazione tracciata: la coda su cui insistere.
        query = query
          .or('email_open_count.is.null,email_open_count.eq.0')
          .or('email_click_count.is.null,email_click_count.eq.0')
      }

      const { data, error, count } = await query
        .order('email_click_count', { ascending: false, nullsFirst: false })
        .order('email_open_count', { ascending: false, nullsFirst: false })
        .order('last_contact_at', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (error) throw error
      contacts = (data || []) as ContactRow[]
      total = count || 0
    }

    const enriched = await enrichContacts(supabase, userId, contacts)
    return Response.json({ engagement, total, contacts: enriched })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le cantine') }, { status: 500 })
  }
}

/**
 * Aggiunge a ogni cantina la sua storia: quali email della sequenza sono
 * partite e quando, quando ha aperto, quando è arrivata sulla landing, se ha
 * compilato il form, se ha risposto, e perché è eventualmente uscita dal giro.
 * Senza le date la lista dice solo «ha cliccato»: non basta per decidere chi
 * chiamare oggi.
 */
async function enrichContacts(supabase: any, userId: string, contacts: ContactRow[]) {
  if (contacts.length === 0) return []
  const ids = contacts.map((contact) => contact.id)
  const emails = Array.from(
    new Set(contacts.map((contact) => normalizedEmail(contact.email)).filter(Boolean))
  )

  const activitiesByContact = new Map<string, { type: string; at: string; metadata: any }[]>()
  const eventsByContact = new Map<string, { sequence: number; status: string; due_at: string | null; sent_at: string | null; skip_reason: string | null }[]>()
  const replyByContact = new Map<string, string>()
  const replyByEmail = new Map<string, string>()

  for (let index = 0; index < ids.length; index += 200) {
    const slice = ids.slice(index, index + 200)
    const [{ data: activities, error: activitiesError }, { data: events, error: eventsError }, { data: replies, error: repliesError }] =
      await Promise.all([
        supabase
          .from('activities')
          .select('contact_id, type, created_at, metadata')
          .eq('user_id', userId)
          .in('contact_id', slice)
          .in('type', JOURNEY_ACTIVITY_TYPES)
          .order('created_at', { ascending: true }),
        supabase
          .from('wine_project_followup_events')
          .select('contact_id, sequence, status, due_at, sent_at, skip_reason')
          .eq('user_id', userId)
          .in('contact_id', slice),
        supabase
          .from('gmail_messages')
          .select('contact_id, from_email, sent_at, created_at')
          .eq('user_id', userId)
          .eq('direction', 'inbound')
          .in('contact_id', slice),
      ])
    if (activitiesError) throw activitiesError
    if (eventsError && !String(eventsError.message || '').includes('wine_project_')) throw eventsError
    if (repliesError) throw repliesError

    for (const row of activities || []) {
      const list = activitiesByContact.get(row.contact_id) || []
      list.push({ type: row.type, at: row.created_at, metadata: row.metadata })
      activitiesByContact.set(row.contact_id, list)
    }
    for (const row of events || []) {
      const list = eventsByContact.get(row.contact_id) || []
      list.push(row)
      eventsByContact.set(row.contact_id, list)
    }
    for (const row of replies || []) {
      const at = row.sent_at || row.created_at
      const current = replyByContact.get(row.contact_id)
      if (!current || at > current) replyByContact.set(row.contact_id, at)
    }
  }

  // La risposta si cerca anche sull'indirizzo, non solo sulla scheda: ogni
  // re-import della lista Acumbamail crea una scheda gemella e la risposta
  // resta attaccata alla vecchia (stessa regola di wineSequenceBlockReason).
  for (let index = 0; index < emails.length; index += 200) {
    const slice = emails.slice(index, index + 200)
    const { data, error } = await supabase
      .from('gmail_messages')
      .select('from_email, sent_at, created_at')
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .in('from_email', slice)
    if (error) throw error
    for (const row of data || []) {
      const email = normalizedEmail(row.from_email)
      if (!email) continue
      const at = row.sent_at || row.created_at
      const current = replyByEmail.get(email)
      if (!current || at > current) replyByEmail.set(email, at)
    }
  }

  return contacts.map((contact) => {
    const activities = activitiesByContact.get(contact.id) || []
    const events = (eventsByContact.get(contact.id) || []).slice().sort((a, b) => a.sequence - b.sequence)
    const email = normalizedEmail(contact.email)
    const replyAt = replyByContact.get(contact.id) || replyByEmail.get(email) || null

    const first = (type: string) => activities.find((activity) => activity.type === type) || null
    const last = (type: string) => [...activities].reverse().find((activity) => activity.type === type) || null

    const sent = events.filter((event) => event.status === 'sent' && event.sent_at)
    const lastSent = sent.length > 0 ? sent[sent.length - 1] : null
    const nextScheduled = events
      .filter((event) => event.status === 'scheduled' || event.status === 'queued')
      .sort((a, b) => String(a.due_at || '').localeCompare(String(b.due_at || '')))[0] || null
    const skipped = events.filter((event) => event.status === 'skipped' && event.skip_reason)
    const landing = first('landing_clicked')
    const form = first('demo_form_submitted')
    const demo = first('demo_ready')
    const interested = first('reply_interested')
    const firstOpen = first('email_open')

    const journey: JourneyStep[] = []
    for (const event of sent) {
      journey.push({
        key: `sent-${event.sequence}`,
        label: `Email ${event.sequence}/5 inviata`,
        at: String(event.sent_at),
      })
    }
    if (firstOpen) journey.push({ key: 'open-first', label: 'Prima apertura', at: firstOpen.at })
    if (contact.last_email_open_at && (!firstOpen || contact.last_email_open_at !== firstOpen.at)) {
      journey.push({
        key: 'open-last',
        label: `Ultima apertura${Number(contact.email_open_count || 0) > 1 ? ` (${contact.email_open_count} in tutto)` : ''}`,
        at: contact.last_email_open_at,
      })
    }
    const firstClick = first('email_click')
    if (firstClick) journey.push({ key: 'click-first', label: 'Primo click', at: firstClick.at })
    if (landing) {
      journey.push({ key: 'landing', label: 'Arrivata sulla landing della demo', at: landing.at })
    }
    if (contact.last_email_click_at && !landing && (!firstClick || contact.last_email_click_at !== firstClick.at)) {
      journey.push({ key: 'click-last', label: 'Ultimo click', at: contact.last_email_click_at })
    }
    if (form) {
      journey.push({
        key: 'form',
        label: 'Form compilato (sito, email, telefono)',
        at: form.at,
        detail: form.metadata?.submitted_email || null,
      })
    }
    if (demo) {
      journey.push({
        key: 'demo',
        label: 'Demo pronta',
        at: demo.at,
        detail: demo.metadata?.demo_project_url || null,
      })
    }
    if (replyAt) journey.push({ key: 'reply', label: 'Ha risposto via email', at: replyAt })
    if (interested) journey.push({ key: 'interested', label: 'Risposta classificata interessata', at: interested.at })
    if (contact.email_unsubscribed_at) {
      journey.push({
        key: 'unsubscribed',
        label: 'Si è disiscritta',
        at: contact.email_unsubscribed_at,
        detail: contact.email_unsubscribe_source,
      })
    }
    journey.sort((a, b) => String(a.at).localeCompare(String(b.at)))

    const excludedReason = contact.email_unsubscribed_at
      ? 'Disiscritta'
      : CLOSED_WINE_STATUSES.includes(String(contact.status || ''))
        ? `Trattativa chiusa (${contact.status})`
        : replyAt
          ? 'Ha già risposto'
          : skipped.length > 0
            ? `Sequenza fermata: ${skipped[skipped.length - 1].skip_reason}`
            : null

    return {
      ...contact,
      first_open_at: firstOpen?.at || null,
      last_open_at: contact.last_email_open_at || last('email_open')?.at || null,
      first_click_at: firstClick?.at || null,
      landing_at: landing?.at || null,
      form_at: form?.at || null,
      demo_at: demo?.at || null,
      demo_url: demo?.metadata?.demo_project_url || form?.metadata?.demo_project_url || null,
      interested_at: interested?.at || null,
      reply_at: replyAt,
      sent_count: sent.length,
      last_sequence: lastSent?.sequence ?? null,
      last_sent_at: lastSent?.sent_at ?? null,
      next_sequence: nextScheduled?.sequence ?? null,
      next_due_at: nextScheduled?.due_at ?? null,
      excluded_reason: excludedReason,
      journey,
    }
  })
}
