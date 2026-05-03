import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import {
  contactAssigneeMatchOrFilter,
  workspaceContactsAllFromRequest,
} from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import type { CRMContact, MarketingStatus } from '@/types'

type MarketingBucket =
  | 'prepare'
  | 'drafted'
  | 'ready'
  | 'followup'
  | 'blocked'
  | 'unsubscribed'

type MarketingQueueItem = {
  contact: CRMContact
  bucket: MarketingBucket
  effective_status: MarketingStatus
  reason: string
  score: number
  blocked_reason: string | null
  followup_due: boolean
  paused: boolean
}

function nowTime() {
  return Date.now()
}

function isPaused(contact: CRMContact, now = nowTime()) {
  if ((contact.marketing_status || 'not_ready') !== 'paused') return false
  if (!contact.marketing_paused_until) return true
  const pausedUntil = new Date(contact.marketing_paused_until).getTime()
  return Number.isNaN(pausedUntil) || pausedUntil > now
}

function isFollowupDue(contact: CRMContact, now = nowTime()) {
  if (!contact.next_followup_at) return false
  const due = new Date(contact.next_followup_at).getTime()
  return Number.isFinite(due) && due <= now
}

function deriveQueueItem(contact: CRMContact, now = nowTime()): MarketingQueueItem | null {
  if (contact.contact_scope === 'personal') return null

  const storedStatus = (contact.marketing_status || 'not_ready') as MarketingStatus
  const closed = isClosedStatus(contact.status)
  const unsubscribed = Boolean(contact.email_unsubscribed_at) || storedStatus === 'unsubscribed'
  const paused = isPaused(contact, now)
  const followupDue = isFollowupDue(contact, now)
  const hasEmail = Boolean(String(contact.email || '').trim())
  const hasEngagement = Boolean(
    Number(contact.email_open_count || 0) > 0 ||
      Number(contact.email_click_count || 0) > 0 ||
      contact.last_email_open_at ||
      contact.last_email_click_at
  )

  if (unsubscribed) {
    return {
      contact,
      bucket: 'unsubscribed',
      effective_status: 'unsubscribed',
      reason: 'Disiscritto: escluso da nuove bozze.',
      score: 0,
      blocked_reason: 'unsubscribe',
      followup_due: followupDue,
      paused,
    }
  }

  if (closed) return null

  if (paused) {
    return {
      contact,
      bucket: 'blocked',
      effective_status: 'paused',
      reason: contact.marketing_paused_until
        ? `In pausa fino al ${new Date(contact.marketing_paused_until).toLocaleDateString('it-IT')}.`
        : 'In pausa marketing.',
      score: 5,
      blocked_reason: 'paused',
      followup_due: followupDue,
      paused,
    }
  }

  if (!hasEmail) {
    return {
      contact,
      bucket: 'blocked',
      effective_status: storedStatus,
      reason: 'Email mancante: serve chiamata o ricerca indirizzo.',
      score: 10 + Number(contact.priority || 0) * 5,
      blocked_reason: 'missing_email',
      followup_due: followupDue,
      paused,
    }
  }

  if (storedStatus === 'draft_created') {
    return {
      contact,
      bucket: 'drafted',
      effective_status: storedStatus,
      reason: 'Bozza Gmail creata, da controllare.',
      score: 70 + Number(contact.priority || 0) * 10,
      blocked_reason: null,
      followup_due: followupDue,
      paused,
    }
  }

  if (storedStatus === 'ready_to_send') {
    return {
      contact,
      bucket: 'ready',
      effective_status: storedStatus,
      reason: 'Bozza pronta per invio manuale.',
      score: 90 + Number(contact.priority || 0) * 10,
      blocked_reason: null,
      followup_due: followupDue,
      paused,
    }
  }

  if (storedStatus === 'sent' || storedStatus === 'followup_due' || followupDue) {
    return {
      contact,
      bucket: 'followup',
      effective_status: followupDue ? 'followup_due' : storedStatus,
      reason: followupDue ? 'Follow-up scaduto o previsto ora.' : 'Email inviata: monitorare risposta/follow-up.',
      score: 80 + Number(contact.priority || 0) * 10 + (hasEngagement ? 15 : 0),
      blocked_reason: null,
      followup_due: followupDue,
      paused,
    }
  }

  const readyReason = contact.email_draft_note
    ? 'Nota bozza presente: pronta da trasformare in draft.'
    : hasEngagement
      ? 'Engagement email rilevato: priorità alta.'
      : 'Contatto aperto con email disponibile.'

  return {
    contact,
    bucket: 'prepare',
    effective_status: storedStatus === 'not_ready' ? 'ready_to_draft' : storedStatus,
    reason: readyReason,
    score:
      40 +
      Number(contact.priority || 0) * 10 +
      (contact.email_draft_note ? 15 : 0) +
      (hasEngagement ? 20 : 0) +
      (followupDue ? 25 : 0),
    blocked_reason: null,
    followup_due: followupDue,
    paused,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    let query = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .order('next_followup_at', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })

    const workspaceAll = workspaceContactsAllFromRequest(request, auth.isAdmin)
    if (auth.memberName && !workspaceAll) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      query = assigneeOr ? query.or(assigneeOr) : query.eq('responsible', '__no_member__')
    }

    const { data, error } = await query
    if (error) throw error

    const items = ((data || []) as CRMContact[])
      .map((contact) => deriveQueueItem(contact))
      .filter(Boolean) as MarketingQueueItem[]

    items.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const leftDue = left.contact.next_followup_at ? new Date(left.contact.next_followup_at).getTime() : Infinity
      const rightDue = right.contact.next_followup_at ? new Date(right.contact.next_followup_at).getTime() : Infinity
      return leftDue - rightDue
    })

    const counts = items.reduce<Record<MarketingBucket, number>>(
      (acc, item) => {
        acc[item.bucket] += 1
        return acc
      },
      { prepare: 0, drafted: 0, ready: 0, followup: 0, blocked: 0, unsubscribed: 0 }
    )

    return Response.json({ items, counts })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load marketing queue') }, { status: 500 })
  }
}
