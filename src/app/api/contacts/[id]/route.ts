import { NextRequest } from 'next/server'
import { isClosedStatus, normalizeContactScope } from '@/lib/data'
import {
  completePendingCallTasks,
  createActivities,
  ensureNextAction,
  formatActivityDate,
  syncPendingCallTask,
  updateContactSummary,
} from '@/lib/server/crm'
import { getGmailAccount, gmailStatus, isMissingRelation } from '@/lib/server/gmail'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

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
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

type OptionalContactColumn =
  | 'email_draft_note'
  | 'personal_section'
  | 'billing_tax_id'
  | 'billing_pec'
  | 'billing_sdi'
  | 'billing_address'
  | 'billing_zip'
  | 'billing_city'
  | 'lost_reason'
  | 'win_probability'
  | 'company_size'
  | 'industry'

const BILLING_CONTACT_COLUMNS: OptionalContactColumn[] = [
  'billing_tax_id',
  'billing_pec',
  'billing_sdi',
  'billing_address',
  'billing_zip',
  'billing_city',
]

function isMissingOptionalContactColumn(error: unknown, column: OptionalContactColumn) {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function hasBillingColumnSchemaError(error: unknown) {
  return BILLING_CONTACT_COLUMNS.some((column) => isMissingOptionalContactColumn(error, column))
}

function stripBillingColumns(payload: Record<string, unknown>) {
  const fallback = { ...payload }
  BILLING_CONTACT_COLUMNS.forEach((column) => {
    delete fallback[column]
  })
  return fallback
}

function buildContactUpdateFallbackPayload(payload: Record<string, unknown>, error: unknown) {
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
  if (hasBillingColumnSchemaError(error)) {
    return stripBillingColumns(fallback)
  }

  return changed ? fallback : null
}

function isNoRowsError(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    String((error as { code?: unknown }).code) === 'PGRST116'
  )
}

function displayValue(value: unknown) {
  const normalized = value === null || value === undefined ? '' : String(value).trim()
  return normalized || 'vuoto'
}

function formatBillingLocation(contact: any) {
  return [
    contact?.billing_address,
    [contact?.billing_zip, contact?.billing_city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
}

function buildContactUpdateSummary(current: any, next: any) {
  const changes: string[] = []

  if (current.name !== next.name) {
    changes.push(`nome ${displayValue(current.name)} -> ${displayValue(next.name)}`)
  }
  if (current.status !== next.status) {
    changes.push(`stato ${displayValue(current.status)} -> ${displayValue(next.status)}`)
  }
  if ((current.email || null) !== (next.email || null)) {
    changes.push(`email ${displayValue(current.email)} -> ${displayValue(next.email)}`)
  }
  if ((current.phone || null) !== (next.phone || null)) {
    changes.push(`telefono ${displayValue(current.phone)} -> ${displayValue(next.phone)}`)
  }
  if ((current.category || null) !== (next.category || null)) {
    changes.push(`categoria ${displayValue(current.category)} -> ${displayValue(next.category)}`)
  }
  if ((current.company || null) !== (next.company || null)) {
    changes.push('azienda aggiornata')
  }
  if ((current.event_tag || null) !== (next.event_tag || null)) {
    changes.push(`evento ${displayValue(current.event_tag)} -> ${displayValue(next.event_tag)}`)
  }
  if ((current.list_name || null) !== (next.list_name || null)) {
    changes.push(`lista ${displayValue(current.list_name)} -> ${displayValue(next.list_name)}`)
  }
  if ((current.country || null) !== (next.country || null)) {
    changes.push('paese aggiornato')
  }
  if ((current.language || null) !== (next.language || null)) {
    changes.push('lingua aggiornata')
  }
  if ((current.responsible || null) !== (next.responsible || null)) {
    changes.push(`responsabile ${displayValue(current.responsible)} -> ${displayValue(next.responsible)}`)
  }
  if ((current.assigned_agent || null) !== (next.assigned_agent || null)) {
    changes.push('assegnazione agente aggiornata')
  }
  if ((current.source || null) !== (next.source || null)) {
    changes.push(`origine ${displayValue(current.source)} -> ${displayValue(next.source)}`)
  }
  if ((current.contact_scope || 'crm') !== (next.contact_scope || 'crm')) {
    changes.push(
      (next.contact_scope || 'crm') === 'holding'
        ? 'spostato in lista separata'
        : (next.contact_scope || 'crm') === 'personal'
          ? 'spostato in area personale'
        : 'promosso nel CRM operativo'
    )
  }
  if ((current.personal_section || null) !== (next.personal_section || null)) {
    changes.push(`sezione personale ${displayValue(current.personal_section)} -> ${displayValue(next.personal_section)}`)
  }
  if (
    (current.billing_tax_id || null) !== (next.billing_tax_id || null) ||
    (current.billing_pec || null) !== (next.billing_pec || null) ||
    (current.billing_sdi || null) !== (next.billing_sdi || null)
  ) {
    changes.push('dati fatturazione aggiornati')
  }
  const currentBillingLocation = formatBillingLocation(current)
  const nextBillingLocation = formatBillingLocation(next)
  if (currentBillingLocation !== nextBillingLocation) {
    changes.push(`sede ${displayValue(currentBillingLocation)} -> ${displayValue(nextBillingLocation)}`)
  }
  if (Number(current.priority || 0) !== Number(next.priority || 0)) {
    changes.push(`priorità ${current.priority} -> ${next.priority}`)
  }
  if (Number(current.score || 0) !== Number(next.score || 0)) {
    changes.push(`score ${current.score || 0} -> ${next.score || 0}`)
  }
  if ((current.value ?? null) !== (next.value ?? null)) {
    changes.push(`valore ${displayValue(current.value)} -> ${displayValue(next.value)}`)
  }
  if ((current.note || null) !== (next.note || null)) {
    changes.push('note aggiornate')
  }
  if ((current.email_draft_note || null) !== (next.email_draft_note || null)) {
    changes.push('nota bozza email aggiornata')
  }
  if ((current.lost_reason || null) !== (next.lost_reason || null)) {
    changes.push('motivo perdita aggiornato')
  }
  if (Number(current.win_probability || 0) !== Number(next.win_probability || 0)) {
    changes.push(`probabilità chiusura ${current.win_probability || 0}% -> ${next.win_probability || 0}%`)
  }
  if ((current.company_size || null) !== (next.company_size || null)) {
    changes.push('dimensione azienda aggiornata')
  }
  if ((current.industry || null) !== (next.industry || null)) {
    changes.push(`settore ${displayValue(current.industry)} -> ${displayValue(next.industry)}`)
  }
  if ((current.next_followup_at || null) !== (next.next_followup_at || null)) {
    changes.push(`follow-up ${formatActivityDate(current.next_followup_at)} -> ${formatActivityDate(next.next_followup_at)}`)
  }

  if (!changes.length) return null
  return `Scheda aggiornata: ${changes.join('; ')}.`
}

async function getContactRecord(supabase: any, userId: string, id: string, responsible?: string | null) {
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)

  if (responsible) {
    const assigneeOr = contactAssigneeMatchOrFilter(responsible)
    if (assigneeOr) query = query.or(assigneeOr)
  }

  const { data, error } = await query.single()

  if (error) {
    if (isNoRowsError(error)) return null
    throw error
  }
  return data
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    const [
      { data: activities, error: activitiesError },
      { data: tasks, error: tasksError },
      emailsResult,
      gmailAccount,
    ] =
      await Promise.all([
        auth.supabase
          .from('activities')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('created_at', { ascending: false }),
        auth.supabase
          .from('tasks')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('due_date', { ascending: true, nullsFirst: false }),
        auth.supabase
          .from('gmail_messages')
          .select('*')
          .eq('user_id', auth.workspaceUserId)
          .eq('contact_id', id)
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(30),
        getGmailAccount(auth.supabase, auth.workspaceUserId, { tolerateMissingRelation: true }),
      ])

    if (activitiesError) throw activitiesError
    if (tasksError) throw tasksError

    if (emailsResult.error && !isMissingRelation(emailsResult.error)) {
      throw emailsResult.error
    }

    const emails = emailsResult.data || []

    return Response.json({
      contact,
      activities: activities || [],
      tasks: tasks || [],
      emails,
      gmail: gmailStatus(gmailAccount),
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load contact' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const current = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!current) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }
    const nextStatus = String(body.status || current.status)
    const nextContactScope = normalizeContactScope(body.contact_scope, current.contact_scope || 'crm')
    const requestedFollowupAt =
      body.next_followup_at === ''
        ? null
        : body.next_followup_at
          ? String(body.next_followup_at)
          : current.next_followup_at
    const nextFollowupAt =
      nextContactScope === 'holding' || isClosedStatus(nextStatus)
        ? null
        : requestedFollowupAt

    if (nextContactScope === 'crm') {
      await ensureNextAction(auth.supabase, auth.workspaceUserId, id, nextStatus, nextFollowupAt)
    }

    const normalizedCompany = body.company !== undefined ? normalizeText(body.company) : current.company
    const updatePayload: Record<string, unknown> = {
      name: body.name ? String(body.name).trim() : current.name,
      email: body.email !== undefined ? normalizeText(body.email) : current.email,
      phone: body.phone !== undefined ? normalizeText(body.phone) : current.phone,
      category: body.category !== undefined ? normalizeText(body.category) : current.category,
      company: normalizedCompany,
      billing_tax_id: body.billing_tax_id !== undefined ? normalizeText(body.billing_tax_id) : current.billing_tax_id,
      billing_pec: body.billing_pec !== undefined ? normalizeText(body.billing_pec) : current.billing_pec,
      billing_sdi: body.billing_sdi !== undefined ? normalizeText(body.billing_sdi) : current.billing_sdi,
      billing_address:
        body.billing_address !== undefined ? normalizeText(body.billing_address) : current.billing_address,
      billing_zip: body.billing_zip !== undefined ? normalizeText(body.billing_zip) : current.billing_zip,
      billing_city: body.billing_city !== undefined ? normalizeText(body.billing_city) : current.billing_city,
      event_tag: body.event_tag !== undefined ? normalizeText(body.event_tag) : current.event_tag,
      list_name: body.list_name !== undefined ? normalizeText(body.list_name) : current.list_name,
      country: body.country !== undefined ? normalizeText(body.country) : current.country,
      language: body.language !== undefined ? normalizeText(body.language) : current.language,
      status: nextStatus,
      source: body.source !== undefined ? normalizeText(body.source) : current.source,
      contact_scope: nextContactScope,
      promoted_at:
        (current.contact_scope || 'crm') !== 'crm' && nextContactScope === 'crm'
          ? new Date().toISOString()
          : current.promoted_at,
      priority:
        body.priority !== undefined
          ? Math.max(0, Math.min(3, Number(body.priority || 0)))
          : current.priority,
      score:
        body.score !== undefined
          ? Math.max(0, Math.min(100, Number(body.score || 0)))
          : current.score,
      assigned_agent:
        body.assigned_agent !== undefined ? normalizeText(body.assigned_agent) : current.assigned_agent,
      responsible:
        auth.isAdmin
          ? body.responsible !== undefined
            ? normalizeText(body.responsible)
            : current.responsible
          : current.responsible,
      value: body.value !== undefined ? normalizeNumber(body.value) : current.value,
      note: body.note !== undefined ? normalizeText(body.note) : current.note,
      email_draft_note:
        body.email_draft_note !== undefined ? normalizeText(body.email_draft_note) : current.email_draft_note,
      lost_reason:
        body.lost_reason !== undefined ? normalizeText(body.lost_reason) : current.lost_reason,
      win_probability:
        body.win_probability !== undefined ? normalizeNumber(body.win_probability) : current.win_probability,
      company_size:
        body.company_size !== undefined ? normalizeText(body.company_size) : current.company_size,
      industry:
        body.industry !== undefined ? normalizeText(body.industry) : current.industry,
      next_action_at: nextFollowupAt,
      next_followup_at: nextFollowupAt,
    }

    if (nextContactScope === 'personal') {
      updatePayload.personal_section =
        body.personal_section !== undefined
          ? normalizeText(body.personal_section)
          : current.personal_section
    }

    let data: any = null
    let updateError: unknown = null

    const firstUpdate = await auth.supabase
      .from('contacts')
      .update(updatePayload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .single()

    if (!firstUpdate.error) {
      data = firstUpdate.data
    } else {
      const fallbackPayload = buildContactUpdateFallbackPayload(updatePayload, firstUpdate.error)
      if (fallbackPayload) {
      const retryUpdate = await auth.supabase
        .from('contacts')
        .update(fallbackPayload)
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .select('*')
        .single()

      data = retryUpdate.data
      updateError = retryUpdate.error
      } else {
        updateError = firstUpdate.error
      }
    }

    if (updateError) throw updateError

    if (isClosedStatus(nextStatus)) {
      await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
    } else if (nextContactScope === 'holding') {
      await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
    } else if (nextFollowupAt) {
      await syncPendingCallTask(auth.supabase, auth.workspaceUserId, id, nextFollowupAt)
    }

    const activityContent = buildContactUpdateSummary(current, data)
    if (activityContent) {
      await createActivities(auth.supabase, [
        {
          user_id: auth.workspaceUserId,
          contact_id: id,
          type: 'system',
          content: activityContent,
        },
      ])
      await updateContactSummary(auth.supabase, id, activityContent, {
        nextFollowupAt: nextContactScope === 'holding' ? null : nextFollowupAt,
      })
    }

    return Response.json({ contact: data })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to update contact') },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContactRecord(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? null : auth.memberName || null
    )
    if (!contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    const { error } = await auth.supabase
      .from('contacts')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (error) throw error

    return Response.json({ success: true })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to delete contact' },
      { status: 500 }
    )
  }
}
