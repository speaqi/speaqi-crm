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

async function calendarApiRequest<T>(accessToken: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GCAL_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google Calendar API ${response.status}: ${text}`)
  }

  return response.json() as Promise<T>
}

export async function addTaskToCalendar(
  supabase: any,
  userId: string,
  event: CalendarEventInput
): Promise<CalendarEventResponse | null> {
  const account = await getGmailAccount(supabase, userId, { tolerateMissingRelation: true })
  if (!account) return null

  const scope = account.scope || ''
  if (!scope.includes('calendar')) return null

  const accessToken = await refreshAccessToken(account)

  const startDate = new Date(event.startAt)
  const endDate = new Date(startDate.getTime() + (event.durationMinutes ?? 30) * 60 * 1000)

  return calendarApiRequest<CalendarEventResponse>(
    accessToken,
    '/calendars/primary/events',
    {
      summary: event.summary,
      description: event.description || '',
      start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Rome' },
      end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Rome' },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }],
      },
    }
  )
}
