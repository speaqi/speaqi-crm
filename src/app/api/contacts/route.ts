import { NextRequest } from 'next/server'
import { createActivities, ensurePipelineStages, formatActivityDate, updateContactSummary } from '@/lib/server/crm'
import { priorityLevelFromNumber } from '@/lib/server/ai-ready'
import {
  contactAssigneeMatchOrFilter,
  workspaceContactsAllFromRequest,
} from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'
import { isClosedStatus, normalizeContactScope } from '@/lib/data'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if ('message' in error && (error as { message?: unknown }).message) {
      return String((error as { message?: unknown }).message)
    }
    if ('details' in error && (error as { details?: unknown }).details) {
      return String((error as { details?: unknown }).details)
    }
    if ('hint' in error && (error as { hint?: unknown }).hint) {
      return String((error as { hint?: unknown }).hint)
    }
  }
  return fallback
}

function isMissingOptionalContactColumn(error: unknown, column: 'email_draft_note' | 'personal_section') {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function buildContactInsertFallbackPayload(payload: Record<string, unknown>, error: unknown) {
  const fallback = { ...payload }
  let changed = false

  if (isMissingOptionalContactColumn(error, 'email_draft_note')) {
    delete fallback.email_draft_note
    changed = true
  }
  if (isMissingOptionalContactColumn(error, 'personal_section')) {
    delete fallback.personal_section
    changed = true
  }

  return changed ? fallback : null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const scope = String(request.nextUrl.searchParams.get('scope') || 'all').trim().toLowerCase()

    let query = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .order('next_followup_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (scope === 'crm') query = query.eq('contact_scope', 'crm')
    if (scope === 'holding') query = query.eq('contact_scope', 'holding')
    if (scope === 'personal') query = query.eq('contact_scope', 'personal')

    const workspaceAll = workspaceContactsAllFromRequest(request, auth.isAdmin)
    // Solo collaboratori: filtro assegnatario. Admin: elenco completo (RLS); la dashboard filtra in client.
    if (!auth.isAdmin && auth.memberName && !workspaceAll) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      if (assigneeOr) query = query.or(assigneeOr)
      else query = query.eq('responsible', '__no_member__')
    }

    const { data, error } = await query

    if (error) throw error

    return Response.json({ contacts: data || [] })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load contacts') },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    await ensurePipelineStages(auth.supabase, auth.workspaceUserId)

    const body = await request.json()
    const requestedName = String(body.name || '').trim()
    const normalizedCompany = normalizeText(body.company)
    const name = requestedName || normalizedCompany || ''
    const status = String(body.status || 'New')
    const nextFollowupAt = normalizeText(body.next_followup_at)
    const contactScope = normalizeContactScope(body.contact_scope)
    const rawNote = normalizeText(body.note)
    const eventTag = normalizeText(body.event_tag)
    const listName = normalizeText(body.list_name)
    const personalSection = normalizeText(body.personal_section)
    const initialTaskNote = normalizeText(body.initial_task_note)

    if (!name) {
      return Response.json({ error: 'Inserisci almeno un referente o un nome organizzazione' }, { status: 400 })
    }

    if (contactScope === 'crm' && !isClosedStatus(status) && !nextFollowupAt) {
      return Response.json(
        { error: 'Ogni contatto aperto deve avere un prossimo follow-up' },
        { status: 400 }
      )
    }

    const emailDraftNote = normalizeText(body.email_draft_note)
    const insertPayload: Record<string, unknown> = {
      user_id: auth.workspaceUserId,
      name,
      email: normalizeText(body.email),
      phone: normalizeText(body.phone),
      category: normalizeText(body.category),
      company: normalizedCompany,
      event_tag: eventTag,
      list_name: listName,
      country: normalizeText(body.country),
      language: normalizeText(body.language),
      status,
      source: normalizeText(body.source) || 'manual',
      contact_scope: contactScope,
      priority: Math.max(0, Math.min(3, Number(body.priority || 0))),
      score: Math.max(0, Math.min(100, Number(body.score || 0))),
      assigned_agent: normalizeText(body.assigned_agent),
      responsible: normalizeText(body.responsible),
      value: normalizeNumber(body.value),
      note: rawNote,
      next_action_at: contactScope === 'holding' ? null : nextFollowupAt,
      next_followup_at: contactScope === 'holding' ? null : nextFollowupAt,
      last_activity_summary: rawNote,
    }

    if (!auth.isAdmin) {
      if (!auth.memberName) {
        return Response.json({ error: 'Collaboratore non associato a un membro team' }, { status: 403 })
      }
      insertPayload.responsible = auth.memberName
    }

    if (contactScope === 'personal' && personalSection) {
      insertPayload.personal_section = personalSection
    }
    if (emailDraftNote) {
      insertPayload.email_draft_note = emailDraftNote
    }

    let contact: any = null
    let insertError: unknown = null

    const firstInsert = await auth.supabase
      .from('contacts')
      .insert(insertPayload)
      .select('*')
      .single()

    if (!firstInsert.error) {
      contact = firstInsert.data
    } else {
      const fallbackPayload = buildContactInsertFallbackPayload(insertPayload, firstInsert.error)
      if (fallbackPayload) {
      const retryInsert = await auth.supabase
        .from('contacts')
        .insert(fallbackPayload)
        .select('*')
        .single()

      contact = retryInsert.data
      insertError = retryInsert.error
      } else {
        insertError = firstInsert.error
      }
    }

    if (insertError) throw insertError

    let task = null
    if (contact.contact_scope !== 'holding' && contact.next_followup_at) {
      const { data: createdTask, error: taskError } = await auth.supabase
        .from('tasks')
        .insert({
          user_id: auth.workspaceUserId,
          contact_id: contact.id,
          type: 'follow-up',
          action: 'call',
          due_date: contact.next_followup_at,
          priority: priorityLevelFromNumber(contact.priority),
          status: 'pending',
          note: initialTaskNote || `Follow-up iniziale per ${contact.name}`,
        })
        .select('*')
        .single()

      if (taskError) throw taskError
      task = createdTask
    }

    const activityContent = [
      contact.contact_scope === 'holding'
        ? 'Contatto creato in lista separata.'
        : contact.contact_scope === 'personal'
          ? 'Contatto creato in area personale.'
        : 'Contatto creato nel CRM.',
      `Stato iniziale: ${contact.status}.`,
      contact.company ? `Azienda: ${contact.company}.` : null,
      contact.event_tag ? `Evento: ${contact.event_tag}.` : null,
      contact.list_name ? `Lista import: ${contact.list_name}.` : null,
      contact.personal_section ? `Sezione personale: ${contact.personal_section}.` : null,
      contact.contact_scope === 'holding'
        ? 'Resterà fuori da pipeline e follow-up fino a una risposta email.'
        : contact.contact_scope === 'personal'
          ? 'Resta fuori dalla pipeline CRM ma può avere note e promemoria dedicati.'
        : null,
      contact.next_followup_at ? `Follow-up iniziale: ${formatActivityDate(contact.next_followup_at)}.` : null,
      task ? 'Task di follow-up creato automaticamente.' : null,
    ]
      .filter(Boolean)
      .join(' ')

    await createActivities(
      auth.supabase,
      [
        {
          user_id: auth.workspaceUserId,
          contact_id: contact.id,
          type: 'system',
          content: activityContent,
        },
        rawNote
          ? {
              user_id: auth.workspaceUserId,
              contact_id: contact.id,
              type: 'note',
              content: rawNote,
              metadata: {
                note_kind: 'field',
                capture_source: 'quick_capture',
                action_required: Boolean(contact.next_followup_at),
                linked_followup_label: initialTaskNote || `Follow-up iniziale per ${contact.name}`,
                linked_followup_priority: priorityLevelFromNumber(contact.priority),
              },
            }
          : null,
      ].filter(Boolean) as Array<{
        user_id: string
        contact_id: string
        type: string
        content: string
        metadata?: Record<string, unknown> | null
      }>
    )
    await updateContactSummary(auth.supabase, contact.id, activityContent, {
      nextFollowupAt: contact.next_followup_at,
    })

    return Response.json({ contact, task }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to create contact') },
      { status: 500 }
    )
  }
}
