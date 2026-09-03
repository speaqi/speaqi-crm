import { localDayDateKey, startOfDay } from '@/lib/schedule'
import type { Task, TodoArea, TodoProgressState } from '@/types'

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
