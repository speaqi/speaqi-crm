import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

class BadRequestError extends Error {}

function parseDateParam(value: string | null, field: string) {
  if (!value) throw new BadRequestError(`Parametro ${field} obbligatorio`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`Parametro ${field} non valido`)
  return date.toISOString()
}

function isCallType(type: string) {
  return type === 'call'
}

function isEmailType(type: string) {
  return (
    type === 'email' ||
    type === 'email_sent' ||
    type === 'email_reply' ||
    type === 'email_open' ||
    type === 'email_click'
  )
}

function toDateKey(isoString: string) {
  return isoString.slice(0, 10)
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const start = parseDateParam(request.nextUrl.searchParams.get('start'), 'start')
    const end = parseDateParam(request.nextUrl.searchParams.get('end'), 'end')

    if (new Date(start).getTime() >= new Date(end).getTime()) {
      return Response.json({ error: 'Intervallo non valido' }, { status: 400 })
    }

    const { data: activities, error } = await auth.supabase
      .from('activities')
      .select(`
        id,
        contact_id,
        type,
        created_at,
        contact:contacts (
          id,
          responsible
        )
      `)
      .eq('user_id', auth.user.id)
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) throw error

    // Aggregate by responsible + date
    type AgentDateKey = string
    const buckets = new Map<AgentDateKey, {
      agent: string
      date: string
      calls: number
      emails: number
      other: number
      contactIds: Set<string>
    }>()

    const dailyTotals = new Map<string, {
      date: string
      calls: number
      emails: number
      other: number
      contactIds: Set<string>
    }>()

    for (const activity of activities ?? []) {
      const agent = (activity.contact as { responsible?: string | null } | null)?.responsible || 'Senza responsabile'
      const date = toDateKey(activity.created_at)
      const contactId = activity.contact_id

      // per-agent bucket
      const agentKey = `${agent}::${date}`
      if (!buckets.has(agentKey)) {
        buckets.set(agentKey, { agent, date, calls: 0, emails: 0, other: 0, contactIds: new Set() })
      }
      const bucket = buckets.get(agentKey)!
      bucket.contactIds.add(contactId)
      if (isCallType(activity.type)) bucket.calls++
      else if (isEmailType(activity.type)) bucket.emails++
      else bucket.other++

      // daily total bucket
      if (!dailyTotals.has(date)) {
        dailyTotals.set(date, { date, calls: 0, emails: 0, other: 0, contactIds: new Set() })
      }
      const dayBucket = dailyTotals.get(date)!
      dayBucket.contactIds.add(contactId)
      if (isCallType(activity.type)) dayBucket.calls++
      else if (isEmailType(activity.type)) dayBucket.emails++
      else dayBucket.other++
    }

    const byAgentDate = Array.from(buckets.values()).map(({ contactIds, ...rest }) => ({
      ...rest,
      contactsWorked: contactIds.size,
    }))

    const byDate = Array.from(dailyTotals.values()).map(({ contactIds, ...rest }) => ({
      ...rest,
      contactsWorked: contactIds.size,
    }))

    // Agent totals summary
    const agentTotals = new Map<string, {
      agent: string
      calls: number
      emails: number
      other: number
      contactIds: Set<string>
    }>()

    for (const row of byAgentDate) {
      if (!agentTotals.has(row.agent)) {
        agentTotals.set(row.agent, { agent: row.agent, calls: 0, emails: 0, other: 0, contactIds: new Set() })
      }
      const t = agentTotals.get(row.agent)!
      t.calls += row.calls
      t.emails += row.emails
      t.other += row.other
    }

    // Re-compute contacts from original activities per agent (for total uniqueness)
    const agentContactMap = new Map<string, Set<string>>()
    for (const activity of activities ?? []) {
      const agent = (activity.contact as { responsible?: string | null } | null)?.responsible || 'Senza responsabile'
      if (!agentContactMap.has(agent)) agentContactMap.set(agent, new Set())
      agentContactMap.get(agent)!.add(activity.contact_id)
    }

    const agentSummary = Array.from(agentTotals.values()).map(({ contactIds: _, ...rest }) => ({
      ...rest,
      contactsWorked: agentContactMap.get(rest.agent)?.size ?? 0,
    })).sort((a, b) => (b.calls + b.emails) - (a.calls + a.emails))

    return Response.json({
      byAgentDate,
      byDate: byDate.sort((a, b) => a.date.localeCompare(b.date)),
      agentSummary,
      totalActivities: activities?.length ?? 0,
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load analytics') },
      { status: error instanceof BadRequestError ? 400 : 500 }
    )
  }
}
