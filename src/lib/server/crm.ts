import { DEFAULT_PIPELINE_STAGES, isClosedStatus, mapLegacyPriority, mapLegacyStatus } from '@/lib/data'
import { isCallTaskType } from '@/lib/schedule'
import type { PipelineStage } from '@/types'

function chunk<T>(items: T[], size = 100) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

function summarizeContent(content: string) {
  return content.trim().replace(/\s+/g, ' ').slice(0, 180)
}

export function formatActivityDate(value?: string | null) {
  if (!value) return 'non pianificato'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'non pianificato'
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sortStages<T extends { order?: number | null }>(stages: T[]) {
  return [...stages].sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
}

function isUniqueViolation(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code) === '23505'
}

async function readPipelineStages(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('user_id', userId)
    .order('order', { ascending: true })

  if (error) throw error
  return (data || []) as PipelineStage[]
}

async function shiftStageOrders(
  supabase: any,
  userId: string,
  stages: PipelineStage[],
  fromOrder: number
) {
  const toShift = [...stages]
    .filter((stage) => Number(stage.order ?? 0) >= fromOrder)
    .sort((left, right) => Number(right.order ?? 0) - Number(left.order ?? 0))

  for (const stage of toShift) {
    const nextOrder = Number(stage.order ?? 0) + 1
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ order: nextOrder })
      .eq('user_id', userId)
      .eq('id', stage.id)

    if (error) throw error
  }
}

function matchDefaultStage(stages: PipelineStage[], stage: Omit<PipelineStage, 'id'>) {
  return stages.find((item) => item.system_key === stage.system_key || item.name === stage.name)
}

async function syncDefaultStage(
  supabase: any,
  userId: string,
  existing: PipelineStage[],
  stage: Omit<PipelineStage, 'id'>
) {
  let currentStages = existing

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const match = matchDefaultStage(currentStages, stage)

    if (match) {
      const updatePayload: Record<string, unknown> = {}
      if (!match.system_key) updatePayload.system_key = stage.system_key
      if ((match.color || null) !== (stage.color || null)) updatePayload.color = stage.color

      if (Object.keys(updatePayload).length) {
        const { error } = await supabase
          .from('pipeline_stages')
          .update(updatePayload)
          .eq('user_id', userId)
          .eq('id', match.id)

        if (error && !isUniqueViolation(error)) throw error
      }

      return await readPipelineStages(supabase, userId)
    }

    try {
      await shiftStageOrders(supabase, userId, currentStages, stage.order)
      const { error } = await supabase
        .from('pipeline_stages')
        .insert({
          ...stage,
          user_id: userId,
        })

      if (error) throw error
      return await readPipelineStages(supabase, userId)
    } catch (error) {
      const reloaded = await readPipelineStages(supabase, userId)
      if (matchDefaultStage(reloaded, stage)) {
        currentStages = reloaded
        continue
      }

      if (!isUniqueViolation(error)) throw error
      currentStages = reloaded
    }
  }

  return await readPipelineStages(supabase, userId)
}

export async function ensurePipelineStages(
  supabase: any,
  userId: string
) {
  let existing: PipelineStage[] = await readPipelineStages(supabase, userId)
  if (!existing.length) {
    const { error: insertError } = await supabase
      .from('pipeline_stages')
      .insert(
        DEFAULT_PIPELINE_STAGES.map((stage) => ({
          ...stage,
          user_id: userId,
        }))
      )

    if (!insertError) {
      const inserted = await readPipelineStages(supabase, userId)
      return sortStages(inserted)
    }

    existing = await readPipelineStages(supabase, userId)
    if (!existing.length) throw insertError
  }

  for (const stage of DEFAULT_PIPELINE_STAGES) {
    existing = await syncDefaultStage(supabase, userId, existing, stage)
  }

  return sortStages(existing)
}

export async function getPendingTaskCount(
  supabase: any,
  userId: string,
  contactId: string
) {
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')

  if (error) throw error
  return count || 0
}

export async function readPendingCallTasks(
  supabase: any,
  userId: string,
  contactId: string
) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .in('type', ['follow-up', 'call'])
    .order('due_date', { ascending: true, nullsFirst: false })

  if (error) throw error
  return (data || []).filter((task: any) => isCallTaskType(task.type))
}

export async function syncPendingCallTask(
  supabase: any,
  userId: string,
  contactId: string,
  nextFollowupAt: string,
  options?: {
    type?: string
    note?: string | null
    overwriteNote?: boolean
  }
) {
  const pendingTasks = await readPendingCallTasks(supabase, userId, contactId)
  const matchingTask = pendingTasks.find((task: any) => task.due_date === nextFollowupAt)

  if (matchingTask) {
    if (options?.note && options.overwriteNote && matchingTask.note !== options.note) {
      const { data, error } = await supabase
        .from('tasks')
        .update({ note: options.note })
        .eq('user_id', userId)
        .eq('id', matchingTask.id)
        .select('*')
        .single()

      if (error) throw error
      return data
    }

    return matchingTask
  }

  const primaryTask = pendingTasks[0]
  if (primaryTask) {
    const updatePayload: Record<string, unknown> = {
      due_date: nextFollowupAt,
    }

    if (options?.type && isCallTaskType(options.type)) {
      updatePayload.type = options.type
    }

    if (options?.note && (options.overwriteNote || !primaryTask.note)) {
      updatePayload.note = options.note
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('user_id', userId)
      .eq('id', primaryTask.id)
      .select('*')
      .single()

    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      contact_id: contactId,
      type: options?.type && isCallTaskType(options.type) ? options.type : 'follow-up',
      due_date: nextFollowupAt,
      status: 'pending',
      note: options?.note || null,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function completePendingCallTasks(
  supabase: any,
  userId: string,
  contactId: string
) {
  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')
    .in('type', ['follow-up', 'call'])

  if (error) throw error
}

export async function syncContactNextFollowupFromPendingTasks(
  supabase: any,
  userId: string,
  contactId: string
) {
  const pendingTasks = await readPendingCallTasks(supabase, userId, contactId)
  const nextFollowupAt = pendingTasks[0]?.due_date || null

  const { error } = await supabase
    .from('contacts')
    .update({
      next_followup_at: nextFollowupAt,
    })
    .eq('user_id', userId)
    .eq('id', contactId)

  if (error) throw error
  return nextFollowupAt
}

export async function updateContactAfterActivity(
  supabase: any,
  contactId: string,
  content: string,
  nextFollowupAt?: string | null
) {
  const summary = summarizeContent(content)
  const payload: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
    last_activity_summary: summary,
    updated_at: new Date().toISOString(),
  }

  if (nextFollowupAt) {
    payload.next_followup_at = nextFollowupAt
  }

  const { error } = await supabase
    .from('contacts')
    .update(payload)
    .eq('id', contactId)

  if (error) throw error
}

export async function updateContactSummary(
  supabase: any,
  contactId: string,
  content: string,
  options?: {
    nextFollowupAt?: string | null
    touchLastContactAt?: boolean
  }
) {
  const summary = summarizeContent(content)
  if (!summary) return

  const payload: Record<string, unknown> = {
    last_activity_summary: summary,
    updated_at: new Date().toISOString(),
  }

  if (options?.nextFollowupAt !== undefined) {
    payload.next_followup_at = options.nextFollowupAt
  }

  if (options?.touchLastContactAt) {
    payload.last_contact_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('contacts')
    .update(payload)
    .eq('id', contactId)

  if (error) throw error
}

export async function createActivities(
  supabase: any,
  activities: Array<{
    user_id: string
    contact_id: string
    type: string
    content: string
  }>
) {
  const payload = activities
    .map((activity) => ({
      ...activity,
      content: activity.content.trim(),
    }))
    .filter((activity) => activity.content)

  if (!payload.length) return

  for (const batch of chunk(payload)) {
    const { error } = await supabase
      .from('activities')
      .insert(batch)

    if (error) throw error
  }
}

export async function ensureNextAction(
  supabase: any,
  userId: string,
  contactId: string,
  status: string,
  nextFollowupAt?: string | null
) {
  if (isClosedStatus(status)) return

  if (nextFollowupAt) return

  const pendingCount = await getPendingTaskCount(supabase, userId, contactId)
  if (pendingCount > 0) return

  throw new Error('Ogni contatto aperto deve avere un prossimo follow-up o un task pending')
}

export async function mapLegacyStateToRecords(userState: any, userId: string) {
  const cards = Array.isArray(userState?.cards) ? userState.cards : []
  const contacts = Array.isArray(userState?.contacts) ? userState.contacts : []
  const speaqi = Array.isArray(userState?.speaqi) ? userState.speaqi : []
  const callScheduled = userState?.call_scheduled || {}

  const legacyContacts = [
    ...cards.map((card: any) => ({
      user_id: userId,
      name: card.n || card.name || 'Lead legacy',
      email: '',
      phone: '',
      status: mapLegacyStatus(card.s || card.status),
      source: 'legacy-kanban',
      priority: mapLegacyPriority(card.p || card.priority),
      responsible: card.r || '',
      value: card.$ ? Number(card.$) : null,
      note: [card.note, card.id ? `Legacy ID: ${card.id}` : null].filter(Boolean).join('\n'),
      legacy_id: card._u || card.uid || card.id || null,
      last_activity_summary: card.note || null,
      next_followup_at: callScheduled[card._u || card.uid]
        ? new Date(`${callScheduled[card._u || card.uid]}T09:00:00`).toISOString()
        : card.d
          ? new Date(`${card.d}T09:00:00`).toISOString()
          : isClosedStatus(mapLegacyStatus(card.s || card.status))
            ? null
            : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    ...contacts.map((contact: any) => ({
      user_id: userId,
      name: contact.n || contact.name || 'Contatto legacy',
      email: contact.email || '',
      phone: contact.phone || '',
      status: contact.st === 'contattato' ? 'Contacted' : contact.st === 'referenziato' ? 'Interested' : 'New',
      source: 'import',
      priority: mapLegacyPriority(contact.p || contact.priority),
      responsible: '',
      value: null,
      note: [contact.ref, contact.role, contact.comune, contact.notes].filter(Boolean).join('\n'),
      legacy_id: contact._u || contact.uid || null,
      last_activity_summary: null,
      next_followup_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    ...speaqi.map((contact: any) => ({
      user_id: userId,
      name: contact.n || contact.name || 'Lead inbound legacy',
      email: contact.email || '',
      phone: '',
      status: contact.st === 'contattato' ? 'Contacted' : 'New',
      source: 'speaqi',
      priority: mapLegacyPriority(contact.p || contact.priority),
      responsible: '',
      value: null,
      note: [contact.role, contact.note].filter(Boolean).join('\n'),
      legacy_id: contact._u || contact.uid || null,
      last_activity_summary: null,
      next_followup_at: contact.st === 'contattato'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    })),
  ]

  return legacyContacts
}
