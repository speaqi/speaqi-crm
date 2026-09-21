import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import {
  downloadTelegramFile,
  extractAudio,
  isAllowedChat,
  matchesWebhookSecret,
  sendTelegramMessage,
  telegramConfig,
} from '@/lib/server/telegram'
import { TranscriptionError, transcribeAudio } from '@/lib/server/transcribe'
import {
  formatTodoReply,
  interpretTodoMessage,
  normalizeTodoActions,
  updatePayloadFor,
  type TodoVoiceCandidate,
} from '@/lib/server/todo-voice'
import { resolveProgress } from '@/lib/todo'
import type { Task } from '@/types'

/**
 * Il bot Telegram che scrive nel To Do.
 *
 * Tre cose da sapere prima di toccare questo file:
 *
 * 1. **Si risponde sempre 200.** Telegram riconsegna lo stesso update finché
 *    non riceve un 200, quindi un errore nostro ripetuto diventerebbe un ciclo.
 *    Quello che è andato storto si dice in chat e si scrive in
 *    `telegram_inbox.error`, non con un codice di stato.
 * 2. **L'unicità sta sul database.** La riga in `telegram_inbox` si inserisce
 *    *prima* di fare qualunque lavoro: se quell'update era già passato, la
 *    chiave unica lo ferma qui e nessuna attività viene creata due volte.
 * 3. **Chi scrive dev'essere nell'elenco.** Un bot risponde a chiunque ne
 *    conosca il nome: senza `TELEGRAM_ALLOWED_CHAT_IDS` uno sconosciuto
 *    scriverebbe dentro il CRM. Alle chat non autorizzate non si risponde
 *    nemmeno, per non confermare che il bot è vivo.
 */

/** Attività passate al modello: più di così è contesto che non aiuta a scegliere. */
const CANDIDATE_LIMIT = 80
/** Le chiuse di recente servono per "avevo detto fatta ma devo riaprirla". */
const RECENT_DONE_DAYS = 7

function workspaceUserId() {
  return String(
    process.env.TELEGRAM_WORKSPACE_USER_ID || process.env.AUTOMATION_WORKSPACE_USER_ID || ''
  ).trim()
}

function ok(body: Record<string, unknown>) {
  return Response.json({ ok: true, ...body })
}

export async function POST(request: NextRequest) {
  const config = telegramConfig()
  if (!config) return ok({ skipped: 'telegram_not_configured' })

  if (!matchesWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token') || '', config.webhookSecret)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const userId = workspaceUserId()
  if (!userId) return ok({ skipped: 'workspace_not_configured' })

  let update: Record<string, any>
  try {
    update = (await request.json()) as Record<string, any>
  } catch {
    return ok({ skipped: 'invalid_payload' })
  }

  const message = update?.message
  const chatId = message?.chat?.id
  if (!message || chatId === undefined) return ok({ skipped: 'no_message' })
  if (!isAllowedChat(config, chatId)) {
    console.warn(`[telegram] messaggio da chat non autorizzata: ${chatId}`)
    return ok({ skipped: 'chat_not_allowed' })
  }

  const supabase = createServiceRoleClient()
  const audio = extractAudio(message)
  const text = String(message.text || message.caption || '').trim()

  // Il fermo all'idempotenza: se questo update è già passato, qui si esce.
  const { data: inboxRow, error: inboxError } = await supabase
    .from('telegram_inbox')
    .insert({
      user_id: userId,
      update_id: Number(update.update_id),
      chat_id: String(chatId),
      message_id: Number(message.message_id) || null,
      kind: audio ? 'voice' : 'text',
      transcript: audio ? null : text || null,
    })
    .select('id')
    .single()

  if (inboxError) {
    // 23505 = chiave unica: è una riconsegna, non un guasto.
    if ((inboxError as { code?: string }).code === '23505') return ok({ skipped: 'duplicate' })
    console.error('[telegram] inbox insert failed:', inboxError)
    return ok({ skipped: 'inbox_unavailable' })
  }

  const inboxId = inboxRow.id as string
  const finish = async (patch: Record<string, unknown>) => {
    await supabase.from('telegram_inbox').update(patch).eq('id', inboxId)
  }

  try {
    if (!audio && !text) {
      await finish({ status: 'ignored' })
      return ok({ skipped: 'empty_message' })
    }

    let transcript = text
    if (audio) {
      const blob = await downloadTelegramFile(config, audio.fileId)
      transcript = await transcribeAudio(blob, {
        fileName: audio.fileName,
        prompt:
          'Nota vocale di lavoro in italiano: attività da fare, avanzamenti, nomi di clienti e aziende, scadenze.',
      })
      await finish({ transcript })
    }

    const now = new Date()
    const doneSince = new Date(now.getTime() - RECENT_DONE_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const [openRes, doneRes, columnsRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .is('contact_id', null)
        .eq('status', 'pending')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(CANDIDATE_LIMIT),
      supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .is('contact_id', null)
        .eq('status', 'done')
        .gte('updated_at', doneSince)
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase.from('todo_board_columns').select('id, label').eq('user_id', userId),
    ])

    if (openRes.error) throw openRes.error

    const candidates = [...((openRes.data || []) as Task[]), ...((doneRes.data || []) as Task[])]
    const columns = (columnsRes.data || []) as { id: string; label: string }[]

    const raw = await interpretTodoMessage(
      transcript,
      candidates as TodoVoiceCandidate[],
      columns
    )
    const actions = normalizeTodoActions(raw, {
      tasks: candidates.map((task) => ({ id: task.id, title: task.title })),
      columns,
    })
    const proposed = Array.isArray((raw as any)?.actions) ? (raw as any).actions.length : 0

    const created: string[] = []
    const updated: string[] = []
    const createdIds: string[] = []
    const updatedIds: string[] = []

    for (const action of actions) {
      if (action.op === 'create') {
        const progress = resolveProgress(
          { status: 'pending', progress_state: 'todo', progress_percent: 0 },
          action.progressState ? { progress_state: action.progressState } : {}
        )
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            contact_id: null,
            type: 'todo',
            title: action.title,
            note: action.note,
            due_date: action.dueDate,
            priority: action.priority,
            area: action.area,
            board_column_id: action.boardColumnId,
            progress_state: progress.progress_state,
            progress_percent: progress.progress_percent,
            status: progress.status,
            started_at: progress.progress_state === 'in_progress' ? now.toISOString() : null,
            completed_at: progress.status === 'done' ? now.toISOString() : null,
            // Un vocale riconsegnato due volte non deve produrre due attività
            // identiche, nemmeno se la riga di inbox venisse cancellata a mano.
            idempotency_key: `telegram:${update.update_id}:${created.length}`,
          })
          .select('id, title')
          .single()

        if (error) throw error
        created.push(String(data.title || action.title))
        createdIds.push(data.id as string)
        continue
      }

      const current = candidates.find((task) => task.id === action.taskId)
      if (!current) continue
      const payload = updatePayloadFor(action, current, now)
      if (Object.keys(payload).length === 0) continue

      const { error } = await supabase
        .from('tasks')
        .update(payload)
        .eq('user_id', userId)
        .eq('id', action.taskId)
        .is('contact_id', null)

      if (error) throw error

      const done = payload.status === 'done'
      const percent = payload.progress_percent
      const detail = done
        ? 'fatta ✓'
        : typeof percent === 'number'
          ? `al ${percent}%`
          : payload.due_date
            ? `spostata al ${String(payload.due_date).slice(8, 10)}/${String(payload.due_date).slice(5, 7)}`
            : 'aggiornata'
      updated.push(`${action.taskTitle} — ${detail}`)
      updatedIds.push(action.taskId)
    }

    const reply = formatTodoReply(
      { created, updated, skipped: Math.max(0, proposed - actions.length) },
      transcript
    )

    await finish({
      transcript,
      intent: raw as Record<string, unknown>,
      created_task_ids: createdIds,
      updated_task_ids: updatedIds,
      status: created.length + updated.length > 0 ? 'applied' : 'understood_nothing',
    })

    await sendTelegramMessage(config, chatId, reply)
    return ok({ created: created.length, updated: updated.length })
  } catch (error) {
    const detail =
      error instanceof TranscriptionError
        ? error.message
        : errorMessage(error, 'Non sono riuscito a elaborare il messaggio')
    console.error('[telegram] handling failed:', error)
    await finish({ status: 'failed', error: detail })
    await sendTelegramMessage(config, chatId, `⚠️ ${detail}. Il messaggio è salvato, riprova fra poco.`)
    return ok({ failed: true })
  }
}
