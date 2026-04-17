import { NextRequest } from 'next/server'
import { createActivities, ensurePipelineStages, formatActivityDate, updateContactSummary } from '@/lib/server/crm'
import { priorityLevelFromNumber } from '@/lib/server/ai-ready'
import { requireRouteUser } from '@/lib/server/supabase'
import { isClosedStatus } from '@/lib/data'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeContactScope(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'holding' ? 'holding' : 'crm'
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    await ensurePipelineStages(auth.supabase, auth.user.id)
    const scope = String(request.nextUrl.searchParams.get('scope') || 'all').trim().toLowerCase()

    let query = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('next_followup_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (scope === 'crm') query = query.eq('contact_scope', 'crm')
    if (scope === 'holding') query = query.eq('contact_scope', 'holding')

    const { data, error } = await query

    if (error) throw error

    return Response.json({ contacts: data || [] })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load contacts' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    await ensurePipelineStages(auth.supabase, auth.user.id)

    const body = await request.json()
    const name = String(body.name || '').trim()
    const status = String(body.status || 'New')
    const nextFollowupAt = normalizeText(body.next_followup_at)
    const contactScope = normalizeContactScope(body.contact_scope)
    const rawNote = normalizeText(body.note)
    const eventTag = normalizeText(body.event_tag)
    const initialTaskNote = normalizeText(body.initial_task_note)

    if (!name) {
      return Response.json({ error: 'Il nome del contatto è obbligatorio' }, { status: 400 })
    }

    if (contactScope === 'crm' && !isClosedStatus(status) && !nextFollowupAt) {
      return Response.json(
        { error: 'Ogni contatto aperto deve avere un prossimo follow-up' },
        { status: 400 }
      )
    }

    const insertPayload = {
      user_id: auth.user.id,
      name,
      email: normalizeText(body.email),
      phone: normalizeText(body.phone),
      category: normalizeText(body.category),
      company: normalizeText(body.company),
      event_tag: eventTag,
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

    const { data: contact, error } = await auth.supabase
      .from('contacts')
      .insert(insertPayload)
      .select('*')
      .single()

    if (error) throw error

    let task = null
    if (contact.contact_scope !== 'holding' && contact.next_followup_at) {
      const { data: createdTask, error: taskError } = await auth.supabase
        .from('tasks')
        .insert({
          user_id: auth.user.id,
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
        : 'Contatto creato nel CRM.',
      `Stato iniziale: ${contact.status}.`,
      contact.company ? `Azienda: ${contact.company}.` : null,
      contact.event_tag ? `Evento: ${contact.event_tag}.` : null,
      contact.contact_scope === 'holding'
        ? 'Resterà fuori da pipeline e follow-up fino a una risposta email.'
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
          user_id: auth.user.id,
          contact_id: contact.id,
          type: 'system',
          content: activityContent,
        },
        rawNote
          ? {
              user_id: auth.user.id,
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
      { error: error instanceof Error ? error.message : 'Failed to create contact' },
      { status: 500 }
    )
  }
}
