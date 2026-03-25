import { NextRequest } from 'next/server'
import { ensurePipelineStages, mapLegacyStateToRecords } from '@/lib/server/crm'
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
      .filter((contact: any) => contact.next_followup_at && contact.status !== 'Closed')
      .map((contact: any) => ({
        user_id: auth.user.id,
        contact_id: contact.id,
        type: 'follow-up',
        due_date: contact.next_followup_at,
        status: 'pending',
        note: `Task importato da stato legacy per ${contact.name}`,
      }))

    let migratedTasks = 0
    if (pendingTasks.length) {
      const { data: createdTasks, error: taskError } = await auth.supabase
        .from('tasks')
        .insert(pendingTasks)
        .select('id')

      if (taskError) throw taskError
      migratedTasks = createdTasks?.length || 0
    }

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
