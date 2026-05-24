import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { completePendingCallTasks, syncPendingCallTask } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import {
  createLeadTask,
  normalizeTaskPriority,
  readLeadMemory,
  syncLeadActionDates,
  syncLeadScore,
  updateMemoryWithAI,
  upsertLeadMemory,
} from '@/lib/server/ai-ready'
import { requireRouteUser } from '@/lib/server/supabase'
import { isCallTaskType } from '@/lib/schedule'

type RouteContext = {
  params: Promise<{ id: string }>
}

function normalizeText(value: unknown) {
  return String(value || '').trim()
}

async function readAllowedContact(
  supabase: any,
  userId: string,
  contactId: string,
  memberName?: string | null
) {
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', contactId)

  if (memberName) {
    const assigneeOr = contactAssigneeMatchOrFilter(memberName)
    if (assigneeOr) query = query.or(assigneeOr)
  } else if (memberName === null) {
    query = query.eq('responsible', '__no_member__')
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data || null
}

async function completeTaskIfAllowed(
  supabase: any,
  userId: string,
  contactId: string,
  taskId?: string | null
) {
  if (!taskId) return null

  const { data: currentTask, error: currentTaskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('id', taskId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (currentTaskError) throw currentTaskError
  if (!currentTask) return null
  if (currentTask.status === 'done') return currentTask.id

  const { data, error } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('id', taskId)
    .eq('contact_id', contactId)
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const content = normalizeText(body.content)
    const status = normalizeText(body.status) || 'Contacted'
    const nextFollowupAt = body.next_followup_at ? normalizeText(body.next_followup_at) : null
    const taskType = normalizeText(body.task_type) || 'follow-up'
    const taskId = body.task_id ? normalizeText(body.task_id) : null
    const followupRequired = !isClosedStatus(status)

    if (!content) {
      return Response.json({ error: 'Inserisci l’esito della chiamata' }, { status: 400 })
    }

    if (followupRequired && !nextFollowupAt) {
      return Response.json({ error: 'Per un contatto aperto serve il prossimo follow-up' }, { status: 400 })
    }

    const contact = await readAllowedContact(
      auth.supabase,
      auth.workspaceUserId,
      id,
      auth.isAdmin ? undefined : auth.memberName || null
    )
    if (!contact) return Response.json({ error: 'Contatto non trovato o non assegnato a te' }, { status: 404 })

    const completedTaskId = await completeTaskIfAllowed(auth.supabase, auth.workspaceUserId, id, taskId)

    const { data: activity, error: activityError } = await auth.supabase
      .from('activities')
      .insert({
        user_id: auth.workspaceUserId,
        contact_id: id,
        type: 'call',
        content,
        metadata: {
          source: 'operating_center',
          task_id: completedTaskId,
          next_followup_at: followupRequired ? nextFollowupAt : null,
          task_type: taskType,
        },
      })
      .select('*')
      .single()

    if (activityError) throw activityError

    const { error: contactUpdateError } = await auth.supabase
      .from('contacts')
      .update({
        status,
        last_contact_at: new Date().toISOString(),
        last_activity_summary: content.slice(0, 180),
        next_followup_at: followupRequired ? nextFollowupAt : null,
        next_action_at: followupRequired ? nextFollowupAt : null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)

    if (contactUpdateError) throw contactUpdateError

    let nextTask = null
    if (isClosedStatus(status)) {
      await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
      await syncLeadActionDates(auth.supabase, auth.workspaceUserId, id)
    } else if (nextFollowupAt) {
      if (isCallTaskType(taskType)) {
        nextTask = await syncPendingCallTask(auth.supabase, auth.workspaceUserId, id, nextFollowupAt, {
          type: taskType,
          priority: normalizeTaskPriority(body.task_priority),
          note: `Follow-up dopo chiamata: ${content.slice(0, 120)}`,
          overwriteNote: true,
        })
      } else {
        nextTask = await createLeadTask(auth.supabase, auth.workspaceUserId, {
          leadId: id,
          action: taskType === 'email' ? 'send_email' : 'wait',
          type: taskType,
          dueAt: nextFollowupAt,
          priority: body.task_priority || 'medium',
          note: `Follow-up dopo chiamata: ${content.slice(0, 120)}`,
          idempotencyKey: `call-outcome:${id}:${nextFollowupAt}:${taskType}`,
        })
      }
      await syncLeadActionDates(auth.supabase, auth.workspaceUserId, id)
    }

    let memory = null
    let score: number | null = null

    if (body.ai_assist !== false) {
      try {
        const currentMemory = await readLeadMemory(auth.supabase, auth.workspaceUserId, id)
        const memoryUpdate = await updateMemoryWithAI(currentMemory?.summary, content)
        memory = await upsertLeadMemory(auth.supabase, auth.workspaceUserId, id, memoryUpdate)
      } catch {
        memory = null
      }

      try {
        score = await syncLeadScore(auth.supabase, auth.workspaceUserId, id)
      } catch {
        score = null
      }
    }

    const { data: updatedContact, error: refreshedContactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .single()

    if (refreshedContactError) throw refreshedContactError

    return Response.json({
      contact: updatedContact,
      activity,
      completed_task_id: completedTaskId,
      next_task: nextTask,
      memory,
      score: score ?? updatedContact.score ?? null,
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Impossibile salvare l’esito chiamata') },
      { status: 500 }
    )
  }
}
