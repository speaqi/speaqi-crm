import { NextRequest } from 'next/server'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const DAY_MS = 24 * 60 * 60 * 1000

// Soglie "fermo da troppo" per fase (giorni)
const STUCK_THRESHOLD_DAYS: Record<string, number> = {
  supertop: 7,
  quote: 14,
}

function normalizeStatus(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function isProjectStatus(status?: string | null) {
  const s = normalizeStatus(status)
  return s === 'supertop' || s === 'quote' || s === 'preventivo'
}

function daysBetween(from?: string | null, to?: string | null) {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return (b - a) / DAY_MS
}

function average(values: number[]) {
  if (!values.length) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const now = Date.now()

    let wonQuery = auth.supabase
      .from('contacts')
      .select('id, created_at, won_at, status, responsible, assigned_agent')
      .eq('user_id', auth.workspaceUserId)
      .not('won_at', 'is', null)
      .limit(5000)

    let openQuery = auth.supabase
      .from('contacts')
      .select('id, status, stage_entered_at, responsible, assigned_agent')
      .eq('user_id', auth.workspaceUserId)
      .in('status', ['Supertop', 'Quote'])
      .limit(5000)

    if (!auth.isAdmin) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      if (assigneeOr) {
        wonQuery = wonQuery.or(assigneeOr)
        openQuery = openQuery.or(assigneeOr)
      } else {
        wonQuery = wonQuery.eq('responsible', '__no_member__')
        openQuery = openQuery.eq('responsible', '__no_member__')
      }
    }

    // stage_transitions: scopate da RLS al workspace/collaboratore
    const transitionsQuery = auth.supabase
      .from('stage_transitions')
      .select('contact_id, to_stage, changed_at')
      .eq('user_id', auth.workspaceUserId)
      .order('contact_id', { ascending: true })
      .order('changed_at', { ascending: true })
      .limit(20000)

    const [wonResult, openResult, transitionsResult] = await Promise.all([
      wonQuery,
      openQuery,
      transitionsQuery,
    ])

    if (wonResult.error) throw wonResult.error
    if (openResult.error) throw openResult.error

    // ── Tempo-di-chiusura (lead vinti) ──
    const closeDurations = (wonResult.data ?? [])
      .map((c: { created_at?: string | null; won_at?: string | null }) => daysBetween(c.created_at, c.won_at))
      .filter((d): d is number => d !== null)

    // ── Progetti fermi per fase ──
    let stuckSupertop = 0
    let stuckQuote = 0
    for (const c of openResult.data ?? []) {
      const status = normalizeStatus((c as { status?: string | null }).status)
      const enteredAt = (c as { stage_entered_at?: string | null }).stage_entered_at
      if (!enteredAt) continue
      const ageDays = (now - new Date(enteredAt).getTime()) / DAY_MS
      if (status === 'supertop' && ageDays > STUCK_THRESHOLD_DAYS.supertop) stuckSupertop++
      else if ((status === 'quote' || status === 'preventivo') && ageDays > STUCK_THRESHOLD_DAYS.quote) stuckQuote++
    }

    // ── Giorni medi per fase da stage_transitions ──
    // Tempo trascorso tra l'ingresso in una fase e la transizione successiva.
    const stageDurations = new Map<string, number[]>()
    const rows = (transitionsResult.error ? [] : transitionsResult.data ?? []) as Array<{
      contact_id: string
      to_stage: string | null
      changed_at: string
    }>
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const next = rows[i + 1]
      const stage = normalizeStatus(row.to_stage)
      if (!isProjectStatus(stage)) continue
      const sameContactNext = next && next.contact_id === row.contact_id ? next.changed_at : null
      const dur = daysBetween(row.changed_at, sameContactNext || new Date(now).toISOString())
      if (dur === null) continue
      const key = stage === 'preventivo' ? 'quote' : stage
      const list = stageDurations.get(key) || []
      list.push(dur)
      stageDurations.set(key, list)
    }

    return Response.json({
      closedWonCount: closeDurations.length,
      avgDaysToClose: average(closeDurations),
      medianDaysToClose: median(closeDurations),
      stuckSupertop,
      stuckQuote,
      avgDaysInStage: {
        supertop: average(stageDurations.get('supertop') || []),
        quote: average(stageDurations.get('quote') || []),
      },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load project analytics') }, { status: 500 })
  }
}
