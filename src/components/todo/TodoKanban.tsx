'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { TodoCard } from '@/components/todo/TodoCard'
import { sortTodoTasks, todoColumnKey, todoColumns, type TodoGrouping, type TodoSort } from '@/lib/todo'
import type { Task, TodoBoardColumn } from '@/types'

const DRAG_MIME = 'application/x-speaqi-todo'
/** Schede montate per colonna: una colonna con mille righe non si scorre comunque. */
const COLUMN_PAGE_SIZE = 40
/**
 * Fin qui la lavagna sta tutta in finestra; oltre, le colonne prendono una
 * larghezza fissa e ci si scorre di lato. Restringerle ancora vorrebbe dire
 * colonne dove il titolo di un'attività non ci sta.
 */
const COLUMNS_IN_WINDOW = 4

function closedTime(task: Task) {
  const raw = task.completed_at || task.updated_at
  const time = raw ? new Date(raw).getTime() : 0
  return Number.isNaN(time) ? 0 : time
}

function byMostRecentlyClosed(left: Task, right: Task) {
  const diff = closedTime(right) - closedTime(left)
  return diff !== 0 ? diff : left.id.localeCompare(right.id)
}

interface TodoKanbanProps {
  tasks: Task[]
  today: Date
  grouping: TodoGrouping
  customColumns: TodoBoardColumn[]
  /** Colonne che questa postazione ha scelto di non vedere. */
  hiddenKeys: string[]
  sort: TodoSort
  busyId: string | null
  onOpen: (taskId: string) => void
  onToggleDone: (task: Task) => void
  onMove: (task: Task, columnKey: string) => void
  onQuickAdd: (columnKey: string, title: string) => Promise<void>
}

export function TodoKanban({
  tasks,
  today,
  grouping,
  customColumns,
  hiddenKeys,
  sort,
  busyId,
  onOpen,
  onToggleDone,
  onMove,
  onQuickAdd,
}: TodoKanbanProps) {
  const columns = useMemo(() => {
    const hidden = new Set(hiddenKeys)
    const all = todoColumns(grouping, customColumns)
    const visible = all.filter((column) => !hidden.has(column.key))
    // Nascondere l'ultima colonna lascerebbe una lavagna senza colonne, cioè
    // una pagina bianca senza modo di tornare indietro trascinando.
    return visible.length > 0 ? visible : all
  }, [grouping, customColumns, hiddenKeys])

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, number>>({})

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>(columns.map((column) => [column.key, []]))
    for (const task of tasks) {
      const key = todoColumnKey(task, grouping, today, customColumns)
      const bucket = map.get(key)
      if (bucket) bucket.push(task)
    }
    for (const [key, list] of map) {
      // La colonna delle fatte si legge dall'ultima chiusa in giù: lì
      // "ordina per scadenza" non dice niente di utile.
      map.set(key, key === 'done' ? [...list].sort(byMostRecentlyClosed) : sortTodoTasks(list, sort))
    }
    return map
  }, [tasks, columns, customColumns, grouping, sort, today])

  function handleDragStart(event: DragEvent<HTMLElement>, task: Task) {
    event.dataTransfer.setData(DRAG_MIME, task.id)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingId(task.id)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverKey(null)
  }

  function handleDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverKey !== key) setDragOverKey(key)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>, key: string) {
    if (dragOverKey === key && !event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOverKey(null)
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>, key: string) {
    event.preventDefault()
    const taskId = event.dataTransfer.getData(DRAG_MIME)
    setDragOverKey(null)
    setDraggingId(null)
    if (!taskId) return
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task) onMove(task, key)
  }

  async function submitQuickAdd(key: string) {
    const title = addTitle.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      await onQuickAdd(key, title)
      setAddTitle('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      className={`todo-board ${columns.length > COLUMNS_IN_WINDOW ? 'is-scrolling' : ''}`}
      style={{ ['--todo-board-cols' as string]: String(columns.length) }}
    >
      {columns.map((column) => {
        const items = grouped.get(column.key) || []
        const limit = expanded[column.key] || COLUMN_PAGE_SIZE
        const visible = items.slice(0, limit)
        const hidden = items.length - visible.length

        return (
          <section
            key={column.key}
            className={`todo-col tone-${column.tone} ${dragOverKey === column.key ? 'is-drop-target' : ''}`}
            onDragOver={(event) => handleDragOver(event, column.key)}
            onDragLeave={(event) => handleDragLeave(event, column.key)}
            onDrop={(event) => handleDrop(event, column.key)}
          >
            <header className="todo-col-head">
              <div className="todo-col-title">
                <h2>{column.label}</h2>
                <span className="todo-col-count">{items.length}</span>
              </div>
              <p className="todo-col-hint">{column.hint}</p>
              <button
                type="button"
                className="todo-col-add"
                title={`Aggiungi in “${column.label}”`}
                onClick={() => {
                  setAddTitle('')
                  setAddingKey((previous) => (previous === column.key ? null : column.key))
                }}
              >
                +
              </button>
            </header>

            <div className="todo-col-body">
              {addingKey === column.key && (
                <form
                  className="todo-col-add-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void submitQuickAdd(column.key)
                  }}
                >
                  <input
                    className="fi"
                    autoFocus
                    type="text"
                    value={addTitle}
                    disabled={adding}
                    placeholder="Cosa devi fare…"
                    onChange={(event) => setAddTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setAddingKey(null)
                    }}
                  />
                  <div className="todo-col-add-actions">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={adding || !addTitle.trim()}>
                      Aggiungi
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingKey(null)}>
                      Chiudi
                    </button>
                  </div>
                </form>
              )}

              {items.length === 0 && addingKey !== column.key && (
                <p className="todo-col-empty">Trascina qui un’attività, o premi + per scriverne una.</p>
              )}

              {visible.map((task) => (
                <TodoCard
                  key={task.id}
                  task={task}
                  today={today}
                  grouping={grouping}
                  dragging={draggingId === task.id}
                  busy={busyId === task.id}
                  onOpen={() => onOpen(task.id)}
                  onToggleDone={() => onToggleDone(task)}
                  onDragStart={(event) => handleDragStart(event, task)}
                  onDragEnd={handleDragEnd}
                />
              ))}

              {hidden > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm col-more"
                  onClick={() =>
                    setExpanded((previous) => ({ ...previous, [column.key]: limit + COLUMN_PAGE_SIZE }))
                  }
                >
                  Mostra altre {hidden}
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
