'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { TodoDateField } from '@/components/todo/TodoDateField'
import { TodoGantt } from '@/components/todo/TodoGantt'
import { TodoKanban } from '@/components/todo/TodoKanban'
import { TodoRow } from '@/components/todo/TodoRow'
import { shiftDays, startOfDay } from '@/lib/schedule'
import {
  TODO_AREAS,
  TODO_GROUPINGS,
  TODO_SORTS,
  sortTodoTasks,
  taskArea,
  taskProgressState,
  todoBucket,
  todoColumnDefaults,
  todoDropPatch,
  type TodoBucket,
  type TodoGrouping,
  type TodoSort,
} from '@/lib/todo'
import type { StandaloneTaskPatch, Task, TodoArea } from '@/types'
import { useCRMContext } from '../layout'

const GANTT_WINDOW_DAYS = 21
const PREFS_KEY = 'speaqi.todo.prefs'

type TodoView = 'board' | 'list' | 'gantt'
type AreaFilter = TodoArea | 'all'

// "Oggi" apre la lista: la colonna delle arretrate resta, ma non è più la prima
// cosa che si vede aprendo la pagina.
const BUCKET_META: { key: TodoBucket; label: string; icon: string }[] = [
  { key: 'today', label: 'Oggi', icon: '☀️' },
  { key: 'overdue', label: 'Arretrate', icon: '⏰' },
  { key: 'week', label: 'Prossimi 7 giorni', icon: '📆' },
  { key: 'later', label: 'Più avanti', icon: '🗓️' },
  { key: 'unplanned', label: 'Da pianificare', icon: '📥' },
]

interface TodoPrefs {
  view: TodoView
  grouping: TodoGrouping
  sort: TodoSort
  area: AreaFilter
  showDone: boolean
}

const DEFAULT_PREFS: TodoPrefs = {
  view: 'board',
  grouping: 'progress',
  sort: 'priority',
  area: 'all',
  showDone: false,
}

/** Le preferenze della lavagna vivono nel browser: sono di questa postazione. */
function readPrefs(): TodoPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<TodoPrefs>
    return {
      view: parsed.view === 'list' || parsed.view === 'gantt' ? parsed.view : 'board',
      grouping: TODO_GROUPINGS.some((g) => g.key === parsed.grouping)
        ? (parsed.grouping as TodoGrouping)
        : DEFAULT_PREFS.grouping,
      sort: TODO_SORTS.some((s) => s.key === parsed.sort) ? (parsed.sort as TodoSort) : DEFAULT_PREFS.sort,
      area:
        parsed.area === 'all' || TODO_AREAS.some((a) => a.key === parsed.area)
          ? (parsed.area as AreaFilter)
          : 'all',
      showDone: Boolean(parsed.showDone),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export default function TodoPage() {
  const {
    standaloneTasks,
    completedStandaloneTasks,
    loadStandaloneTasks,
    createStandaloneTask,
    updateStandaloneTask,
    deleteStandaloneTask,
    showToast,
  } = useCRMContext()

  const [captureTitle, setCaptureTitle] = useState('')
  const [captureArea, setCaptureArea] = useState<TodoArea>('speaqi')
  const [capturing, setCapturing] = useState(false)
  const [prefs, setPrefs] = useState<TodoPrefs>(DEFAULT_PREFS)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [ganttOffset, setGanttOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(() => startOfDay(new Date()), [])
  const { view, grouping, sort, area: areaFilter, showDone } = prefs

  // Il primo render deve coincidere con quello del server (niente localStorage
  // durante l'idratazione): le preferenze si applicano subito dopo.
  useEffect(() => { setPrefs(readPrefs()) }, [])

  const updatePrefs = useCallback((patch: Partial<TodoPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch }
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // Modalità privata o storage pieno: le preferenze valgono per la sessione.
      }
      return next
    })
  }, [])

  // Finché era un riquadro in dashboard un errore di caricamento si poteva
  // ignorare; qui è la pagina, quindi si dice cosa è andato storto.
  useEffect(() => {
    loadStandaloneTasks().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Impossibile caricare le attività')
    })
  }, [loadStandaloneTasks])

  const matchesArea = useCallback(
    (task: Task) => areaFilter === 'all' || taskArea(task) === areaFilter,
    [areaFilter]
  )

  const openTasks = useMemo(() => standaloneTasks.filter(matchesArea), [standaloneTasks, matchesArea])
  const doneTasks = useMemo(
    () => completedStandaloneTasks.filter(matchesArea),
    [completedStandaloneTasks, matchesArea]
  )

  // Le fatte stanno sulla lavagna solo quando hanno una colonna dove stare
  // (raggruppamento per avanzamento) o quando le si chiede esplicitamente.
  const boardTasks = useMemo(
    () => (grouping === 'progress' || showDone ? [...openTasks, ...doneTasks] : openTasks),
    [grouping, showDone, openTasks, doneTasks]
  )

  const buckets = useMemo(() => {
    const grouped: Record<TodoBucket, Task[]> = { overdue: [], today: [], week: [], later: [], unplanned: [] }
    for (const task of openTasks) grouped[todoBucket(task, today)].push(task)
    for (const key of Object.keys(grouped) as TodoBucket[]) {
      grouped[key] = sortTodoTasks(grouped[key], sort)
    }
    return grouped
  }, [openTasks, today, sort])

  const counters = useMemo(
    () => ({
      today: buckets.today.length + buckets.overdue.length,
      running: openTasks.filter((task) => taskProgressState(task) === 'in_progress').length,
      overdue: buckets.overdue.length,
    }),
    [buckets, openTasks]
  )

  const ganttWindowStart = useMemo(() => shiftDays(today, ganttOffset - 2), [today, ganttOffset])

  const unplannedForGantt = useMemo(
    () => openTasks.filter((task) => !task.start_date && !task.due_date),
    [openTasks]
  )

  const openTask = useMemo(
    () => (openTaskId ? [...openTasks, ...doneTasks].find((task) => task.id === openTaskId) || null : null),
    [openTaskId, openTasks, doneTasks]
  )

  async function handleCapture(event: React.FormEvent) {
    event.preventDefault()
    const text = captureTitle.trim()
    if (!text || capturing) return
    setCapturing(true)
    try {
      await createStandaloneTask({ title: text, area: captureArea })
      setCaptureTitle('')
      setError(null)
      showToast('Aggiunta')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Impossibile aggiungere l’attività')
    } finally {
      setCapturing(false)
    }
  }

  const patchTask = useCallback(
    async (taskId: string, payload: StandaloneTaskPatch) => {
      try {
        await updateStandaloneTask(taskId, payload)
        setError(null)
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Aggiornamento non riuscito')
      }
    },
    [updateStandaloneTask, showToast]
  )

  const removeTask = useCallback(
    async (taskId: string) => {
      try {
        await deleteStandaloneTask(taskId)
        setOpenTaskId((previous) => (previous === taskId ? null : previous))
        showToast('Eliminata')
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Eliminazione non riuscita')
      }
    },
    [deleteStandaloneTask, showToast]
  )

  /** Trascinamento: la colonna d'arrivo decide cosa cambia sull'attività. */
  const moveTask = useCallback(
    async (task: Task, columnKey: string) => {
      const move = todoDropPatch(task, grouping, columnKey, today)
      if (!move) return
      setBusyId(task.id)
      try {
        await updateStandaloneTask(task.id, move.patch)
        showToast(move.message)
        setError(null)
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Spostamento non riuscito')
      } finally {
        setBusyId(null)
      }
    },
    [grouping, today, updateStandaloneTask, showToast]
  )

  const toggleDone = useCallback(
    async (task: Task) => {
      setBusyId(task.id)
      try {
        await updateStandaloneTask(task.id, { status: task.status === 'done' ? 'pending' : 'done' })
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Aggiornamento non riuscito')
      } finally {
        setBusyId(null)
      }
    },
    [updateStandaloneTask, showToast]
  )

  const quickAdd = useCallback(
    async (columnKey: string, title: string) => {
      try {
        await createStandaloneTask({
          title,
          area: areaFilter === 'all' ? 'speaqi' : areaFilter,
          ...todoColumnDefaults(grouping, columnKey, today),
        })
        setError(null)
        showToast('Aggiunta')
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Impossibile aggiungere l’attività')
      }
    },
    [createStandaloneTask, areaFilter, grouping, today, showToast]
  )

  function renderRow(task: Task) {
    return (
      <TodoRow
        key={task.id}
        task={task}
        today={today}
        expanded={openTaskId === task.id}
        onToggleExpanded={() => setOpenTaskId((previous) => (previous === task.id ? null : task.id))}
        onPatch={(payload) => patchTask(task.id, payload)}
        onDelete={() => removeTask(task.id)}
      />
    )
  }

  return (
    <main className={`todo-page ${view === 'board' ? 'is-board' : ''}`}>
      <header className="todo-hero">
        <div>
          <span className="todo-eyebrow">La tua giornata</span>
          <h1>To Do</h1>
          <p className="todo-hero-sub">
            {today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · tutto quello che
            devi fare, Speaqi e non.
          </p>
        </div>
        <div className="todo-counters">
          <div className="todo-counter">
            <strong>{counters.today}</strong>
            <span>da fare oggi</span>
          </div>
          <div className="todo-counter">
            <strong>{counters.running}</strong>
            <span>in corso</span>
          </div>
          <div className={`todo-counter ${counters.overdue > 0 ? 'alert' : ''}`}>
            <strong>{counters.overdue}</strong>
            <span>arretrate</span>
          </div>
        </div>
      </header>

      {error && <div className="todo-alert">{error}</div>}

      <form className="todo-capture" onSubmit={handleCapture}>
        <input
          className="todo-capture-input"
          type="text"
          value={captureTitle}
          onChange={(e) => setCaptureTitle(e.target.value)}
          placeholder="Scrivi cosa devi fare e premi Invio…"
          disabled={capturing}
        />
        <div className="todo-capture-areas">
          {TODO_AREAS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`todo-chip area-${option.key} ${captureArea === option.key ? 'active' : ''}`}
              onClick={() => setCaptureArea(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={capturing || !captureTitle.trim()}>
          Aggiungi
        </button>
      </form>

      <div className="todo-toolbar">
        <div className="todo-filters">
          <button
            type="button"
            className={`todo-chip ${areaFilter === 'all' ? 'active' : ''}`}
            onClick={() => updatePrefs({ area: 'all' })}
          >
            Tutte
          </button>
          {TODO_AREAS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`todo-chip area-${option.key} ${areaFilter === option.key ? 'active' : ''}`}
              onClick={() => updatePrefs({ area: option.key })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="todo-views">
          <div className="todo-segmented">
            <button type="button" className={view === 'board' ? 'active' : ''} onClick={() => updatePrefs({ view: 'board' })}>
              Lavagna
            </button>
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => updatePrefs({ view: 'list' })}>
              Lista
            </button>
            <button type="button" className={view === 'gantt' ? 'active' : ''} onClick={() => updatePrefs({ view: 'gantt' })}>
              Gantt
            </button>
          </div>

          {view === 'board' && (
            <label className="todo-select">
              <span>Colonne</span>
              <select
                className="fi"
                value={grouping}
                onChange={(e) => updatePrefs({ grouping: e.target.value as TodoGrouping })}
              >
                {TODO_GROUPINGS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {view !== 'gantt' && (
            <label className="todo-select">
              <span>Ordina per</span>
              <select className="fi" value={sort} onChange={(e) => updatePrefs({ sort: e.target.value as TodoSort })}>
                {TODO_SORTS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(view === 'list' || (view === 'board' && grouping !== 'progress')) && (
            <label className="todo-switch">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => updatePrefs({ showDone: e.target.checked })}
              />
              <span>Mostra fatte ({doneTasks.length})</span>
            </label>
          )}

          {view === 'gantt' && (
            <div className="todo-gantt-nav">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGanttOffset((o) => o - 7)}>
                ‹
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGanttOffset(0)}>
                Oggi
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGanttOffset((o) => o + 7)}>
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {view === 'board' && (
        <TodoKanban
          tasks={boardTasks}
          today={today}
          grouping={grouping}
          sort={sort}
          busyId={busyId}
          onOpen={setOpenTaskId}
          onToggleDone={toggleDone}
          onMove={moveTask}
          onQuickAdd={quickAdd}
        />
      )}

      {view === 'list' && (
        <div className="todo-lists">
          {openTasks.length === 0 && (
            <div className="todo-empty">
              Niente in lista. Scrivi qui sopra la prima cosa che ti viene in mente e decidi dopo quando farla.
            </div>
          )}

          {BUCKET_META.map((bucket) => {
            const items = buckets[bucket.key]
            if (items.length === 0) return null
            return (
              <section key={bucket.key} className={`todo-group bucket-${bucket.key}`}>
                <h2>
                  {bucket.icon} {bucket.label}
                  <span>{items.length}</span>
                </h2>
                <div className="todo-group-body">{items.map(renderRow)}</div>
              </section>
            )
          })}

          {showDone && (
            <section className="todo-group bucket-done">
              <h2>
                ✅ Fatte<span>{doneTasks.length}</span>
              </h2>
              <div className="todo-group-body">
                {doneTasks.length === 0 ? (
                  <div className="todo-empty">Ancora niente di chiuso in quest’area.</div>
                ) : (
                  sortTodoTasks(doneTasks, sort).map(renderRow)
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {view === 'gantt' && (
        <div className="todo-gantt-wrap">
          <TodoGantt
            tasks={openTasks}
            today={today}
            windowStart={ganttWindowStart}
            windowDays={GANTT_WINDOW_DAYS}
            selectedId={openTaskId}
            onSelect={(taskId) => setOpenTaskId((previous) => (previous === taskId ? null : taskId))}
          />

          {unplannedForGantt.length > 0 && (
            <section className="todo-unplanned">
              <h2>
                📥 Non pianificate<span>{unplannedForGantt.length}</span>
              </h2>
              <p>Dai un inizio o una scadenza per vederle sulla timeline.</p>
              <div className="todo-unplanned-body">
                {unplannedForGantt.map((task) => (
                  <div key={task.id} className={`todo-unplanned-item area-${taskArea(task)}`}>
                    <span className="todo-unplanned-title">{task.title || 'Senza titolo'}</span>
                    <label>
                      <span>Inizio</span>
                      <TodoDateField
                        label="Inizio"
                        value={task.start_date}
                        onCommit={(iso) => patchTask(task.id, { start_date: iso })}
                      />
                    </label>
                    <label>
                      <span>Scadenza</span>
                      <TodoDateField
                        label="Scadenza"
                        value={task.due_date}
                        onCommit={(iso) => patchTask(task.id, { due_date: iso })}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* La scheda aperta usa la stessa riga della lista: un solo posto dove si
          modificano titolo, date, avanzamento e area. */}
      <Modal
        open={view !== 'list' && Boolean(openTask)}
        onClose={() => setOpenTaskId(null)}
        title={openTask?.title || 'Attività'}
      >
        {openTask && (
          <div className="todo-modal-body">
            <TodoRow
              task={openTask}
              today={today}
              expanded
              onToggleExpanded={() => setOpenTaskId(null)}
              onPatch={(payload) => patchTask(openTask.id, payload)}
              onDelete={() => removeTask(openTask.id)}
            />
          </div>
        )}
      </Modal>
    </main>
  )
}
