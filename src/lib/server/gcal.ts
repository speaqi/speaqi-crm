import { getGmailAccount, refreshAccessToken } from '@/lib/server/gmail'

const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

type CalendarEventInput = {
  summary: string
  description?: string
  startAt: string
  durationMinutes?: number
  /** Detto da chi crea l'evento; se manca si deduce dalla scadenza (`allDayOf`). */
  allDay?: boolean
}

type CalendarEventResponse = {
  id: string
  htmlLink: string
}

async function calendarApiRequest<T>(
  accessToken: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const response = await fetch(`${GCAL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google Calendar API ${response.status}: ${text}`)
  }

  if (response.status === 204) return null as T
  return response.json() as Promise<T>
}

async function getCalendarAccess(supabase: any, userId: string) {
  const account = await getGmailAccount(supabase, userId, { tolerateMissingRelation: true })
  if (!account || !(account.scope || '').includes('calendar')) return null
  return refreshAccessToken(account)
}

/**
 * Il giorno di un'attività senza ora: «2026-10-27» o la mezzanotte UTC con cui il CRM
 * salva le date scelte senza orario. Diventa un evento di tutta la giornata: prima
 * finiva alle 01:00 di notte, ora italiana, per mezz'ora.
 */
export function allDayOf(startAt: string): string | null {
  const value = String(startAt || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Solo un giorno che esiste: il 30 febbraio non si manda a Google.
    const day = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value ? value : null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 ? date.toISOString().slice(0, 10) : null
}

/**
 * Il corpo dell'evento. Con `patch` i campi dell'altra forma si azzerano, così un evento
 * passa da tutto il giorno a un orario (e viceversa) quando cambia la scadenza.
 */
export function calendarEventPayload(event: CalendarEventInput, options: { patch?: boolean } = {}) {
  // Chi sa se l'evento ha un orario lo dice: un'attività alle 01:00 d'inverno è la mezzanotte UTC.
  const day = event.allDay === false ? null
    : event.allDay === true ? (allDayOf(event.startAt) || new Date(event.startAt).toISOString().slice(0, 10))
    : allDayOf(event.startAt)
  const base = {
    summary: event.summary,
    description: event.description || '',
  }
  if (day) {
    const next = new Date(`${day}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const clear = options.patch ? { dateTime: null, timeZone: null } : {}
    return {
      ...base,
      start: { date: day, ...clear },
      end: { date: next.toISOString().slice(0, 10), ...clear },
      // Un promemoria il giorno prima alle 18: un popup a mezzanotte non lo vede nessuno.
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 6 * 60 }] },
    }
  }
  const startDate = new Date(event.startAt)
  const endDate = new Date(startDate.getTime() + (event.durationMinutes ?? 30) * 60 * 1000)
  const clear = options.patch ? { date: null } : {}
  return {
    ...base,
    start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Rome', ...clear },
    end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Rome', ...clear },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }],
    },
  }
}

export async function addTaskToCalendar(
  supabase: any,
  userId: string,
  event: CalendarEventInput
): Promise<CalendarEventResponse | null> {
  const accessToken = await getCalendarAccess(supabase, userId)
  if (!accessToken) return null

  return calendarApiRequest<CalendarEventResponse>(
    accessToken,
    '/calendars/primary/events',
    'POST',
    calendarEventPayload(event)
  )
}

export async function updateTaskCalendarEvent(
  supabase: any,
  userId: string,
  eventId: string,
  event: CalendarEventInput,
  options: { keepTiming?: boolean } = {}
): Promise<CalendarEventResponse | null> {
  const accessToken = await getCalendarAccess(supabase, userId)
  if (!accessToken) return null
  // Se la scadenza non è cambiata, orario e durata restano quelli dell'evento (anche se spostati in Calendar).
  const body = options.keepTiming
    ? { summary: event.summary, description: event.description || '' }
    : calendarEventPayload(event, { patch: true })
  return calendarApiRequest<CalendarEventResponse>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    'PATCH',
    body
  )
}

export async function removeTaskCalendarEvent(supabase: any, userId: string, eventId: string) {
  const accessToken = await getCalendarAccess(supabase, userId)
  if (!accessToken) return false
  await calendarApiRequest<null>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    'DELETE'
  )
  return true
}
