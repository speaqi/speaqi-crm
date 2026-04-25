import { NextRequest } from 'next/server'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
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

function normalizeStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function isQuoteStatus(status?: string | null) {
  const normalized = normalizeStatus(status)
  return normalized === 'quote' || normalized === 'preventivo'
}

function isWonStatus(status?: string | null) {
  const normalized = normalizeStatus(status)
  return normalized === 'closed' || normalized === 'paid' || normalized === 'chiuso' || normalized === 'pagato'
}

function isPaidStatus(status?: string | null) {
  const normalized = normalizeStatus(status)
  return normalized === 'paid' || normalized === 'pagato'
}

function isLostStatus(status?: string | null) {
  const normalized = normalizeStatus(status)
  return normalized === 'lost' || normalized === 'not_interested' || normalized === 'perso' || normalized === 'non interessato'
}

function isOpenCommercialStatus(status?: string | null) {
  const normalized = normalizeStatus(status)
  return Boolean(normalized) && !isWonStatus(normalized) && !isLostStatus(normalized)
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
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

    let activitiesQuery = auth.supabase
        .from('activities')
      .select(`id, contact_id, type, created_at, contact:contacts (id, responsible)`)
      .eq('user_id', auth.workspaceUserId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
      .limit(2000)

    let contactsQuery = auth.supabase
      .from('contacts')
      .select('id, name, company, status, responsible, assigned_agent, value, contact_scope, created_at, updated_at')
      .eq('user_id', auth.workspaceUserId)
      .or('contact_scope.is.null,contact_scope.eq.crm')
      .limit(5000)

    if (!auth.isAdmin) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      if (assigneeOr) {
        contactsQuery = contactsQuery.or(assigneeOr)
      } else {
        contactsQuery = contactsQuery.eq('responsible', '__no_member__')
        activitiesQuery = activitiesQuery.eq('contact_id', '00000000-0000-0000-0000-000000000000')
      }
    }

    const [activitiesResult, teamResult, contactsResult] = await Promise.all([
      activitiesQuery,
      auth.supabase
        .from('team_members')
        .select('name')
        .eq('user_id', auth.workspaceUserId),
      contactsQuery,
    ])

    if (activitiesResult.error) throw activitiesResult.error
    if (contactsResult.error) throw contactsResult.error

    const activities = activitiesResult.data
    const validAgents = new Set((teamResult.data ?? []).map((m: { name: string }) => m.name))

    function resolveAgent(responsible: string | null | undefined): string {
      if (responsible && validAgents.has(responsible)) return responsible
      return 'Senza assegnazione'
    }

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
      const agent = resolveAgent((activity.contact as { responsible?: string | null } | null)?.responsible)
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
      const agent = resolveAgent((activity.contact as { responsible?: string | null } | null)?.responsible)
      if (!agentContactMap.has(agent)) agentContactMap.set(agent, new Set())
      agentContactMap.get(agent)!.add(activity.contact_id)
    }

    const agentSummary = Array.from(agentTotals.values()).map(({ contactIds: _, ...rest }) => ({
      ...rest,
      contactsWorked: agentContactMap.get(rest.agent)?.size ?? 0,
    })).sort((a, b) => (b.calls + b.emails) - (a.calls + a.emails))

    type CommercialAgentRow = {
      agent: string
      contacts: number
      quoteCount: number
      quoteValue: number
      wonCount: number
      revenue: number
      paidRevenue: number
      openPipelineValue: number
      lostCount: number
    }

    const commercialByAgent = new Map<string, CommercialAgentRow>()
    const commercialByStatus = new Map<string, { status: string; count: number; value: number }>()
    const contacts = contactsResult.data || []
    let quoteCount = 0
    let quoteValue = 0
    let wonCount = 0
    let revenue = 0
    let paidRevenue = 0
    let openPipelineValue = 0
    let lostCount = 0
    let valuedContacts = 0

    for (const contact of contacts) {
      const value = money(contact.value)
      const agent = resolveAgent(contact.responsible)
      const status = String(contact.status || 'Senza stato')

      if (!commercialByAgent.has(agent)) {
        commercialByAgent.set(agent, {
          agent,
          contacts: 0,
          quoteCount: 0,
          quoteValue: 0,
          wonCount: 0,
          revenue: 0,
          paidRevenue: 0,
          openPipelineValue: 0,
          lostCount: 0,
        })
      }

      if (!commercialByStatus.has(status)) {
        commercialByStatus.set(status, { status, count: 0, value: 0 })
      }

      const agentRow = commercialByAgent.get(agent)!
      const statusRow = commercialByStatus.get(status)!
      agentRow.contacts++
      statusRow.count++
      statusRow.value += value

      if (value > 0) valuedContacts++
      if (isQuoteStatus(contact.status)) {
        quoteCount++
        quoteValue += value
        agentRow.quoteCount++
        agentRow.quoteValue += value
      }
      if (isWonStatus(contact.status)) {
        wonCount++
        revenue += value
        agentRow.wonCount++
        agentRow.revenue += value
      }
      if (isPaidStatus(contact.status)) {
        paidRevenue += value
        agentRow.paidRevenue += value
      }
      if (isOpenCommercialStatus(contact.status)) {
        openPipelineValue += value
        agentRow.openPipelineValue += value
      }
      if (isLostStatus(contact.status)) {
        lostCount++
        agentRow.lostCount++
      }
    }

    const topDeals = contacts
      .filter((contact) => money(contact.value) > 0)
      .filter((contact) => isQuoteStatus(contact.status) || isWonStatus(contact.status))
      .sort((left, right) => money(right.value) - money(left.value))
      .slice(0, 8)
      .map((contact) => ({
        id: contact.id,
        name: contact.name || 'Contatto',
        company: contact.company || null,
        status: contact.status || null,
        responsible: contact.responsible || null,
        value: money(contact.value),
        updated_at: contact.updated_at,
      }))

    return Response.json({
      byAgentDate,
      byDate: byDate.sort((a, b) => a.date.localeCompare(b.date)),
      agentSummary,
      totalActivities: activities?.length ?? 0,
      commercial: {
        summary: {
          contacts: contacts.length,
          valuedContacts,
          quoteCount,
          quoteValue,
          wonCount,
          revenue,
          paidRevenue,
          openPipelineValue,
          lostCount,
          averageWonValue: wonCount ? revenue / wonCount : 0,
          winRate: quoteCount + wonCount + lostCount > 0 ? wonCount / (quoteCount + wonCount + lostCount) : 0,
        },
        byAgent: Array.from(commercialByAgent.values()).sort(
          (left, right) => right.revenue - left.revenue || right.quoteValue - left.quoteValue
        ),
        byStatus: Array.from(commercialByStatus.values()).sort((left, right) => right.value - left.value),
        topDeals,
      },
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load analytics') },
      { status: error instanceof BadRequestError ? 400 : 500 }
    )
  }
}
