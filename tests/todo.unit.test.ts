/**
 * Lavagna To Do: le regole che decidono dove finisce una scheda e cosa succede
 * quando la si trascina. Sono pure, ma sbagliarle significa spostare la
 * scadenza di un'attività senza che nessuno l'abbia chiesto.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  TODO_GROUPINGS,
  compareTodoTasks,
  sortTodoTasks,
  todoColumnDefaults,
  todoColumnKey,
  todoDropPatch,
} from '../src/lib/todo'
import type { Task } from '../src/types'

const TODAY = new Date(2026, 8, 16, 0, 0, 0, 0) // 16 settembre 2026, ora locale

function dayIso(offsetDays: number, hour = 9) {
  const date = new Date(TODAY)
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: 'todo',
    title: 'Fare una cosa',
    status: 'pending',
    area: 'speaqi',
    progress_state: 'todo',
    progress_percent: 0,
    priority: 'medium',
    due_date: null,
    created_at: dayIso(-10),
    updated_at: dayIso(-10),
    ...overrides,
  }
}

describe('colonne della lavagna', () => {
  test('nessun raggruppamento supera le quattro colonne', () => {
    for (const grouping of TODO_GROUPINGS) {
      assert.ok(
        grouping.columns.length > 0 && grouping.columns.length <= 4,
        `${grouping.key}: ${grouping.columns.length} colonne`
      )
    }
  })

  test('le arretrate stanno nella colonna di oggi, non in una colonna loro', () => {
    const late = task({ due_date: dayIso(-3) })
    assert.equal(todoColumnKey(late, 'when', TODAY), 'today')
    assert.equal(todoColumnKey(task({ due_date: dayIso(0) }), 'when', TODAY), 'today')
    assert.equal(todoColumnKey(task({ due_date: dayIso(3) }), 'when', TODAY), 'week')
    assert.equal(todoColumnKey(task({ due_date: dayIso(30) }), 'when', TODAY), 'later')
    assert.equal(todoColumnKey(task(), 'when', TODAY), 'unplanned')
  })

  test('avanzamento, area e priorità leggono il campo corrispondente', () => {
    assert.equal(todoColumnKey(task({ progress_state: 'blocked' }), 'progress', TODAY), 'blocked')
    assert.equal(todoColumnKey(task({ area: 'personale' }), 'area', TODAY), 'personale')
    assert.equal(todoColumnKey(task({ priority: 'high' }), 'priority', TODAY), 'high')
    // Priorità assente = media: la colonna esiste sempre.
    assert.equal(todoColumnKey(task({ priority: null }), 'priority', TODAY), 'medium')
  })
})

describe('trascinamento', () => {
  test('lasciare la scheda dov’è non produce nessuna modifica', () => {
    assert.equal(todoDropPatch(task({ progress_state: 'todo' }), 'progress', 'todo', TODAY), null)
    assert.equal(todoDropPatch(task({ area: 'speaqi' }), 'area', 'speaqi', TODAY), null)
    assert.equal(todoDropPatch(task({ due_date: dayIso(3) }), 'when', 'week', TODAY), null)
    assert.equal(todoDropPatch(task(), 'when', 'unplanned', TODAY), null)
  })

  test('una arretrata lasciata su "Oggi" viene ridatata a oggi', () => {
    const move = todoDropPatch(task({ due_date: dayIso(-4) }), 'when', 'today', TODAY)
    assert.ok(move)
    const due = new Date(String(move.patch.due_date))
    assert.equal(due.getDate(), TODAY.getDate())
    assert.equal(due.getMonth(), TODAY.getMonth())
  })

  test('le colonne di "Quando" scrivono la data giusta', () => {
    const week = todoDropPatch(task({ due_date: dayIso(0) }), 'when', 'week', TODAY)
    assert.ok(week)
    assert.equal(new Date(String(week.patch.due_date)).getDate(), 17)

    const later = todoDropPatch(task({ due_date: dayIso(0) }), 'when', 'later', TODAY)
    assert.ok(later)
    assert.equal(new Date(String(later.patch.due_date)).getDate(), 23)

    const unplanned = todoDropPatch(task({ due_date: dayIso(0) }), 'when', 'unplanned', TODAY)
    assert.ok(unplanned)
    assert.equal(unplanned.patch.due_date, null)
  })

  test('avanzamento, area e priorità cambiano solo il proprio campo', () => {
    const done = todoDropPatch(task(), 'progress', 'done', TODAY)
    assert.deepEqual(done?.patch, { progress_state: 'done' })

    const moved = todoDropPatch(task(), 'area', 'personale', TODAY)
    assert.deepEqual(moved?.patch, { area: 'personale' })

    const urgent = todoDropPatch(task(), 'priority', 'high', TODAY)
    assert.deepEqual(urgent?.patch, { priority: 'high' })
  })

  test('una colonna inesistente non produce modifiche', () => {
    assert.equal(todoDropPatch(task(), 'progress', 'inventata', TODAY), null)
    assert.equal(todoDropPatch(task(), 'when', 'inventata', TODAY), null)
  })
})

describe('ordinamenti', () => {
  test('per priorità: prima le alte, poi la scadenza più vicina', () => {
    const low = task({ id: 'a', priority: 'low', due_date: dayIso(1) })
    const high = task({ id: 'b', priority: 'high', due_date: dayIso(20) })
    const mediumSoon = task({ id: 'c', priority: 'medium', due_date: dayIso(2) })
    const mediumLate = task({ id: 'd', priority: 'medium', due_date: dayIso(9) })

    const sorted = sortTodoTasks([low, mediumLate, high, mediumSoon], 'priority')
    assert.deepEqual(sorted.map((t) => t.id), ['b', 'c', 'd', 'a'])
  })

  test('per scadenza: chi non ha data finisce in fondo', () => {
    const undated = task({ id: 'a' })
    const soon = task({ id: 'b', due_date: dayIso(1) })
    const sorted = sortTodoTasks([undated, soon], 'due')
    assert.deepEqual(sorted.map((t) => t.id), ['b', 'a'])
  })

  test('per avanzamento: prima quelle su cui stai lavorando', () => {
    const idle = task({ id: 'a', progress_state: 'todo' })
    const running = task({ id: 'b', progress_state: 'in_progress', progress_percent: 25 })
    const almost = task({ id: 'c', progress_state: 'in_progress', progress_percent: 75 })
    const sorted = sortTodoTasks([idle, running, almost], 'progress')
    assert.deepEqual(sorted.map((t) => t.id), ['c', 'b', 'a'])
  })

  test('a parità di tutto l’ordine è stabile', () => {
    const left = task({ id: 'aaa' })
    const right = task({ id: 'bbb' })
    assert.ok(compareTodoTasks(left, right, 'priority') < 0)
    assert.ok(compareTodoTasks(right, left, 'priority') > 0)
    assert.equal(compareTodoTasks(left, left, 'priority'), 0)
  })

  test('sortTodoTasks non tocca l’array di partenza', () => {
    const list = [task({ id: 'a', priority: 'low' }), task({ id: 'b', priority: 'high' })]
    sortTodoTasks(list, 'priority')
    assert.deepEqual(list.map((t) => t.id), ['a', 'b'])
  })
})

describe('attività scritta dentro una colonna', () => {
  test('nasce già con i valori della colonna', () => {
    assert.deepEqual(todoColumnDefaults('area', 'personale', TODAY), { area: 'personale' })
    assert.deepEqual(todoColumnDefaults('priority', 'high', TODAY), { priority: 'high' })
    assert.deepEqual(todoColumnDefaults('progress', 'in_progress', TODAY), { progress_state: 'in_progress' })
    assert.deepEqual(todoColumnDefaults('when', 'unplanned', TODAY), {})

    const todayDefaults = todoColumnDefaults('when', 'today', TODAY)
    assert.ok(todayDefaults.due_date)
    assert.equal(new Date(String(todayDefaults.due_date)).getDate(), TODAY.getDate())
  })
})
