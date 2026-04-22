import { NextRequest } from 'next/server'
import { normalizeContactScope } from '@/lib/data'
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

    return Response.json({ contacts: data || [], updated: (data || []).length })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Bulk update fallito') }, { status: 500 })
  }
}
