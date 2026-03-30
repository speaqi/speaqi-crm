import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { createActivities, ensurePipelineStages, formatActivityDate, updateContactSummary } from '@/lib/server/crm'

function unauthorized() {
  return Response.json({ error: 'Unauthorized webhook' }, { status: 401 })
}

export async function POST(request: NextRequest) {
  const secret = process.env.SPEAQI_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-webhook-secret') !== secret) {
    return unauthorized()
  }

  try {
    const body = await request.json()
    const userId = String(body.user_id || '').trim()

    if (!userId) {
      return Response.json({ error: 'user_id is required' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    await ensurePipelineStages(supabase, userId)

    const nextFollowupAt =
      body.next_followup_at ||
      new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

    const { data: contact, error } = await supabase
      .from('contacts')
      .insert({
        user_id: userId,
        name: String(body.name || '').trim(),
        email: body.email ? String(body.email).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        category: body.category ? String(body.category).trim() : null,
        status: 'New',
        source: body.source ? String(body.source).trim() : 'speaqi',
        priority: Math.max(0, Math.min(3, Number(body.priority || 2))),
        responsible: body.responsible ? String(body.responsible).trim() : null,
        note: body.note ? String(body.note).trim() : null,
        next_action_at: nextFollowupAt,
        next_followup_at: nextFollowupAt,
        last_activity_summary: 'Lead creato da integrazione inbound',
      })
      .select('*')
      .single()

    if (error) throw error

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        user_id: userId,
        contact_id: contact.id,
        type: 'follow-up',
        action: 'call',
        due_date: nextFollowupAt,
        priority: Number(contact.priority || 0) >= 3 ? 'high' : Number(contact.priority || 0) >= 2 ? 'medium' : 'low',
        status: 'pending',
        note: 'Primo contatto generato automaticamente dal canale inbound',
      })
      .select('*')
      .single()

    if (taskError) throw taskError

    const activities = [
      {
        user_id: userId,
        contact_id: contact.id,
        type: 'import',
        content: [
          'Lead creato da integrazione inbound.',
          contact.category ? `Categoria: ${contact.category}.` : null,
          `Follow-up iniziale: ${formatActivityDate(nextFollowupAt)}.`,
          'Task di follow-up creato automaticamente.',
        ].join(' '),
      },
      ...(body.note
        ? [
            {
              user_id: userId,
              contact_id: contact.id,
              type: 'note',
              content: String(body.note),
            },
          ]
        : []),
    ]

    await createActivities(supabase, activities)
    await updateContactSummary(supabase, contact.id, 'Lead creato da integrazione inbound')

    return Response.json({ contact, task }, { status: 201 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest Speaqi lead' },
      { status: 500 }
    )
  }
}
