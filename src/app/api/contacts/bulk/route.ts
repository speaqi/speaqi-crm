import { NextRequest } from 'next/server'
import { isClosedStatus, normalizeContactScope } from '@/lib/data'
import { completePendingCallTasks, syncPendingCallTask } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined) return null
  return normalizeText(value)
}

function normalizeDateTime(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const contactIds = Array.isArray(body.contact_ids)
      ? body.contact_ids.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : []

    if (!contactIds.length) {
      return Response.json({ error: 'Nessun contatto selezionato' }, { status: 400 })
    }

    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {}
    const updatePayload: Record<string, unknown> = {}

    if ('responsible' in patch) updatePayload.responsible = normalizeText(patch.responsible)
    if ('status' in patch) updatePayload.status = normalizeNullableText(patch.status)
    if ('source' in patch) updatePayload.source = normalizeText(patch.source)
    if ('list_name' in patch) updatePayload.list_name = normalizeNullableText(patch.list_name)
    if ('event_tag' in patch) updatePayload.event_tag = normalizeNullableText(patch.event_tag)
    if ('company' in patch) updatePayload.company = normalizeText(patch.company)
    if ('next_followup_at' in patch) {
      const nextFollowupAt = normalizeDateTime(patch.next_followup_at)
      updatePayload.next_followup_at = nextFollowupAt
      updatePayload.next_action_at = nextFollowupAt
    }
    if ('contact_scope' in patch) {
      const nextScope = normalizeContactScope(
        typeof patch.contact_scope === 'string' ? patch.contact_scope : undefined
      )
      updatePayload.contact_scope = nextScope
      updatePayload.promoted_at = nextScope === 'crm' ? new Date().toISOString() : null
    }
    if ('priority' in patch) {
      const priority = normalizeNumber(patch.priority)
      if (priority !== null) {
        updatePayload.priority = Math.max(0, Math.min(3, priority))
      }
    }

    const nextStatus = 'status' in updatePayload ? String(updatePayload.status || '') : null
    const nextScope = 'contact_scope' in updatePayload ? String(updatePayload.contact_scope || 'crm') : null
    if ((nextStatus && isClosedStatus(nextStatus)) || nextScope === 'holding') {
      updatePayload.next_followup_at = null
      updatePayload.next_action_at = null
    }

    if (!Object.keys(updatePayload).length) {
      return Response.json({ error: 'Nessun campo da aggiornare' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('contacts')
      .update(updatePayload)
      .eq('user_id', auth.user.id)
      .in('id', contactIds)
      .select('*')

    if (error) throw error

    if (
      'status' in updatePayload ||
      'contact_scope' in updatePayload ||
      'next_followup_at' in updatePayload
    ) {
      await Promise.all(
        (data || []).map(async (contact) => {
          const nextScopeValue = (contact.contact_scope || 'crm') as string
          if (isClosedStatus(contact.status) || nextScopeValue === 'holding') {
            await completePendingCallTasks(auth.supabase, auth.user.id, contact.id)
            return
          }
          if (contact.next_followup_at) {
            await syncPendingCallTask(auth.supabase, auth.user.id, contact.id, contact.next_followup_at)
          }
        })
      )
    }

    return Response.json({ contacts: data || [], updated: (data || []).length })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Bulk update fallito') }, { status: 500 })
  }
}
