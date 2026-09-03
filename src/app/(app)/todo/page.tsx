'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TodoGantt } from '@/components/todo/TodoGantt'
import { TodoRow } from '@/components/todo/TodoRow'
import { shiftDays, startOfDay } from '@/lib/schedule'
import {
  TODO_AREAS,
  dateInputToIso,
  dateInputValue,
  taskArea,
  taskProgressState,
  todoBucket,
  type TodoBucket,
} from '@/lib/todo'
import type { StandaloneTaskPatch, Task, TodoArea } from '@/types'
import { useCRMContext } from '../layout'

const GANTT_WINDOW_DAYS = 21

const BUCKET_META: { key: TodoBucket; label: string; icon: string }[] = [
  { key: 'overdue', label: 'In ritardo', icon: '⏰' },
  { key: 'today', label: 'Oggi', icon: '☀️' },
  { key: 'week', label: 'Prossimi 7 giorni', icon: '📆' },
  { key: 'later', label: 'Più avanti', icon: '🗓️' },
  { key: 'unplanned', label: 'Da pianificare', icon: '📥' },
]

type AreaFilter = TodoArea | 'all'

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
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all')
  const [view, setView] = useState<'list' | 'gantt'>('list')
  const [showDone, setShowDone] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [ganttOffset, setGanttOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(() => startOfDay(new Date()), [])

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

  const buckets = useMemo(() => {
    const grouped: Record<TodoBucket, Task[]> = { overdue: [], today: [], week: [], later: [], unplanned: [] }
    for (const task of openTasks) grouped[todoBucket(task, today)].push(task)
    for (const list of Object.values(grouped)) {
      list.sort((left, right) => {
        const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER
        const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER
        if (leftDue !== rightDue) return leftDue - rightDue
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
      })
    }
    return grouped
  }, [openTasks, today])

  const counters = useMemo(
    () => ({
      overdue: buckets.overdue.length,
      today: buckets.today.length,
      running: openTasks.filter((task) => taskProgressState(task) === 'in_progress').length,
    }),
    [buckets, openTasks]
  )

  const ganttWindowStart = useMemo(() => shiftDays(today, ganttOffset - 2), [today, ganttOffset])

  const unplannedForGantt = useMemo(
    () => openTasks.filter((task) => !task.start_date && !task.due_date),
    [openTasks]
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
        if (expandedId === taskId) setExpandedId(null)
        showToast('Eliminata')
      } catch (reason) {
        showToast(reason instanceof Error ? reason.message : 'Eliminazione non riuscita')
      }
    },
    [deleteStandaloneTask, expandedId, showToast]
  )

  function renderRow(task: Task) {
    return (
      <TodoRow
        key={task.id}
        task={task}
        today={today}
        expanded={expandedId === task.id}
        onToggleExpanded={() => setExpandedId((previous) => (previous === task.id ? null : task.id))}
        onPatch={(payload) => patchTask(task.id, payload)}
        onDelete={() => removeTask(task.id)}
      />
    )
  }

  return (
    <main className="todo-page">
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
          <div className={`todo-counter ${counters.overdue > 0 ? 'alert' : ''}`}>
            <strong>{counters.overdue}</strong>
            <span>in ritardo</span>
          </div>
          <div className="todo-counter">
            <strong>{counters.today}</strong>
            <span>oggi</span>
          </div>
          <div className="todo-counter">
            <strong>{counters.running}</strong>
            <span>in corso</span>
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
            onClick={() => setAreaFilter('all')}
          >
            Tutte
          </button>
          {TODO_AREAS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`todo-chip area-${option.key} ${areaFilter === option.key ? 'active' : ''}`}
              onClick={() => setAreaFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="todo-views">
          <div className="todo-segmented">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              Lista
            </button>
            <button type="button" className={view === 'gantt' ? 'active' : ''} onClick={() => setView('gantt')}>
              Gantt
            </button>
          </div>
          {view === 'list' && (
            <label className="todo-switch">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              <span>Mostra completate ({doneTasks.length})</span>
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

      {view === 'list' ? (
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
                ✅ Completate<span>{doneTasks.length}</span>
              </h2>
              <div className="todo-group-body">
                {doneTasks.length === 0 ? (
                  <div className="todo-empty">Ancora niente di chiuso in quest’area.</div>
                ) : (
                  doneTasks.map(renderRow)
                )}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="todo-gantt-wrap">
          <TodoGantt
            tasks={openTasks}
            today={today}
            windowStart={ganttWindowStart}
            windowDays={GANTT_WINDOW_DAYS}
            selectedId={expandedId}
            onSelect={(taskId) => setExpandedId((previous) => (previous === taskId ? null : taskId))}
          />

          {expandedId && openTasks.some((task) => task.id === expandedId) && (
            <div className="todo-gantt-detail">{renderRow(openTasks.find((task) => task.id === expandedId)!)}</div>
          )}

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
                      <input
                        className="fi"
                        type="date"
                        value={dateInputValue(task.start_date)}
                        onChange={(e) => patchTask(task.id, { start_date: dateInputToIso(e.target.value) })}
                      />
                    </label>
                    <label>
                      <span>Scadenza</span>
                      <input
                        className="fi"
                        type="date"
                        value={dateInputValue(task.due_date)}
                        onChange={(e) => patchTask(task.id, { due_date: dateInputToIso(e.target.value) })}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  )
}
