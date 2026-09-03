'use client'

import { useEffect, useState } from 'react'
import {
  TODO_AREAS,
  TODO_PERCENT_STEPS,
  TODO_PROGRESS_STATES,
  dateInputToIso,
  dateInputValue,
  formatDayMonth,
  formatFullDate,
  isTaskOverdue,
  shiftIsoDays,
  taskArea,
  taskProgressPercent,
  taskProgressState,
} from '@/lib/todo'
import type { StandaloneTaskPatch, Task, TodoArea } from '@/types'

interface TodoRowProps {
  task: Task
  today: Date
  expanded: boolean
  onToggleExpanded: () => void
  onPatch: (payload: StandaloneTaskPatch) => Promise<void>
  onDelete: () => Promise<void>
}

export function TodoRow({ task, today, expanded, onToggleExpanded, onPatch, onDelete }: TodoRowProps) {
  const area = taskArea(task)
  const state = taskProgressState(task)
  const percent = taskProgressPercent(task)
  const done = task.status === 'done'
  const overdue = isTaskOverdue(task, today)

  const [title, setTitle] = useState(task.title || '')
  const [note, setNote] = useState(task.note || '')
  const [busy, setBusy] = useState(false)

  // Il server può riscrivere titolo e nota (o la riga può cambiare da un'altra
  // scheda): quando arriva una versione nuova l'editor si riallinea.
  useEffect(() => { setTitle(task.title || '') }, [task.title])
  useEffect(() => { setNote(task.note || '') }, [task.note])

  async function patch(payload: StandaloneTaskPatch) {
    if (busy) return
    setBusy(true)
    try {
      await onPatch(payload)
    } finally {
      setBusy(false)
    }
  }

  const dueLabel = formatDayMonth(task.due_date)
  const startLabel = formatDayMonth(task.start_date)
  const createdLabel = formatFullDate(task.created_at)

  return (
    <div className={`todo-row area-${area} state-${state} ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
      <div className="todo-row-main">
        <button
          type="button"
          className="todo-check"
          aria-pressed={done}
          title={done ? 'Riapri' : 'Segna come fatta'}
          disabled={busy}
          onClick={() => patch({ status: done ? 'pending' : 'done' })}
        >
          {done ? '✓' : ''}
        </button>

        <button type="button" className="todo-row-open" onClick={onToggleExpanded} aria-expanded={expanded}>
          <span className="todo-row-title">{task.title || task.note || 'Senza titolo'}</span>
          <span className="todo-row-tags">
            <span className={`todo-area-badge area-${area}`}>{TODO_AREAS.find((a) => a.key === area)?.label}</span>
            <span className={`todo-state-badge state-${state}`}>
              {TODO_PROGRESS_STATES.find((s) => s.key === state)?.label}
            </span>
            {!done && percent > 0 && <span className="todo-percent-badge">{percent}%</span>}
            {startLabel && <span className="todo-row-date">▸ {startLabel}</span>}
            {dueLabel && <span className={`todo-row-date ${overdue ? 'late' : ''}`}>⏱ {dueLabel}</span>}
          </span>
        </button>

        <div className="todo-row-bar" aria-hidden="true">
          <span className="todo-row-bar-fill" style={{ width: `${percent}%` }} />
        </div>

        <span className="todo-row-chevron">{expanded ? '▴' : '▾'}</span>
      </div>

      {expanded && (
        <div className="todo-row-detail">
          <label className="todo-field todo-field-wide">
            <span>Titolo</span>
            <input
              className="fi"
              type="text"
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const next = title.trim()
                if (next && next !== (task.title || '')) void patch({ title: next })
                else setTitle(task.title || '')
              }}
            />
          </label>

          <div className="todo-field">
            <span>Stato di avanzamento</span>
            <div className="todo-segmented">
              {TODO_PROGRESS_STATES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={state === option.key ? 'active' : ''}
                  disabled={busy}
                  onClick={() => patch({ progress_state: option.key })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="todo-field">
            <span>Completamento</span>
            <div className="todo-segmented">
              {TODO_PERCENT_STEPS.map((step) => (
                <button
                  key={step}
                  type="button"
                  className={percent === step ? 'active' : ''}
                  disabled={busy}
                  onClick={() => patch({ progress_percent: step })}
                >
                  {step}%
                </button>
              ))}
            </div>
          </div>

          <div className="todo-field">
            <span>Area</span>
            <div className="todo-segmented">
              {TODO_AREAS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={area === option.key ? `active area-${option.key}` : ''}
                  disabled={busy}
                  onClick={() => patch({ area: option.key as TodoArea })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="todo-field">
            <span>Inizio</span>
            <input
              className="fi"
              type="date"
              value={dateInputValue(task.start_date)}
              onChange={(e) => patch({ start_date: dateInputToIso(e.target.value) })}
            />
          </label>

          <label className="todo-field">
            <span>Scadenza</span>
            <input
              className="fi"
              type="date"
              value={dateInputValue(task.due_date)}
              onChange={(e) => patch({ due_date: dateInputToIso(e.target.value) })}
            />
          </label>

          <label className="todo-field">
            <span>Priorità</span>
            <select
              className="fi"
              value={task.priority || 'medium'}
              onChange={(e) => patch({ priority: e.target.value as 'low' | 'medium' | 'high' })}
            >
              <option value="low">Bassa</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
            </select>
          </label>

          <label className="todo-field todo-field-wide">
            <span>Nota</span>
            <textarea
              className="fi"
              rows={2}
              value={note}
              disabled={busy}
              placeholder="Dettagli, link, contesto…"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note.trim() !== (task.note || '')) void patch({ note: note.trim() || null })
              }}
            />
          </label>

          <div className="todo-row-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => patch({ due_date: shiftIsoDays(task.due_date, 7) })}
            >
              +7 giorni
            </button>

            {task.calendar_event_link ? (
              <>
                <a className="btn btn-ghost btn-sm" href={task.calendar_event_link} target="_blank" rel="noreferrer">
                  ↗ Calendario
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => patch({ calendar_action: 'unsync' })}
                >
                  Togli dal calendario
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy || !task.due_date || done}
                title={task.due_date ? 'Aggiungi al tuo Google Calendar' : 'Scegli prima una scadenza'}
                onClick={() => patch({ calendar_action: 'sync' })}
              >
                + Calendario
              </button>
            )}

            <button
              type="button"
              className="btn btn-ghost btn-sm todo-danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Eliminare “${task.title || 'questa attività'}”?`)) void onDelete()
              }}
            >
              Elimina
            </button>

            <span className="todo-row-meta">
              {createdLabel && <>Inserita il {createdLabel}</>}
              {Number(task.reschedule_count || 0) > 0 && <> · {task.reschedule_count} rinvii</>}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
