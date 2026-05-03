import { NextRequest } from 'next/server'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import type { MarketingStatus } from '@/types'

type RouteContext = {
  params: Promise<{ id: string }>
}

const MARKETING_STATUSES = new Set<MarketingStatus>([
  'not_ready',
  'ready_to_draft',
  'draft_created',
  'ready_to_send',
  'sent',
  'followup_due',
  'paused',
  'unsubscribed',
])

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeDateTime(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function isMissingOptionalMarketingColumn(error: unknown, column: 'marketing_status' | 'marketing_paused_until') {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function buildMarketingFallbackPayload(payload: Record<string, unknown>, error: unknown) {
  const fallback = { ...payload }
  let changed = false

  if (isMissingOptionalMarketingColumn(error, 'marketing_paused_until')) {
    delete fallback.marketing_paused_until
    changed = true
  }
  if (isMissingOptionalMarketingColumn(error, 'marketing_status')) {
    delete fallback.marketing_status
    delete fallback.marketing_paused_until
    changed = true
  }

  return changed ? fallback : null
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const updatePayload: Record<string, unknown> = {}

    if ('marketing_status' in body) {
      const status = normalizeText(body.marketing_status) as MarketingStatus | null
      if (!status || !MARKETING_STATUSES.has(status)) {
        return Response.json({ error: 'Stato marketing non valido' }, { status: 400 })
      }
      updatePayload.marketing_status = status
      if (status !== 'paused' && !('marketing_paused_until' in body)) {
        updatePayload.marketing_paused_until = null
      }
    }

    if ('marketing_paused_until' in body) {
      updatePayload.marketing_paused_until = normalizeDateTime(body.marketing_paused_until)
      if (updatePayload.marketing_paused_until) updatePayload.marketing_status = 'paused'
    }

    if ('email_draft_note' in body) {
      updatePayload.email_draft_note = normalizeText(body.email_draft_note)
    }

    if ('next_followup_at' in body) {
      const nextFollowupAt = normalizeDateTime(body.next_followup_at)
      updatePayload.next_followup_at = nextFollowupAt
      updatePayload.next_action_at = nextFollowupAt
      if (nextFollowupAt && !('marketing_status' in updatePayload)) {
        updatePayload.marketing_status = 'followup_due'
      }
    }

    if (!Object.keys(updatePayload).length) {
      return Response.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
    }

    const applyScope = (query: any) => {
      if (!auth.isAdmin) {
        if (!auth.memberName) return null
        const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
        return assigneeOr ? query.or(assigneeOr) : query.eq('responsible', '__no_member__')
      }
      return query
    }

    if (!auth.isAdmin) {
      if (!auth.memberName) {
        return Response.json({ error: 'Collaboratore non associato a un membro team' }, { status: 403 })
      }
    }

    const runUpdate = async (payload: Record<string, unknown>) => {
      const baseQuery = auth.supabase
        .from('contacts')
        .update(payload)
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)

      const scopedQuery = applyScope(baseQuery)
      if (!scopedQuery) return { data: null, error: { message: 'Collaboratore non associato a un membro team' } }
      return scopedQuery.select('*').single()
    }

    let { data, error } = await runUpdate(updatePayload)
    if (error) {
      const fallbackPayload = buildMarketingFallbackPayload(updatePayload, error)
      if (fallbackPayload && Object.keys(fallbackPayload).length) {
        const retry = await runUpdate(fallbackPayload)
        data = retry.data
        error = retry.error
      } else if (fallbackPayload) {
        const baseQuery = auth.supabase
          .from('contacts')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('id', id)
        const scopedQuery = applyScope(baseQuery)
        const retry = scopedQuery
          ? await scopedQuery.single()
          : { data: null, error: { message: 'Collaboratore non associato a un membro team' } }
        data = retry.data
        error = retry.error
      }
    }

    if (error) throw error

    return Response.json({ contact: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Marketing update fallito') }, { status: 500 })
  }
}
