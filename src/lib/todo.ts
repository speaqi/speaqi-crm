import { localDayDateKey, startOfDay } from '@/lib/schedule'
import type {
  StandaloneTaskInput,
  StandaloneTaskPatch,
  Task,
  TodoArea,
  TodoBoardColumn,
  TodoProgressState,
} from '@/types'

/** Ora locale a cui vengono ancorate inizio e scadenza scelte dal date picker. */
const PLANNING_HOUR = 9

export const TODO_AREAS: { key: TodoArea; label: string; short: string }[] = [
  { key: 'speaqi', label: 'Speaqi', short: 'SP' },
  { key: 'personale', label: 'Personale', short: 'PE' },
  { key: 'altro', label: 'Altro', short: 'AL' },
]

export const TODO_PROGRESS_STATES: { key: TodoProgressState; label: string }[] = [
  { key: 'todo', label: 'Da fare' },
  { key: 'in_progress', label: 'In corso' },
  { key: 'blocked', label: 'In attesa' },
  { key: 'done', label: 'Fatta' },
]

export const TODO_PERCENT_STEPS = [0, 25, 50, 75, 100]

export function taskArea(task: Task): TodoArea {
  const value = String(task.area || '').trim().toLowerCase()
  return TODO_AREAS.some((a) => a.key === value) ? (value as TodoArea) : 'speaqi'
}

export function taskProgressState(task: Task): TodoProgressState {
  const value = String(task.progress_state || '').trim().toLowerCase()
  if (TODO_PROGRESS_STATES.some((s) => s.key === value)) return value as TodoProgressState
  if (task.status === 'done') return 'done'
  return task.started_at ? 'in_progress' : 'todo'
}

export function taskProgressPercent(task: Task): number {
  const value = Number(task.progress_percent)
  if (Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  return task.status === 'done' ? 100 : 0
}

/** Valore per un `input[type=date]` a partire da una data ISO del DB. */
export function dateInputValue(iso?: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : localDayDateKey(date)
}

/** Valore di un `input[type=date]` → ISO da salvare (o null se il campo è vuoto). */
export function dateInputToIso(value: string) {
  if (!value) return null
  const date = new Date(`${value}T${String(PLANNING_HOUR).padStart(2, '0')}:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Sposta una data ISO di N giorni; da una data assente riparte da oggi. */
export function shiftIsoDays(iso: string | null | undefined, days: number) {
  const base = iso ? new Date(iso) : new Date()
  const start = Number.isNaN(base.getTime()) ? new Date() : base
  const next = new Date(start)
  next.setDate(next.getDate() + days)
  return next.toISOString()
}

/**
 * Barra del Gantt: si parte da `start_date`, si finisce a `due_date`. Con una
 * sola delle due l'attività occupa quel giorno soltanto; senza nessuna delle
 * due non è pianificata e resta fuori dalla timeline.
 */
export function taskSpan(task: Task): { start: Date; end: Date } | null {
  const rawStart = task.start_date ? new Date(task.start_date) : null
  const rawEnd = task.due_date ? new Date(task.due_date) : null
  const start = rawStart && !Number.isNaN(rawStart.getTime()) ? startOfDay(rawStart) : null
  const end = rawEnd && !Number.isNaN(rawEnd.getTime()) ? startOfDay(rawEnd) : null

  if (!start && !end) return null
  if (start && !end) return { start, end: start }
  if (!start && end) return { start: end, end }
  // Date invertite (fine prima dell'inizio): si mostra il solo giorno d'inizio.
  return end! < start! ? { start: start!, end: start! } : { start: start!, end: end! }
}

export type TodoBucket = 'overdue' | 'today' | 'week' | 'later' | 'unplanned'

export function todoBucket(task: Task, today: Date): TodoBucket {
  if (!task.due_date) return 'unplanned'
  const due = new Date(task.due_date)
  if (Number.isNaN(due.getTime())) return 'unplanned'

  const start = startOfDay(today)
  const dueDay = startOfDay(due)
  if (dueDay < start) return 'overdue'
  if (dueDay.getTime() === start.getTime()) return 'today'

  const weekEnd = new Date(start)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return dueDay < weekEnd ? 'week' : 'later'
}

export function isTaskOverdue(task: Task, today: Date) {
  return task.status !== 'done' && todoBucket(task, today) === 'overdue'
}

export function formatDayMonth(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

export function formatFullDate(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export type ProgressLevers = {
  status?: 'pending' | 'done'
  progress_state?: TodoProgressState
  progress_percent?: number
}

export type ResolvedProgress = {
  status: 'pending' | 'done'
  progress_state: TodoProgressState
  progress_percent: number
}

/**
 * Spunta, stato di avanzamento e percentuale sono tre leve sulla stessa cosa.
 * Qui vengono riconciliate una volta sola, così il resto del CRM può continuare
 * a leggere soltanto `status` (pending/done). L'ordine conta: la percentuale
 * propone, lo stato esplicito decide, la spunta ha sempre l'ultima parola.
 */
export function resolveProgress(current: ResolvedProgress, levers: ProgressLevers): ResolvedProgress {
  // Una riga scritta a mano sul DB può arrivare incoerente (fatta al 40%,
  // aperta al 100%). `status` è l'autorità su "è chiusa?", quindi si riallinea
  // il resto a lui prima di applicare le leve: così un salvataggio qualsiasi
  // ripara la riga invece di tramandare lo sfasamento.
  let state = current.progress_state
  let percent = current.progress_percent

  if (current.status === 'done') {
    state = 'done'
    percent = 100
  } else {
    if (state === 'done') state = 'in_progress'
    if (percent === 100) percent = 75
  }

  if (levers.progress_percent !== undefined) {
    percent = Math.max(0, Math.min(100, Math.round(levers.progress_percent)))
    if (percent === 100) state = 'done'
    else if (state === 'done') state = 'in_progress'
  }

  if (levers.progress_state !== undefined) {
    state = levers.progress_state
    if (state === 'done') percent = 100
    else if (percent === 100) percent = 75
  }

  if (levers.status !== undefined) {
    if (levers.status === 'done') {
      state = 'done'
      percent = 100
    } else if (state === 'done') {
      state = 'in_progress'
      percent = Math.min(percent, 75)
    }
  }

  return { status: state === 'done' ? 'done' : 'pending', progress_state: state, progress_percent: percent }
}

/* ------------------------------------------------------------------ *
 * Kanban: raggruppamenti, ordinamenti, spostamenti
 * ------------------------------------------------------------------ */

/**
 * Come si divide la lavagna. Ogni raggruppamento porta le sue colonne
 * calcolate — da fare/in corso, oggi/questa settimana, le aree, le priorità —
 * e **in coda** le colonne aggiunte a mano, che valgono su tutti i
 * raggruppamenti: una colonna chiamata "Da fatturare" ha senso sia guardando
 * l'avanzamento sia guardando le date.
 */
export type TodoGrouping = 'progress' | 'when' | 'area' | 'priority'

/** Ordinamento delle schede dentro una colonna. */
export type TodoSort = 'priority' | 'due' | 'progress' | 'recent' | 'title'

export type TodoPriority = 'low' | 'medium' | 'high'

export interface TodoColumnDef {
  key: string
  label: string
  /** Vera per le colonne aggiunte a mano: sono le uniche che si rinominano e si cancellano. */
  custom?: boolean
  /** Riga sotto il titolo: dice cosa significa la colonna, non quante schede ha. */
  hint: string
  /** Suffisso della classe CSS, per il colore della colonna. */
  tone: string
}

export const TODO_PRIORITIES: { key: TodoPriority; label: string; short: string }[] = [
  { key: 'high', label: 'Alta', short: '!!!' },
  { key: 'medium', label: 'Media', short: '!!' },
  { key: 'low', label: 'Bassa', short: '!' },
]

export const TODO_GROUPINGS: { key: TodoGrouping; label: string; columns: TodoColumnDef[] }[] = [
  {
    key: 'progress',
    label: 'Avanzamento',
    columns: [
      { key: 'todo', label: 'Da fare', hint: 'Non ancora iniziate', tone: 'todo' },
      { key: 'in_progress', label: 'In corso', hint: 'Ci stai lavorando adesso', tone: 'in_progress' },
      { key: 'blocked', label: 'In attesa', hint: 'Ferme su qualcun altro', tone: 'blocked' },
      { key: 'done', label: 'Fatte', hint: 'Chiuse', tone: 'done' },
    ],
  },
  {
    key: 'when',
    label: 'Quando',
    columns: [
      // Le scadute stanno qui dentro, non in una colonna loro: restano da fare
      // oggi, e una colonna "in ritardo" in testa alla pagina è solo un rimprovero.
      { key: 'today', label: 'Oggi', hint: 'In scadenza oggi e arretrate', tone: 'today' },
      { key: 'week', label: 'Questa settimana', hint: 'Entro sette giorni', tone: 'week' },
      { key: 'later', label: 'Più avanti', hint: 'Oltre la settimana', tone: 'later' },
      { key: 'unplanned', label: 'Da pianificare', hint: 'Ancora senza data', tone: 'unplanned' },
    ],
  },
  {
    key: 'area',
    label: 'Progetto',
    columns: [
      { key: 'speaqi', label: 'Speaqi', hint: 'Lavoro sul CRM e sul progetto', tone: 'speaqi' },
      { key: 'personale', label: 'Personale', hint: 'Fuori dal lavoro', tone: 'personale' },
      { key: 'altro', label: 'Altri progetti', hint: 'Tutto il resto che porti avanti', tone: 'altro' },
    ],
  },
  {
    key: 'priority',
    label: 'Priorità',
    columns: [
      { key: 'high', label: 'Alta', hint: 'Prima di tutto il resto', tone: 'high' },
      { key: 'medium', label: 'Media', hint: 'Il flusso normale', tone: 'medium' },
      { key: 'low', label: 'Bassa', hint: 'Quando avanza tempo', tone: 'low' },
    ],
  },
]

/** Tavolozza dei colori scegliibili per una colonna personalizzata. */
export const TODO_COLUMN_TONES: { key: string; label: string }[] = [
  { key: 'accent', label: 'Blu Speaqi' },
  { key: 'blue', label: 'Azzurro' },
  { key: 'green', label: 'Verde' },
  { key: 'yellow', label: 'Giallo' },
  { key: 'red', label: 'Rosso' },
  { key: 'purple', label: 'Viola' },
  { key: 'gray', label: 'Grigio' },
]

export function normalizeColumnTone(value?: string | null) {
  const tone = String(value || '').trim().toLowerCase()
  return TODO_COLUMN_TONES.some((option) => option.key === tone) ? tone : 'accent'
}

export const TODO_SORTS: { key: TodoSort; label: string }[] = [
  { key: 'priority', label: 'Priorità' },
  { key: 'due', label: 'Scadenza' },
  { key: 'progress', label: 'Avanzamento' },
  { key: 'recent', label: 'Aggiunte di recente' },
  { key: 'title', label: 'Alfabetico' },
]

/**
 * Le colonne da disegnare: quelle calcolate del raggruppamento scelto, poi in
 * coda quelle aggiunte a mano — che sono le stesse qualunque raggruppamento si
 * guardi.
 */
export function todoColumns(grouping: TodoGrouping, customColumns: TodoBoardColumn[] = []): TodoColumnDef[] {
  const base = (TODO_GROUPINGS.find((g) => g.key === grouping) || TODO_GROUPINGS[0]).columns
  return [
    ...base,
    ...sortBoardColumns(customColumns).map((column) => ({
      key: column.id,
      label: column.label,
      hint: String(column.hint || '').trim(),
      tone: normalizeColumnTone(column.tone),
      custom: true,
    })),
  ]
}

/** Ordine di disegno delle colonne: posizione, poi creazione, poi id. */
export function sortBoardColumns(columns: TodoBoardColumn[]): TodoBoardColumn[] {
  return [...columns].sort((left, right) => {
    const byPosition = Number(left.position || 0) - Number(right.position || 0)
    if (byPosition !== 0) return byPosition
    const byCreated = String(left.created_at || '').localeCompare(String(right.created_at || ''))
    if (byCreated !== 0) return byCreated
    return left.id.localeCompare(right.id)
  })
}

export function taskPriority(task: Task): TodoPriority {
  const value = String(task.priority || '').trim().toLowerCase()
  return value === 'low' || value === 'high' ? value : 'medium'
}

/**
 * La colonna aggiunta a mano in cui la scheda è stata messa, se c'è ancora.
 * Una scheda appesa a una colonna cancellata altrove (altro browser, altro
 * dispositivo) deve tornare nella sua colonna calcolata, non sparire.
 */
export function pinnedColumnId(task: Task, customColumns: TodoBoardColumn[] = []): string | null {
  const columnId = String(task.board_column_id || '').trim()
  if (!columnId) return null
  return customColumns.some((column) => column.id === columnId) ? columnId : null
}

/**
 * In quale colonna cade l'attività. Una colonna aggiunta a mano vince sempre
 * sul calcolo: ce l'ha messa qualcuno, e nessuna data o cambio di stato deve
 * portarla via da lì. Per riportarla fra le colonne calcolate la si trascina
 * fuori.
 */
export function todoColumnKey(
  task: Task,
  grouping: TodoGrouping,
  today: Date,
  customColumns: TodoBoardColumn[] = []
): string {
  const pinned = pinnedColumnId(task, customColumns)
  if (pinned) return pinned

  switch (grouping) {
    case 'progress':
      return taskProgressState(task)
    case 'area':
      return taskArea(task)
    case 'priority':
      return taskPriority(task)
    case 'when': {
      const bucket = todoBucket(task, today)
      return bucket === 'overdue' ? 'today' : bucket
    }
    default:
      return ''
  }
}

const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }
const PROGRESS_RANK: Record<TodoProgressState, number> = { in_progress: 0, blocked: 1, todo: 2, done: 3 }
const NO_DUE = Number.MAX_SAFE_INTEGER

function dueTime(task: Task) {
  if (!task.due_date) return NO_DUE
  const time = new Date(task.due_date).getTime()
  return Number.isNaN(time) ? NO_DUE : time
}

function createdTime(task: Task) {
  const time = new Date(task.created_at).getTime()
  return Number.isNaN(time) ? 0 : time
}

/**
 * Comparatore per un ordinamento. A parità di criterio si scende sempre su
 * scadenza → inserimento → id: senza l'ultimo gradino due schede identiche si
 * scambierebbero di posto a ogni render.
 */
export function compareTodoTasks(left: Task, right: Task, sort: TodoSort): number {
  switch (sort) {
    case 'priority': {
      const diff = PRIORITY_RANK[taskPriority(left)] - PRIORITY_RANK[taskPriority(right)]
      if (diff !== 0) return diff
      break
    }
    case 'progress': {
      const byState = PROGRESS_RANK[taskProgressState(left)] - PROGRESS_RANK[taskProgressState(right)]
      if (byState !== 0) return byState
      const byPercent = taskProgressPercent(right) - taskProgressPercent(left)
      if (byPercent !== 0) return byPercent
      break
    }
    case 'recent': {
      const diff = createdTime(right) - createdTime(left)
      if (diff !== 0) return diff
      break
    }
    case 'title': {
      const diff = (left.title || '').localeCompare(right.title || '', 'it', { sensitivity: 'base' })
      if (diff !== 0) return diff
      break
    }
    case 'due':
    default:
      break
  }

  const byDue = dueTime(left) - dueTime(right)
  if (byDue !== 0) return byDue
  const byCreated = createdTime(left) - createdTime(right)
  if (byCreated !== 0) return byCreated
  return left.id.localeCompare(right.id)
}

export function sortTodoTasks(tasks: Task[], sort: TodoSort): Task[] {
  return [...tasks].sort((left, right) => compareTodoTasks(left, right, sort))
}

/** Giorni da oggi a cui finisce un'attività lasciata cadere in una colonna di "Quando". */
const WHEN_DROP_DAYS: Record<string, number> = { today: 0, week: 1, later: 7 }

function isoForDayOffset(today: Date, days: number) {
  return dateInputToIso(localDayDateKey(shiftIsoDate(today, days)))
}

function shiftIsoDate(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Cosa succede a un'attività trascinata in una colonna: la modifica da salvare
 * e la frase da mostrare. `null` quando la scheda è già dove è stata lasciata,
 * così un trascinamento a vuoto non conta come un rinvio (ogni cambio di
 * scadenza incrementa `reschedule_count` lato server).
 */
export function todoDropPatch(
  task: Task,
  grouping: TodoGrouping,
  columnKey: string,
  today: Date,
  customColumns: TodoBoardColumn[] = []
): { patch: StandaloneTaskPatch; message: string } | null {
  const pinned = pinnedColumnId(task, customColumns)
  const target = customColumns.find((candidate) => candidate.id === columnKey)

  // Una colonna aggiunta a mano non cambia nient'altro dell'attività: non ha
  // una data né uno stato da imporre, la scheda sta lì e basta.
  if (target) {
    if (pinned === target.id) return null
    return { patch: { board_column_id: target.id }, message: `Spostata in “${target.label}”` }
  }

  const base = builtinDropPatch(task, grouping, columnKey, today)

  // Riportare una scheda appesa a una colonna aggiunta a mano su una colonna
  // calcolata vuol dire prima sganciarla — altrimenti tornerebbe da sola dov'era.
  if (pinned) {
    const label = customColumns.find((candidate) => candidate.id === pinned)?.label || 'colonna'
    return {
      patch: { board_column_id: null, ...(base?.patch || {}) },
      message: base?.message || `Tolta da “${label}”`,
    }
  }

  return base
}

/** Le colonne calcolate: la colonna d'arrivo dice cosa cambia sull'attività. */
function builtinDropPatch(
  task: Task,
  grouping: TodoGrouping,
  columnKey: string,
  today: Date
): { patch: StandaloneTaskPatch; message: string } | null {
  const current = todoColumnKey(task, grouping, today)

  if (grouping === 'when') {
    const overdue = todoBucket(task, today) === 'overdue'
    // Una scaduta sta già nella colonna "Oggi": lasciarcela cadere di nuovo
    // significa "rimettila in data oggi", non "non fare niente".
    if (current === columnKey && !(columnKey === 'today' && overdue)) return null

    if (columnKey === 'unplanned') {
      return { patch: { due_date: null }, message: 'Senza data: è in “Da pianificare”' }
    }

    const days = WHEN_DROP_DAYS[columnKey]
    if (days === undefined) return null
    const iso = isoForDayOffset(today, days)
    if (!iso) return null
    const label = formatDayMonth(iso)
    return {
      patch: { due_date: iso },
      message: columnKey === 'today' ? 'Spostata a oggi' : `Spostata al ${label}`,
    }
  }

  if (current === columnKey) return null

  if (grouping === 'progress') {
    const state = TODO_PROGRESS_STATES.find((option) => option.key === columnKey)
    if (!state) return null
    return {
      patch: { progress_state: state.key },
      message: state.key === 'done' ? 'Fatta ✓' : `Ora è “${state.label}”`,
    }
  }

  if (grouping === 'area') {
    const area = TODO_AREAS.find((option) => option.key === columnKey)
    if (!area) return null
    return { patch: { area: area.key }, message: `Spostata in ${area.label}` }
  }

  if (grouping === 'priority') {
    const priority = TODO_PRIORITIES.find((option) => option.key === columnKey)
    if (!priority) return null
    return { patch: { priority: priority.key }, message: `Priorità ${priority.label.toLowerCase()}` }
  }

  return null
}

/**
 * Valori di partenza per un'attività creata direttamente dentro una colonna:
 * nasce già dove è stata scritta, senza doverla poi spostare.
 */
export function todoColumnDefaults(
  grouping: TodoGrouping,
  columnKey: string,
  today: Date,
  customColumns: TodoBoardColumn[] = []
): Pick<StandaloneTaskInput, 'area' | 'priority' | 'progress_state' | 'due_date' | 'board_column_id'> {
  const custom = customColumns.find((candidate) => candidate.id === columnKey)
  if (custom) return { board_column_id: custom.id }

  if (grouping === 'area') {
    const area = TODO_AREAS.find((option) => option.key === columnKey)
    return area ? { area: area.key } : {}
  }
  if (grouping === 'priority') {
    const priority = TODO_PRIORITIES.find((option) => option.key === columnKey)
    return priority ? { priority: priority.key } : {}
  }
  if (grouping === 'progress') {
    const state = TODO_PROGRESS_STATES.find((option) => option.key === columnKey)
    return state ? { progress_state: state.key } : {}
  }
  if (grouping === 'when') {
    if (columnKey === 'unplanned') return {}
    const days = WHEN_DROP_DAYS[columnKey]
    if (days === undefined) return {}
    return { due_date: isoForDayOffset(today, days) }
  }
  return {}
}
