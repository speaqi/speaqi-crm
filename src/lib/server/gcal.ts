import { getGmailAccount, refreshAccessToken } from '@/lib/server/gmail'

const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3'

type CalendarEventInput = {
  summary: string
  description?: string
  startAt: string
  durationMinutes?: number
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

function calendarEventPayload(event: CalendarEventInput) {
  const startDate = new Date(event.startAt)
  const endDate = new Date(startDate.getTime() + (event.durationMinutes ?? 30) * 60 * 1000)

  return {
    summary: event.summary,
    description: event.description || '',
    start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Rome' },
    end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Rome' },
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
  event: CalendarEventInput
): Promise<CalendarEventResponse | null> {
  const accessToken = await getCalendarAccess(supabase, userId)
  if (!accessToken) return null
  return calendarApiRequest<CalendarEventResponse>(
    accessToken,
    `/calendars/primary/events/${encodeURIComponent(eventId)}`,
    'PATCH',
    calendarEventPayload(event)
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
