import { isClosedStatus } from '@/lib/data'
import { createLeadTask, logLeadActivity, normalizeTaskPriority } from '@/lib/server/ai-ready'
import type {
  FollowupSequence,
  SequenceInput,
  SequenceStep,
  SequenceStepAction,
  SequenceStepInput,
} from '@/types'

const STEP_ACTIONS: SequenceStepAction[] = ['send_email', 'call', 'wait', 'whatsapp']

function nowIso() {
  return new Date().toISOString()
}

function normalizeStepAction(action?: string | null): SequenceStepAction {
  const normalized = String(action || '').trim().toLowerCase()
  return (STEP_ACTIONS as string[]).includes(normalized) ? (normalized as SequenceStepAction) : 'wait'
}

function actionLabel(action: SequenceStepAction) {
  switch (action) {
    case 'send_email':
      return 'Email'
    case 'call':
      return 'Chiamata'
    case 'whatsapp':
      return 'WhatsApp'
    default:
      return 'Attesa'
  }
}

/** Mappa l'azione della cadenza sui campi del task esistente. WhatsApp resta un task manuale finché non c'è l'integrazione. */
function taskFieldsForStep(action: SequenceStepAction): { action: 'send_email' | 'call' | 'wait'; type: string } {
  if (action === 'send_email') return { action: 'send_email', type: 'email' }
  if (action === 'call') return { action: 'call', type: 'call' }
  if (action === 'whatsapp') return { action: 'wait', type: 'follow-up' }
  return { action: 'wait', type: 'follow-up' }
}

function addHoursIso(baseIso: string, hours: number) {
  return new Date(new Date(baseIso).getTime() + Math.max(0, hours) * 60 * 60 * 1000).toISOString()
}

function sortSteps(steps: SequenceStep[]) {
  return [...steps].sort((a, b) => a.step_index - b.step_index)
}

/** next_run_at per lo step `index`, calcolato dall'inizio dell'iscrizione. null se l'indice supera gli step. */
function nextRunForStep(startedAtIso: string, steps: SequenceStep[], index: number): string | null {
  const ordered = sortSteps(steps)
  if (index < 0 || index >= ordered.length) return null
  return addHoursIso(startedAtIso, ordered[index].offset_hours)
}

function normalizeSteps(steps: SequenceStepInput[] | undefined): SequenceStepInput[] {
  return (steps || [])
    .map((step) => ({
      action: normalizeStepAction(step.action),
      offset_hours: Math.max(0, Math.round(Number(step.offset_hours) || 0)),
      title: step.title?.trim() || null,
      priority: normalizeTaskPriority(step.priority),
    }))
    .sort((a, b) => a.offset_hours - b.offset_hours)
}

async function attachStepsAndCounts(
  supabase: any,
  userId: string,
  sequences: any[]
): Promise<FollowupSequence[]> {
  if (!sequences.length) return []
  const ids = sequences.map((s) => s.id)

  const [{ data: steps }, { data: enrollments }] = await Promise.all([
    supabase
      .from('sequence_steps')
      .select('*')
      .eq('user_id', userId)
      .in('sequence_id', ids)
      .order('step_index', { ascending: true }),
    supabase
      .from('sequence_enrollments')
      .select('sequence_id, status')
      .eq('user_id', userId)
      .in('sequence_id', ids)
      .eq('status', 'active'),
  ])

  const stepsBySeq = new Map<string, SequenceStep[]>()
  for (const step of steps || []) {
    const list = stepsBySeq.get(step.sequence_id) || []
    list.push(step as SequenceStep)
    stepsBySeq.set(step.sequence_id, list)
  }

  const activeBySeq = new Map<string, number>()
  for (const row of enrollments || []) {
    activeBySeq.set(row.sequence_id, (activeBySeq.get(row.sequence_id) || 0) + 1)
  }

  return sequences.map((seq) => ({
    ...seq,
    steps: sortSteps(stepsBySeq.get(seq.id) || []),
    active_enrollments: activeBySeq.get(seq.id) || 0,
  })) as FollowupSequence[]
}

export async function listSequences(supabase: any, userId: string): Promise<FollowupSequence[]> {
  const { data, error } = await supabase
    .from('followup_sequences')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })

  if (error) throw error
  return attachStepsAndCounts(supabase, userId, data || [])
}

export async function getSequence(supabase: any, userId: string, id: string): Promise<FollowupSequence | null> {
  const { data, error } = await supabase
    .from('followup_sequences')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const [withSteps] = await attachStepsAndCounts(supabase, userId, [data])
  return withSteps
}

export async function createSequence(supabase: any, userId: string, input: SequenceInput): Promise<FollowupSequence> {
  const name = String(input.name || '').trim()
  if (!name) throw new Error('Il nome della sequenza è obbligatorio')

  const steps = normalizeSteps(input.steps)
  if (!steps.length) throw new Error('La sequenza deve avere almeno uno step')

  const { data: sequence, error } = await supabase
    .from('followup_sequences')
    .insert({
      user_id: userId,
      name,
      description: input.description?.trim() || null,
      status: input.status || 'active',
      trigger_event: input.trigger_event === 'email_sent' ? 'email_sent' : 'manual',
      stop_on_reply: input.stop_on_reply !== false,
    })
    .select('*')
    .single()

  if (error) throw error

  const stepRows = steps.map((step, index) => ({
    user_id: userId,
    sequence_id: sequence.id,
    step_index: index,
    action: step.action,
    offset_hours: step.offset_hours,
    title: step.title,
    priority: step.priority,
  }))

  const { error: stepError } = await supabase.from('sequence_steps').insert(stepRows)
  if (stepError) throw stepError

  const result = await getSequence(supabase, userId, sequence.id)
  if (!result) throw new Error('Sequenza non trovata dopo la creazione')
  return result
}

export async function updateSequence(
  supabase: any,
  userId: string,
  id: string,
  patch: Partial<SequenceInput>
): Promise<FollowupSequence> {
  const updates: Record<string, unknown> = {}
  if (typeof patch.name === 'string') updates.name = patch.name.trim()
  if (typeof patch.description !== 'undefined') updates.description = patch.description?.trim() || null
  if (patch.status) updates.status = patch.status
  if (patch.trigger_event) updates.trigger_event = patch.trigger_event === 'email_sent' ? 'email_sent' : 'manual'
  if (typeof patch.stop_on_reply === 'boolean') updates.stop_on_reply = patch.stop_on_reply

  if (Object.keys(updates).length) {
    const { error } = await supabase
      .from('followup_sequences')
      .update(updates)
      .eq('user_id', userId)
      .eq('id', id)
    if (error) throw error
  }

  // Sostituzione completa degli step quando forniti.
  if (Array.isArray(patch.steps)) {
    const steps = normalizeSteps(patch.steps)
    if (!steps.length) throw new Error('La sequenza deve avere almeno uno step')

    const { error: deleteError } = await supabase
      .from('sequence_steps')
      .delete()
      .eq('user_id', userId)
      .eq('sequence_id', id)
    if (deleteError) throw deleteError

    const stepRows = steps.map((step, index) => ({
      user_id: userId,
      sequence_id: id,
      step_index: index,
      action: step.action,
      offset_hours: step.offset_hours,
      title: step.title,
      priority: step.priority,
    }))
    const { error: insertError } = await supabase.from('sequence_steps').insert(stepRows)
    if (insertError) throw insertError
  }

  const result = await getSequence(supabase, userId, id)
  if (!result) throw new Error('Sequenza non trovata')
  return result
}

export async function deleteSequence(supabase: any, userId: string, id: string) {
  // Archivia invece di cancellare per preservare lo storico delle iscrizioni.
  const { error } = await supabase
    .from('followup_sequences')
    .update({ status: 'archived' })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw error
}

/** Iscrive (o re-iscrive) un contatto a una cadenza. Idempotente sulla coppia (sequence, contact). */
export async function enrollContact(supabase: any, userId: string, sequenceId: string, contactId: string) {
  const sequence = await getSequence(supabase, userId, sequenceId)
  if (!sequence) throw new Error('Sequenza non trovata')
  if (!sequence.steps.length) throw new Error('La sequenza non ha step da eseguire')

  const startedAt = nowIso()
  const nextRunAt = nextRunForStep(startedAt, sequence.steps, 0)

  const { data, error } = await supabase
    .from('sequence_enrollments')
    .upsert(
      {
        user_id: userId,
        sequence_id: sequenceId,
        contact_id: contactId,
        status: 'active',
        current_step: 0,
        next_run_at: nextRunAt,
        started_at: startedAt,
        completed_at: null,
        stopped_at: null,
        stop_reason: null,
      },
      { onConflict: 'sequence_id,contact_id' }
    )
    .select('*')
    .single()

  if (error) throw error
  return data
}

/** Auto-iscrizione (una sola volta per contatto/sequenza) per le cadenze con un certo trigger. */
export async function enrollContactsForTrigger(
  supabase: any,
  userId: string,
  contactId: string,
  trigger: 'email_sent'
) {
  const { data: sequences, error } = await supabase
    .from('followup_sequences')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('trigger_event', trigger)

  if (error || !sequences?.length) return 0

  const sequenceIds = sequences.map((s: any) => s.id)
  const { data: existing } = await supabase
    .from('sequence_enrollments')
    .select('sequence_id')
    .eq('contact_id', contactId)
    .in('sequence_id', sequenceIds)

  const alreadyEnrolled = new Set((existing || []).map((row: any) => row.sequence_id))

  let enrolled = 0
  for (const sequenceId of sequenceIds) {
    if (alreadyEnrolled.has(sequenceId)) continue
    try {
      await enrollContact(supabase, userId, sequenceId, contactId)
      enrolled += 1
    } catch {
      // ignora conflitti o sequenze senza step
    }
  }
  return enrolled
}

/** Ferma le iscrizioni attive di un contatto (es. ha risposto). Rispetta il flag stop_on_reply quando reason='replied'. */
export async function stopEnrollmentsForContact(
  supabase: any,
  userId: string,
  contactId: string,
  reason: string
) {
  const { data: active, error } = await supabase
    .from('sequence_enrollments')
    .select('id, sequence_id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'active')

  if (error || !active?.length) return 0

  let idsToStop = active.map((row: any) => row.id)

  if (reason === 'replied') {
    const sequenceIds = Array.from(new Set(active.map((row: any) => row.sequence_id)))
    const { data: sequences } = await supabase
      .from('followup_sequences')
      .select('id, stop_on_reply')
      .in('id', sequenceIds)
    const stopMap = new Map((sequences || []).map((s: any) => [s.id, s.stop_on_reply]))
    idsToStop = active
      .filter((row: any) => stopMap.get(row.sequence_id) !== false)
      .map((row: any) => row.id)
  }

  if (!idsToStop.length) return 0

  const { error: updateError } = await supabase
    .from('sequence_enrollments')
    .update({ status: 'stopped', stopped_at: nowIso(), stop_reason: reason })
    .in('id', idsToStop)

  if (updateError) throw updateError
  return idsToStop.length
}

export async function listEnrollmentsForContact(supabase: any, userId: string, contactId: string) {
  const { data, error } = await supabase
    .from('sequence_enrollments')
    .select('*, sequence:followup_sequences(name)')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('started_at', { ascending: false })

  if (error) throw error
  return (data || []).map((row: any) => ({
    id: row.id,
    sequence_id: row.sequence_id,
    contact_id: row.contact_id,
    status: row.status,
    current_step: row.current_step,
    next_run_at: row.next_run_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    stopped_at: row.stopped_at,
    stop_reason: row.stop_reason,
    sequence_name: row.sequence?.name || null,
  }))
}

type ProcessResult = {
  processed: number
  tasks_created: number
  completed: number
  stopped: number
  skipped: number
}

/**
 * Esegue gli step delle iscrizioni in scadenza: materializza il task della cadenza, registra l'attività e avanza.
 * Pensato per il cron n8n (service role). Idempotente: ogni step crea il task con chiave sequence:{enrollment}:{step}.
 */
export async function processDueEnrollments(supabase: any, limit = 200): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, tasks_created: 0, completed: 0, stopped: 0, skipped: 0 }

  const { data: due, error } = await supabase
    .from('sequence_enrollments')
    .select('*')
    .eq('status', 'active')
    .not('next_run_at', 'is', null)
    .lte('next_run_at', nowIso())
    .order('next_run_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  if (!due?.length) return result

  const sequenceIds = Array.from(new Set(due.map((row: any) => row.sequence_id)))
  const contactIds = Array.from(new Set(due.map((row: any) => row.contact_id)))

  const [{ data: sequences }, { data: steps }, { data: contacts }] = await Promise.all([
    supabase.from('followup_sequences').select('id, status').in('id', sequenceIds),
    supabase.from('sequence_steps').select('*').in('sequence_id', sequenceIds).order('step_index', { ascending: true }),
    supabase.from('contacts').select('id, user_id, name, email, phone, status').in('id', contactIds),
  ])

  const sequenceStatus = new Map<string, string>((sequences || []).map((s: any) => [s.id, s.status]))
  const stepsBySeq = new Map<string, SequenceStep[]>()
  for (const step of steps || []) {
    const list = stepsBySeq.get(step.sequence_id) || []
    list.push(step as SequenceStep)
    stepsBySeq.set(step.sequence_id, list)
  }
  const contactById = new Map<string, any>((contacts || []).map((c: any) => [c.id, c]))

  for (const enrollment of due) {
    result.processed += 1

    // Sequenza in pausa o archiviata: non avanzare.
    if (sequenceStatus.get(enrollment.sequence_id) !== 'active') {
      result.skipped += 1
      continue
    }

    const contact = contactById.get(enrollment.contact_id)
    if (!contact) {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'stopped', stopped_at: nowIso(), stop_reason: 'contact_missing' })
        .eq('id', enrollment.id)
      result.stopped += 1
      continue
    }

    // Lead chiuso/perso/pagato: la cadenza si ferma.
    if (isClosedStatus(String(contact.status || ''))) {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'stopped', stopped_at: nowIso(), stop_reason: 'lead_closed' })
        .eq('id', enrollment.id)
      result.stopped += 1
      continue
    }

    const ordered = sortSteps(stepsBySeq.get(enrollment.sequence_id) || [])
    const step = ordered[enrollment.current_step]

    if (!step) {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: nowIso(), next_run_at: null })
        .eq('id', enrollment.id)
      result.completed += 1
      continue
    }

    const contactUserId = contact.user_id || enrollment.user_id

    if (step.action !== 'wait') {
      const fields = taskFieldsForStep(step.action)
      const stepLabel = step.title?.trim() || `${actionLabel(step.action)} di follow-up`
      const note =
        step.action === 'whatsapp'
          ? `WhatsApp: ${stepLabel}`
          : stepLabel

      try {
        await createLeadTask(supabase, contactUserId, {
          leadId: enrollment.contact_id,
          action: fields.action,
          type: fields.type,
          dueAt: nowIso(),
          priority: step.priority,
          note,
          idempotencyKey: `sequence:${enrollment.id}:${step.step_index}`,
        })
        result.tasks_created += 1

        await logLeadActivity(supabase, contactUserId, {
          leadId: enrollment.contact_id,
          type: 'note',
          content: `Cadenza · step ${step.step_index + 1} (${actionLabel(step.action)}): ${stepLabel}`,
          metadata: { sequence_id: enrollment.sequence_id, enrollment_id: enrollment.id, step_index: step.step_index },
        })
      } catch {
        // Se il task fallisce non avanziamo: verrà ritentato al prossimo giro.
        result.skipped += 1
        continue
      }
    }

    const nextIndex = enrollment.current_step + 1
    if (nextIndex < ordered.length) {
      await supabase
        .from('sequence_enrollments')
        .update({
          current_step: nextIndex,
          next_run_at: nextRunForStep(enrollment.started_at, ordered, nextIndex),
        })
        .eq('id', enrollment.id)
    } else {
      await supabase
        .from('sequence_enrollments')
        .update({ status: 'completed', completed_at: nowIso(), next_run_at: null })
        .eq('id', enrollment.id)
      result.completed += 1
    }
  }

  return result
}

export const DEFAULT_SEQUENCE_TEMPLATE: SequenceInput = {
  name: 'Cadenza standard 14 giorni',
  description: 'Sequenza multi-canale che riprende i lead non ancora caldi e si ferma da sola appena rispondono.',
  trigger_event: 'manual',
  stop_on_reply: true,
  steps: [
    { action: 'send_email', offset_hours: 0, title: 'Email di apertura', priority: 'high' },
    { action: 'call', offset_hours: 72, title: 'Chiamata di follow-up', priority: 'high' },
    { action: 'send_email', offset_hours: 168, title: 'Email valore / case study', priority: 'medium' },
    { action: 'whatsapp', offset_hours: 336, title: 'Messaggio WhatsApp di chiusura', priority: 'medium' },
  ],
}

export async function seedDefaultSequences(supabase: any, userId: string): Promise<FollowupSequence | null> {
  const { data: existing } = await supabase
    .from('followup_sequences')
    .select('id')
    .eq('user_id', userId)
    .eq('name', DEFAULT_SEQUENCE_TEMPLATE.name)
    .neq('status', 'archived')
    .maybeSingle()

  if (existing) return getSequence(supabase, userId, existing.id)
  return createSequence(supabase, userId, DEFAULT_SEQUENCE_TEMPLATE)
}
