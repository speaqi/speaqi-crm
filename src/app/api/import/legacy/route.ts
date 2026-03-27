import { NextRequest } from 'next/server'
import { createActivities, ensurePipelineStages, formatActivityDate, mapLegacyStateToRecords } from '@/lib/server/crm'
import { isClosedStatus } from '@/lib/data'
import { requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    await ensurePipelineStages(auth.supabase, auth.user.id)

    const { data: userState, error: stateError } = await auth.supabase
      .from('user_state')
      .select('*')
      .eq('user_id', auth.user.id)
      .single()

    if (stateError || !userState) {
      return Response.json({ migrated_contacts: 0, migrated_tasks: 0 })
    }

    const records = await mapLegacyStateToRecords(userState, auth.user.id)
    if (!records.length) {
      return Response.json({ migrated_contacts: 0, migrated_tasks: 0 })
    }

    const { data: existingLegacy, error: existingError } = await auth.supabase
      .from('contacts')
      .select('legacy_id')
      .eq('user_id', auth.user.id)
      .not('legacy_id', 'is', null)

    if (existingError) throw existingError

    const knownLegacyIds = new Set((existingLegacy || []).map((row: any) => row.legacy_id))
    const filtered = records.filter((record) => !record.legacy_id || !knownLegacyIds.has(record.legacy_id))

    if (!filtered.length) {
      return Response.json({ migrated_contacts: 0, migrated_tasks: 0 })
    }

    const { data: inserted, error } = await auth.supabase
      .from('contacts')
      .insert(filtered)
      .select('*')

    if (error) throw error

    const pendingTasks = (inserted || [])
      .filter((contact: any) => contact.next_followup_at && !isClosedStatus(contact.status))
      .map((contact: any) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'follow-up',
        due_date: contact.next_followup_at,
        status: 'pending',
        note: `Task importato da stato legacy per ${contact.name}`,
      }))

    let migratedTasks = 0
    const createdTaskContactIds = new Set<string>()
    if (pendingTasks.length) {
      const { data: createdTasks, error: taskError } = await auth.supabase
        .from('tasks')
        .insert(pendingTasks)
        .select('id, contact_id')

      if (taskError) throw taskError
      migratedTasks = createdTasks?.length || 0
      for (const task of createdTasks || []) {
        if (task.contact_id) createdTaskContactIds.add(task.contact_id)
      }
    }

    await createActivities(
      auth.supabase,
      (inserted || []).map((contact: any) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'import',
        content: [
          'Contatto creato da import legacy.',
          `Stato: ${contact.status}.`,
          contact.next_followup_at ? `Follow-up: ${formatActivityDate(contact.next_followup_at)}.` : null,
          createdTaskContactIds.has(contact.id) ? 'Task di follow-up creato automaticamente.' : null,
        ]
          .filter(Boolean)
          .join(' '),
      }))
    )

    return Response.json({
      migrated_contacts: inserted?.length || 0,
      migrated_tasks: migratedTasks,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to import legacy data' },
      { status: 500 }
    )
  }
}
