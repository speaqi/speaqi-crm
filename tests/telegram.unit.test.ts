/**
 * Il canale Telegram che scrive nel To Do. Qui si prova la parte che decide
 * cosa finisce nel database: un vocale capito male non deve poter creare
 * attività fantasma, e un aggiornamento deve colpire una riga che esiste.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { extractAudio, isAllowedChat, matchesWebhookSecret } from '../src/lib/server/telegram'
import {
  appendVoiceNote,
  formatTodoReply,
  normalizeTodoActions,
  normalizeVoiceDate,
  updatePayloadFor,
} from '../src/lib/server/todo-voice'
import type { Task } from '../src/types'

const CONTEXT = {
  tasks: [
    { id: 'task-1', title: 'Chiamare Rossi' },
    { id: 'task-2', title: 'Preventivo Bianchi' },
  ],
  columns: [{ id: 'col-a', label: 'Da fatturare' }],
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: 'todo',
    title: 'Chiamare Rossi',
    status: 'pending',
    progress_state: 'todo',
    progress_percent: 0,
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

describe('autorizzazione del bot', () => {
  const config = { token: 't', webhookSecret: 'segreto-lungo', allowedChatIds: ['4242', '77'] }

  test('il segreto del webhook si confronta per intero', () => {
    assert.equal(matchesWebhookSecret('segreto-lungo', config.webhookSecret), true)
    assert.equal(matchesWebhookSecret('segreto-lung', config.webhookSecret), false)
    assert.equal(matchesWebhookSecret('', config.webhookSecret), false)
  })

  test('solo le chat elencate possono scrivere nel CRM', () => {
    assert.equal(isAllowedChat(config, 4242), true)
    assert.equal(isAllowedChat(config, '77'), true)
    assert.equal(isAllowedChat(config, 4243), false)
    assert.equal(isAllowedChat(config, null), false)
  })
})

describe('riconoscimento del vocale nel messaggio', () => {
  test('nota vocale, audio e video-nota sono tutti audio', () => {
    assert.equal(extractAudio({ voice: { file_id: 'v1' } })?.fileId, 'v1')
    assert.equal(extractAudio({ audio: { file_id: 'a1' } })?.fileId, 'a1')
    assert.equal(extractAudio({ video_note: { file_id: 'n1' } })?.fileId, 'n1')
  })

  test('un allegato che non è audio non viene scaricato', () => {
    assert.equal(extractAudio({ document: { file_id: 'd1', mime_type: 'application/pdf' } }), null)
    assert.equal(extractAudio({ text: 'ciao' }), null)
  })
})

describe('dal parlato alle azioni', () => {
  test('una cosa nuova diventa una creazione con i valori di riserva', () => {
    const actions = normalizeTodoActions(
      { actions: [{ op: 'create', title: 'Chiamare il commercialista' }] },
      CONTEXT
    )
    assert.equal(actions.length, 1)
    assert.deepEqual(actions[0], {
      op: 'create',
      title: 'Chiamare il commercialista',
      area: 'speaqi',
      priority: 'medium',
      dueDate: null,
      note: null,
      progressState: null,
      boardColumnId: null,
    })
  })

  test('un aggiornamento su un id inventato viene buttato', () => {
    const actions = normalizeTodoActions(
      { actions: [{ op: 'update', task_id: 'task-999', status: 'done' }] },
      CONTEXT
    )
    assert.deepEqual(actions, [])
  })

  test('una creazione senza titolo non crea niente', () => {
    assert.deepEqual(normalizeTodoActions({ actions: [{ op: 'create', title: '   ' }] }, CONTEXT), [])
  })

  test('un aggiornamento che non cambia niente non si scrive', () => {
    assert.deepEqual(normalizeTodoActions({ actions: [{ op: 'update', task_id: 'task-1' }] }, CONTEXT), [])
  })

  test('una colonna inventata non finisce sull’attività', () => {
    const [action] = normalizeTodoActions(
      { actions: [{ op: 'create', title: 'Fattura Rossi', board_column_id: 'col-zzz' }] },
      CONTEXT
    )
    assert.equal(action.op === 'create' && action.boardColumnId, null)
  })

  test('una risposta senza azioni non rompe niente', () => {
    assert.deepEqual(normalizeTodoActions({}, CONTEXT), [])
    assert.deepEqual(normalizeTodoActions(null, CONTEXT), [])
  })

  test('un giorno secco viene ancorato alle 9 locali, non a mezzanotte', () => {
    const iso = normalizeVoiceDate('2026-09-22')
    assert.ok(iso)
    assert.equal(new Date(iso as string).getHours(), 9)
    assert.equal(normalizeVoiceDate('non una data'), null)
    assert.equal(normalizeVoiceDate(''), null)
  })
})

describe('cosa viene scritto sull’attività', () => {
  const now = new Date('2026-09-21T10:00:00.000Z')

  test('"ho finito" chiude e porta al 100%', () => {
    const [action] = normalizeTodoActions(
      { actions: [{ op: 'update', task_id: 'task-1', status: 'done' }] },
      CONTEXT
    )
    const payload = updatePayloadFor(action as any, task(), now)
    assert.equal(payload.status, 'done')
    assert.equal(payload.progress_percent, 100)
    assert.equal(payload.progress_state, 'done')
  })

  test('"sono a metà" non chiude e fa partire il cronometro', () => {
    const [action] = normalizeTodoActions(
      { actions: [{ op: 'update', task_id: 'task-1', progress_percent: 50 }] },
      CONTEXT
    )
    const payload = updatePayloadFor(action as any, task(), now)
    assert.equal(payload.status, 'pending')
    assert.equal(payload.progress_percent, 50)
    assert.equal(payload.started_at, now.toISOString())
  })

  test('spostare la scadenza conta come rinvio, come dalla pagina', () => {
    const [action] = normalizeTodoActions(
      { actions: [{ op: 'update', task_id: 'task-1', due_date: '2026-09-25' }] },
      CONTEXT
    )
    const payload = updatePayloadFor(action as any, task({ reschedule_count: 2 }), now)
    assert.equal(payload.reschedule_count, 3)
    assert.equal(payload.rescheduled_at, now.toISOString())
  })

  test('la nota dettata si aggiunge in fondo, non sostituisce', () => {
    const merged = appendVoiceNote('Prima nota', 'Richiamare dopo le 17', now)
    assert.match(merged, /Prima nota/)
    assert.match(merged, /Richiamare dopo le 17/)
    assert.equal(appendVoiceNote(null, 'Sola nota', now).includes('\n'), false)
  })
})

describe('risposta in chat', () => {
  test('dice cosa ha scritto', () => {
    const reply = formatTodoReply({ created: ['Chiamare Rossi'], updated: ['Preventivo — fatta ✓'], skipped: 0 }, 'ciao')
    assert.match(reply, /Chiamare Rossi/)
    assert.match(reply, /Preventivo — fatta/)
  })

  test('quando non ha capito, restituisce la trascrizione invece di tacere', () => {
    const reply = formatTodoReply({ created: [], updated: [], skipped: 0 }, 'bla bla bla')
    assert.match(reply, /Non ho capito/)
    assert.match(reply, /bla bla bla/)
  })
})
