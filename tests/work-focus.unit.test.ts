import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { nextWorkMorning, splitWorkQueue } from '../src/lib/work-focus'
import type { ScheduledCall } from '../src/lib/schedule'

const call = (id: string, due: string, extra: Record<string, unknown> = {}) =>
  ({ contact: { id, name: id, priority: 1, status: 'New', ...extra }, task: null, due_at: due, source: 'task', task_type: 'follow-up' }) as unknown as ScheduledCall

describe('splitWorkQueue', () => {
  const today = '2026-11-07'
  const calls = [
    call('focus-late', '2026-10-01T10:00:00'),
    call('other-late', '2026-09-01T10:00:00'),
    call('focus-today', '2026-11-07T15:00:00'),
    call('partner', '2026-08-01T10:00:00', { is_partner: true }),
    call('focus-future', '2026-11-09T10:00:00'),
  ]
  test('divide per focus e scadenza', () => {
    const r = splitWorkQueue(calls, new Set(['focus-late', 'focus-today', 'focus-future']), today)
    assert.deepEqual(r.now.map((c) => c.contact.id), ['focus-late', 'focus-today', 'partner'])
    assert.deepEqual(r.backlog.map((c) => c.contact.id), ['other-late'])
    assert.deepEqual(r.upcoming.map((c) => c.contact.id), ['focus-future'])
  })
  test('senza elenco focus nulla viene nascosto', () => {
    const r = splitWorkQueue(calls, null, today)
    assert.equal(r.backlog.length, 0)
    assert.equal(r.now.length, 4)
  })
})

describe('nextWorkMorning', () => {
  test('salta il weekend', () => {
    assert.equal(nextWorkMorning(new Date('2026-11-06T12:00:00')).getDay(), 1) // venerdì -> lunedì
  })
  test('extraDays sposta in avanti', () => {
    const d = nextWorkMorning(new Date('2026-11-02T12:00:00'), 7)
    assert.ok(d.getTime() > new Date('2026-11-09T00:00:00').getTime())
  })
})
