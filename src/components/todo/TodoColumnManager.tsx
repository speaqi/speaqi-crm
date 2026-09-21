'use client'

import { useState } from 'react'
import { TODO_COLUMN_TONES, sortBoardColumns, todoColumns, type TodoGrouping } from '@/lib/todo'
import type { TodoBoardColumn } from '@/types'

/**
 * Il pannello delle colonne. Fa due cose diverse che sembrano una sola:
 *
 * - decide **quali colonne guardare**. "Fatte" occupa un quarto della lavagna
 *   per roba che non si guarda più: chi la spegne non sta cancellando niente,
 *   sta togliendola dalla vista, ed è per questo che la scelta resta nel
 *   browser e non sul database;
 * - decide **cosa sono le colonne aggiunte a mano**: nome, colore, ordine.
 *   Qui si scrive davvero, e cancellarne una rimanda le sue schede nella
 *   colonna che gli spetterebbe per data o per stato, invece di portarsele via.
 *
 * Aggiungerne una si fa dalla lavagna, non da qui: la si vuole vedere comparire
 * dove si sta guardando.
 */

interface TodoColumnManagerProps {
  grouping: TodoGrouping
  customColumns: TodoBoardColumn[]
  hiddenKeys: string[]
  onToggleHidden: (key: string) => void
  onRename: (columnId: string, label: string) => Promise<void>
  onRetone: (columnId: string, tone: string) => Promise<void>
  onDelete: (columnId: string) => Promise<void>
  onReorder: (orderedIds: string[]) => Promise<void>
  onClose: () => void
}

export function TodoColumnManager({
  grouping,
  customColumns,
  hiddenKeys,
  onToggleHidden,
  onRename,
  onRetone,
  onDelete,
  onReorder,
  onClose,
}: TodoColumnManagerProps) {
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')

  const hidden = new Set(hiddenKeys)
  const columns = todoColumns(grouping, customColumns)
  const ordered = sortBoardColumns(customColumns)

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function commitRename(columnId: string) {
    const label = editingLabel.trim()
    setEditingId(null)
    const current = ordered.find((column) => column.id === columnId)
    if (!label || !current || label === current.label) return
    await run(() => onRename(columnId, label))
  }

  async function move(columnId: string, delta: number) {
    const ids = ordered.map((column) => column.id)
    const index = ids.indexOf(columnId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ids.length) return
    ids.splice(target, 0, ids.splice(index, 1)[0])
    await run(() => onReorder(ids))
  }

  return (
    <div className="todo-columns-panel">
      <header className="todo-columns-head">
        <h2>Colonne</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Chiudi
        </button>
      </header>

      <section className="todo-columns-section">
        <h3>Cosa vedere</h3>
        <p className="todo-columns-note">
          Vale per questa lavagna e per questo browser: le attività restano dove sono.
        </p>
        <div className="todo-columns-visibility">
          {columns.map((column) => (
            <label key={column.key} className={`todo-columns-check tone-${column.tone}`}>
              <input
                type="checkbox"
                checked={!hidden.has(column.key)}
                onChange={() => onToggleHidden(column.key)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="todo-columns-section">
        <h3>Colonne aggiunte da te</h3>
        {ordered.length === 0 ? (
          <p className="todo-columns-note">
            Ancora nessuna. Il riquadro “+ Aggiungi colonna” in fondo alla lavagna ne crea una con il nome
            che vuoi; le colonne che aggiungi si vedono in tutti i raggruppamenti.
          </p>
        ) : (
          <p className="todo-columns-note">
            Cancellarne una non cancella le attività: tornano nella colonna che gli spetta per data o per
            stato.
          </p>
        )}

        <ul className="todo-columns-list">
          {ordered.map((column, index) => (
            <li key={column.id} className={`todo-columns-item tone-${column.tone}`}>
              {editingId === column.id ? (
                <input
                  className="fi"
                  autoFocus
                  value={editingLabel}
                  disabled={busy}
                  onChange={(event) => setEditingLabel(event.target.value)}
                  onBlur={() => void commitRename(column.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void commitRename(column.id)
                    if (event.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="todo-columns-name"
                  title="Rinomina"
                  onClick={() => {
                    setEditingId(column.id)
                    setEditingLabel(column.label)
                  }}
                >
                  {column.label}
                </button>
              )}

              <select
                className="fi todo-columns-tone"
                value={column.tone}
                disabled={busy}
                onChange={(event) => void run(() => onRetone(column.id, event.target.value))}
              >
                {TODO_COLUMN_TONES.map((tone) => (
                  <option key={tone.key} value={tone.key}>
                    {tone.label}
                  </option>
                ))}
              </select>

              <div className="todo-columns-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Sposta a sinistra"
                  disabled={busy || index === 0}
                  onClick={() => void move(column.id, -1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Sposta a destra"
                  disabled={busy || index === ordered.length - 1}
                  onClick={() => void move(column.id, 1)}
                >
                  ›
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm todo-columns-delete"
                  title="Elimina la colonna (le attività restano)"
                  disabled={busy}
                  onClick={() => void run(() => onDelete(column.id))}
                >
                  Elimina
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
