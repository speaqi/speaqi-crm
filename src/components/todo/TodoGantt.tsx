'use client'

import { useMemo } from 'react'
import { localDayDateKey, startOfDay } from '@/lib/schedule'
import {
  TODO_PROGRESS_STATES,
  isTaskOverdue,
  taskArea,
  taskProgressPercent,
  taskProgressState,
  taskSpan,
} from '@/lib/todo'
import type { Task } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000

interface TodoGanttProps {
  tasks: Task[]
  today: Date
  /** Primo giorno della finestra visibile. */
  windowStart: Date
  windowDays: number
  selectedId: string | null
  onSelect: (taskId: string) => void
}

function diffInDays(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

export function TodoGantt({ tasks, today, windowStart, windowDays, selectedId, onSelect }: TodoGanttProps) {
  const days = useMemo(() => {
    const start = startOfDay(windowStart)
    return Array.from({ length: windowDays }, (_, index) => {
      const date = new Date(start)
      date.setDate(date.getDate() + index)
      return date
    })
  }, [windowStart, windowDays])

  const rows = useMemo(() => {
    return tasks
      .map((task) => ({ task, span: taskSpan(task) }))
      .filter((row): row is { task: Task; span: { start: Date; end: Date } } => row.span !== null)
      .sort((left, right) => {
        const byStart = left.span.start.getTime() - right.span.start.getTime()
        return byStart !== 0 ? byStart : left.span.end.getTime() - right.span.end.getTime()
      })
  }, [tasks])

  const windowEnd = days[days.length - 1]

  // Righe fuori finestra: non le nascondiamo in silenzio, le contiamo.
  const visibleRows = rows.filter(({ span }) => span.end >= days[0] && span.start <= windowEnd)
  const hiddenCount = rows.length - visibleRows.length

  const todayOffset = diffInDays(days[0], today)
  const todayInWindow = todayOffset >= 0 && todayOffset < windowDays

  if (rows.length === 0) {
    return (
      <div className="todo-gantt-empty">
        Nessuna attività con una data. Dai un inizio o una scadenza a qualcosa e comparirà qui sulla timeline.
      </div>
    )
  }

  return (
    <div className="todo-gantt">
      <div className="todo-gantt-scroll">
        <div className="todo-gantt-grid" style={{ ['--todo-gantt-days' as string]: String(windowDays) }}>
          <div className="todo-gantt-head">
            <div className="todo-gantt-head-label">Attività</div>
            <div className="todo-gantt-head-days">
              {days.map((day) => {
                const weekend = day.getDay() === 0 || day.getDay() === 6
                const isToday = localDayDateKey(day) === localDayDateKey(today)
                return (
                  <div key={day.toISOString()} className={`todo-gantt-day ${weekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}>
                    <span className="todo-gantt-day-dow">{day.toLocaleDateString('it-IT', { weekday: 'narrow' })}</span>
                    <span className="todo-gantt-day-num">{day.getDate()}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {visibleRows.map(({ task, span }) => {
            const rawOffset = diffInDays(days[0], span.start)
            const rawLength = diffInDays(span.start, span.end) + 1
            const offset = Math.max(0, rawOffset)
            const length = Math.max(1, Math.min(rawLength + Math.min(0, rawOffset), windowDays - offset))
            const percent = taskProgressPercent(task)
            const state = taskProgressState(task)
            const area = taskArea(task)
            const overdue = isTaskOverdue(task, today)
            const continuesBefore = rawOffset < 0
            const continuesAfter = rawOffset + rawLength > windowDays

            return (
              <div
                key={task.id}
                className={`todo-gantt-row ${selectedId === task.id ? 'selected' : ''}`}
                onClick={() => onSelect(task.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(task.id)
                  }
                }}
              >
                <div className="todo-gantt-row-label" title={task.title || ''}>
                  <span className={`todo-gantt-dot area-${area}`} />
                  {task.title || 'Senza titolo'}
                </div>
                <div className="todo-gantt-track">
                  {days.map((day) => {
                    const weekend = day.getDay() === 0 || day.getDay() === 6
                    return <div key={day.toISOString()} className={`todo-gantt-cell ${weekend ? 'weekend' : ''}`} />
                  })}
                  {todayInWindow && (
                    <span
                      className="todo-gantt-today-line"
                      style={{ left: `${((todayOffset + 0.5) / windowDays) * 100}%` }}
                    />
                  )}
                  <span
                    className={`todo-gantt-bar area-${area} state-${state} ${overdue ? 'is-overdue' : ''} ${continuesBefore ? 'clip-start' : ''} ${continuesAfter ? 'clip-end' : ''}`}
                    style={{ left: `${(offset / windowDays) * 100}%`, width: `${(length / windowDays) * 100}%` }}
                    title={`${task.title || 'Attività'} — ${TODO_PROGRESS_STATES.find((s) => s.key === state)?.label}, ${percent}%`}
                  >
                    <span className="todo-gantt-bar-fill" style={{ width: `${percent}%` }} />
                    <span className="todo-gantt-bar-text">{percent}%</span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {hiddenCount > 0 && (
        <div className="todo-gantt-hidden">
          {hiddenCount} {hiddenCount === 1 ? 'attività è' : 'attività sono'} fuori da questa finestra: sposta le date o usa le frecce.
        </div>
      )}
    </div>
  )
}
