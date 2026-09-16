'use client'

import type { DragEvent } from 'react'
import {
  TODO_AREAS,
  TODO_PRIORITIES,
  TODO_PROGRESS_STATES,
  formatDayMonth,
  isTaskOverdue,
  taskArea,
  taskPriority,
  taskProgressPercent,
  taskProgressState,
  type TodoGrouping,
} from '@/lib/todo'
import type { Task } from '@/types'

interface TodoCardProps {
  task: Task
  today: Date
  /** Serve solo a togliere dalla scheda l'etichetta che la colonna già dice. */
  grouping: TodoGrouping
  dragging: boolean
  busy: boolean
  onOpen: () => void
  onToggleDone: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

export function TodoCard({
  task,
  today,
  grouping,
  dragging,
  busy,
  onOpen,
  onToggleDone,
  onDragStart,
  onDragEnd,
}: TodoCardProps) {
  const area = taskArea(task)
  const state = taskProgressState(task)
  const priority = taskPriority(task)
  const percent = taskProgressPercent(task)
  const done = task.status === 'done'
  const overdue = isTaskOverdue(task, today)
  const dueLabel = formatDayMonth(task.due_date)

  const areaLabel = TODO_AREAS.find((option) => option.key === area)?.label
  const stateLabel = TODO_PROGRESS_STATES.find((option) => option.key === state)?.label
  const priorityLabel = TODO_PRIORITIES.find((option) => option.key === priority)?.label

  return (
    <article
      className={`todo-card area-${area} state-${state} priority-${priority} ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${dragging ? 'is-dragging' : ''}`}
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="todo-card-top">
        <button
          type="button"
          className="todo-check"
          aria-pressed={done}
          title={done ? 'Riapri' : 'Segna come fatta'}
          disabled={busy}
          onClick={onToggleDone}
        >
          {done ? '✓' : ''}
        </button>

        <button type="button" className="todo-card-open" onClick={onOpen} title="Apri i dettagli">
          {task.title || task.note || 'Senza titolo'}
        </button>
      </div>

      <div className="todo-card-tags">
        {grouping !== 'area' && <span className={`todo-area-badge area-${area}`}>{areaLabel}</span>}
        {grouping !== 'progress' && state !== 'todo' && (
          <span className={`todo-state-badge state-${state}`}>{stateLabel}</span>
        )}
        {grouping !== 'priority' && priority === 'high' && (
          <span className="todo-priority-badge">{priorityLabel}</span>
        )}
        {dueLabel && (
          <span className={`todo-row-date ${overdue ? 'late' : ''}`} title={overdue ? 'Era in scadenza prima di oggi' : 'Scadenza'}>
            {overdue ? '⚠' : '⏱'} {dueLabel}
          </span>
        )}
        {task.note && <span className="todo-card-note" title={task.note}>✎</span>}
      </div>

      {!done && percent > 0 && (
        <div className="todo-card-bar" aria-label={`Avanzamento ${percent}%`}>
          <span className="todo-card-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      )}
    </article>
  )
}
