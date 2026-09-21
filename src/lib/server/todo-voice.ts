import { resolveProgress, type ProgressLevers } from '@/lib/todo'
import type { Task, TodoArea, TodoBoardColumn, TodoProgressState } from '@/types'

/**
 * Da un messaggio parlato alle attività del To Do.
 *
 * Il punto di questa strada non è creare attività — per quello c'è la casella
 * in cima a /todo — ma **aggiornarle mentre si fa altro**: in macchina, fra due
 * riunioni, quando l'unica cosa che si può fare è parlare. Per questo il modello
 * può sia aprire una cosa nuova sia chiuderne una già aperta: dire "ho finito di
 * sistemare il preventivo Rossi e domani chiamo Bianchi" è un fatto solo, e
 * deve restare un gesto solo.
 *
 * Tutto quello che decide cosa scrivere sta qui ed è puro: il modello propone,
 * `normalizeTodoActions` verifica contro le attività e le colonne che esistono
 * davvero, e solo quello che sopravvive viene scritto. Un'allucinazione del
 * modello non deve poter inventare un id.
 */

export const TODO_VOICE_MAX_ACTIONS = 12

export type TodoVoiceAction =
  | {
      op: 'create'
      title: string
      area: TodoArea
      priority: 'low' | 'medium' | 'high'
      dueDate: string | null
      note: string | null
      progressState: TodoProgressState | null
      boardColumnId: string | null
    }
  | {
      op: 'update'
      taskId: string
      taskTitle: string
      progressState: TodoProgressState | null
      progressPercent: number | null
      status: 'pending' | 'done' | null
      dueDate: string | null
      note: string | null
      boardColumnId: string | null
    }

const AREAS: TodoArea[] = ['speaqi', 'personale', 'altro']
const PROGRESS_STATES: TodoProgressState[] = ['todo', 'in_progress', 'blocked', 'done']
const PRIORITIES = ['low', 'medium', 'high'] as const

function pickArea(value: unknown): TodoArea | null {
  const normalized = String(value || '').trim().toLowerCase()
  return (AREAS as string[]).includes(normalized) ? (normalized as TodoArea) : null
}

function pickProgressState(value: unknown): TodoProgressState | null {
  const normalized = String(value || '').trim().toLowerCase()
  return (PROGRESS_STATES as string[]).includes(normalized) ? (normalized as TodoProgressState) : null
}

function pickPriority(value: unknown): 'low' | 'medium' | 'high' | null {
  const normalized = String(value || '').trim().toLowerCase()
  return (PRIORITIES as readonly string[]).includes(normalized)
    ? (normalized as 'low' | 'medium' | 'high')
    : null
}

function pickPercent(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function pickText(value: unknown, max: number): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

/**
 * Una data dal modello può arrivare come giorno (`2026-09-22`) o come istante
 * completo. Il giorno secco viene ancorato alle 9:00 locali, come fa il
 * calendario della pagina: un'attività "di domani" senza ora non è un'attività
 * di mezzanotte.
 */
export function normalizeVoiceDate(value: unknown): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T09:00:00`)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export type TodoVoiceContext = {
  tasks: Pick<Task, 'id' | 'title'>[]
  columns: Pick<TodoBoardColumn, 'id' | 'label'>[]
}

/**
 * Filtro fra quello che il modello ha detto e quello che si scrive. Scarta,
 * senza rumore, ogni azione che non regge: un aggiornamento su un id che non
 * esiste, una creazione senza titolo, una colonna inventata.
 */
export function normalizeTodoActions(raw: unknown, context: TodoVoiceContext): TodoVoiceAction[] {
  const list = Array.isArray((raw as any)?.actions) ? (raw as any).actions : []
  const byId = new Map(context.tasks.map((task) => [task.id, task]))
  const columnIds = new Set(context.columns.map((column) => column.id))
  const actions: TodoVoiceAction[] = []

  for (const item of list) {
    if (actions.length >= TODO_VOICE_MAX_ACTIONS) break
    const op = String(item?.op || '').trim().toLowerCase()

    if (op === 'create') {
      const title = pickText(item?.title, 160)
      if (!title) continue
      const columnId = String(item?.board_column_id || '').trim()
      actions.push({
        op: 'create',
        title,
        area: pickArea(item?.area) || 'speaqi',
        priority: pickPriority(item?.priority) || 'medium',
        dueDate: normalizeVoiceDate(item?.due_date),
        note: pickText(item?.note, 500),
        progressState: pickProgressState(item?.progress_state),
        boardColumnId: columnIds.has(columnId) ? columnId : null,
      })
      continue
    }

    if (op === 'update') {
      const taskId = String(item?.task_id || '').trim()
      const task = byId.get(taskId)
      if (!task) continue

      const progressPercent = pickPercent(item?.progress_percent)
      let progressState = pickProgressState(item?.progress_state)
      // "sono a metà" detto a voce vuol dire che ci si sta lavorando. Dalla
      // pagina una percentuale è solo una percentuale — si vede la barra e si
      // vede la colonna, quindi non c'è niente da indovinare — ma qui non c'è
      // nessuna colonna sott'occhio, e lasciare l'attività in "Da fare" al 50%
      // significherebbe non ritrovarla più fra quelle in corso.
      if (progressState === null && progressPercent !== null && progressPercent > 0 && progressPercent < 100) {
        progressState = 'in_progress'
      }
      const statusRaw = String(item?.status || '').trim().toLowerCase()
      const status = statusRaw === 'done' ? 'done' : statusRaw === 'pending' ? 'pending' : null
      const dueDate = normalizeVoiceDate(item?.due_date)
      const note = pickText(item?.note, 500)
      const columnId = String(item?.board_column_id || '').trim()
      const boardColumnId = columnIds.has(columnId) ? columnId : null

      // Un aggiornamento che non aggiorna niente è rumore: il modello a volte
      // ripete l'attività appena creata solo per dire che esiste.
      if (
        progressState === null &&
        progressPercent === null &&
        status === null &&
        !dueDate &&
        !note &&
        !boardColumnId
      ) {
        continue
      }

      actions.push({
        op: 'update',
        taskId,
        taskTitle: String(task.title || 'Attività'),
        progressState,
        progressPercent,
        status,
        dueDate,
        note,
        boardColumnId,
      })
    }
  }

  return actions
}

/** Una nota dettata si aggiunge in fondo, datata: non cancella quella di prima. */
export function appendVoiceNote(existing: string | null | undefined, addition: string, now: Date) {
  const stamp = now.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  const line = `${stamp} · ${addition}`
  const current = String(existing || '').trim()
  return current ? `${current}\n${line}` : line
}

/** Come si trasforma un'azione di aggiornamento nei campi da scrivere. */
export function updatePayloadFor(
  action: Extract<TodoVoiceAction, { op: 'update' }>,
  current: Task,
  now: Date
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  const levers: ProgressLevers = {}
  if (action.progressPercent !== null) levers.progress_percent = action.progressPercent
  if (action.progressState !== null) levers.progress_state = action.progressState
  if (action.status !== null) levers.status = action.status

  if (Object.keys(levers).length > 0) {
    const wasDone = current.status === 'done'
    const resolved = resolveProgress(
      {
        status: wasDone ? 'done' : 'pending',
        progress_state: (current.progress_state as TodoProgressState) || (wasDone ? 'done' : 'todo'),
        progress_percent: pickPercent(current.progress_percent) ?? (wasDone ? 100 : 0),
      },
      levers
    )
    payload.progress_state = resolved.progress_state
    payload.progress_percent = resolved.progress_percent
    payload.status = resolved.status
    payload.completed_at = resolved.status === 'done' ? current.completed_at || now.toISOString() : null
    if (resolved.progress_state === 'in_progress' && !current.started_at) payload.started_at = now.toISOString()
    if (resolved.progress_state === 'todo') payload.started_at = null
  }

  if (action.dueDate) {
    payload.due_date = action.dueDate
    // Stessa contabilità della pagina: ogni spostamento di scadenza è un rinvio
    // e si vede nel conteggio, anche quando arriva da un vocale.
    if ((current.due_date || null) !== action.dueDate) {
      payload.rescheduled_at = now.toISOString()
      payload.reschedule_count = Number(current.reschedule_count || 0) + 1
    }
  }

  if (action.note) payload.note = appendVoiceNote(current.note, action.note, now)
  if (action.boardColumnId) payload.board_column_id = action.boardColumnId

  return payload
}

/** Il messaggio di ritorno in chat: cosa è stato scritto, in una riga per cosa. */
export function formatTodoReply(
  results: { created: string[]; updated: string[]; skipped: number },
  transcript: string
) {
  const lines: string[] = []

  if (results.created.length > 0) {
    lines.push('✅ Aggiunte:')
    for (const title of results.created) lines.push(`• ${title}`)
  }

  if (results.updated.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('🔄 Aggiornate:')
    for (const line of results.updated) lines.push(`• ${line}`)
  }

  if (lines.length === 0) {
    return [
      '🤔 Non ho capito cosa scrivere nel To Do.',
      '',
      `Ho sentito: “${transcript.slice(0, 500)}”`,
      '',
      'Prova a dire una cosa per volta, per esempio: “aggiungi: richiamare Rossi per il preventivo, entro domani”.',
    ].join('\n')
  }

  if (results.skipped > 0) {
    lines.push('')
    lines.push(`(${results.skipped} pezzi del messaggio non li ho usati.)`)
  }

  lines.push('')
  lines.push(`🗣️ “${transcript.slice(0, 300)}”`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * Interpretazione (l'unica parte che parla con l'esterno)
 * ------------------------------------------------------------------ */

const ACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['create', 'update'] },
          task_id: { type: ['string', 'null'] },
          title: { type: ['string', 'null'] },
          area: { type: ['string', 'null'], enum: ['speaqi', 'personale', 'altro', null] },
          priority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
          due_date: { type: ['string', 'null'] },
          progress_state: {
            type: ['string', 'null'],
            enum: ['todo', 'in_progress', 'blocked', 'done', null],
          },
          progress_percent: { type: ['number', 'null'] },
          status: { type: ['string', 'null'], enum: ['pending', 'done', null] },
          note: { type: ['string', 'null'] },
          board_column_id: { type: ['string', 'null'] },
        },
        required: [
          'op',
          'task_id',
          'title',
          'area',
          'priority',
          'due_date',
          'progress_state',
          'progress_percent',
          'status',
          'note',
          'board_column_id',
        ],
      },
    },
  },
  required: ['actions'],
} as const

const SYSTEM_PROMPT = [
  'Trasformi un messaggio parlato in italiano nelle azioni da fare sulla lista di attività personali di chi parla (il To Do di un CRM).',
  'Restituisci una azione per ogni cosa detta: chi parla racconta la giornata, quindi un messaggio contiene spesso sia cose fatte sia cose da fare.',
  '',
  'op=create per una cosa nuova da fare. Il titolo è breve e all\'infinito ("Chiamare Rossi per il preventivo").',
  'op=update per una cosa già in elenco: usa SOLO i task_id elencati sotto, mai un id inventato. Se non riconosci con sicurezza l\'attività di cui si parla, crea invece una nuova attività.',
  '',
  '"ho fatto / ho finito / ho chiuso" → update con status=done.',
  '"ci sto lavorando / ho iniziato / sono a metà" → update con progress_state=in_progress e, se lo dice, progress_percent.',
  '"sono fermo / aspetto che / dipende da" → update con progress_state=blocked.',
  'Le date: due_date in formato AAAA-MM-GG, calcolata rispetto alla data corrente fornita. Senza indicazione, lascia null.',
  'Aree: speaqi = lavoro sul CRM e sul progetto Speaqi; personale = fuori dal lavoro; altro = altri progetti di lavoro.',
  'priority=high solo se chi parla dice che è urgente o prioritario.',
  'note: solo il dettaglio detto a voce che non sta nel titolo. Non ripetere il titolo.',
  'Non inventare attività che non sono state dette. Se il messaggio non contiene niente da scrivere, restituisci una lista vuota.',
].join('\n')

function extractTextOutput(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  const output = Array.isArray(payload?.output) ? payload.output : []
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim()
      }
    }
  }
  return ''
}

export type TodoVoiceCandidate = Pick<
  Task,
  'id' | 'title' | 'status' | 'progress_state' | 'progress_percent' | 'due_date' | 'area'
>

export async function interpretTodoMessage(
  transcript: string,
  candidates: TodoVoiceCandidate[],
  columns: Pick<TodoBoardColumn, 'id' | 'label'>[]
): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY non configurata')

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini'
  const nowInRome = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Rome',
  }).format(new Date())

  const taskList = candidates
    .map((task) =>
      [
        `task_id=${task.id}`,
        `titolo=${task.title || 'senza titolo'}`,
        `stato=${task.progress_state || (task.status === 'done' ? 'done' : 'todo')}`,
        task.progress_percent ? `avanzamento=${task.progress_percent}%` : null,
        task.due_date ? `scadenza=${String(task.due_date).slice(0, 10)}` : null,
        task.area ? `area=${task.area}` : null,
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n')

  const columnList = columns.map((column) => `board_column_id=${column.id} | nome=${column.label}`).join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'minimal' },
      text: {
        format: { type: 'json_schema', name: 'todo_voice_actions', strict: false, schema: ACTION_SCHEMA },
      },
      input: [
        { role: 'system', content: [{ type: 'input_text', text: SYSTEM_PROMPT }] },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `Data e ora correnti (Europe/Rome): ${nowInRome}\n\n` +
                `Messaggio: ${transcript}\n\n` +
                `Attività già in elenco:\n${taskList || 'Nessuna.'}\n\n` +
                `Colonne della lavagna:\n${columnList || 'Nessuna colonna personalizzata.'}`,
            },
          ],
        },
      ],
    }),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'Richiesta OpenAI non riuscita')

  const text = extractTextOutput(payload)
  if (!text) throw new Error('Risposta OpenAI vuota')
  return JSON.parse(text)
}
