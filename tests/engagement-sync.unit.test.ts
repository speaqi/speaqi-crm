import test from 'node:test'
import assert from 'node:assert/strict'
import { chunk, contactEngagementPatch, engagementRow, engagementRowChanged } from '../src/lib/engagement-sync'

test('riga campagna invariata: non si riscrive', () => {
  const next = engagementRow('a@b.it', { count: 2, lastAt: '2026-10-01T10:00:00Z', name: 'A' })
  assert.equal(engagementRowChanged({ email: 'a@b.it', name: 'A', open_count: 2, click_count: 0, last_open_at: '2026-10-01T10:00:00+00:00' }, next), false)
  assert.equal(engagementRowChanged(undefined, next), true)
  assert.equal(engagementRowChanged({ email: 'a@b.it', name: 'A', open_count: 1, click_count: 0, last_open_at: '2026-10-01T10:00:00Z' }, next), true)
})

test('contatto invariato: nessun UPDATE', () => {
  const contact = { email_open_count: 3, email_click_count: 1, last_email_open_at: '2026-10-01T10:00:00+00:00', last_email_click_at: '2026-10-02T10:00:00+00:00' }
  const r = contactEngagementPatch(contact, { count: 3, lastAt: '2026-10-01T10:00:00Z' }, { count: 1, lastAt: '2026-10-02T10:00:00Z' })
  assert.equal(r.patch, null)
  assert.equal(r.newOpens, 0)
})

test('contatori non scendono e la data non si cancella', () => {
  const contact = { email_open_count: 5, email_click_count: 0, last_email_open_at: '2026-10-01T10:00:00Z', last_email_click_at: null }
  const r = contactEngagementPatch(contact, { count: 2 }, { count: 1, lastAt: '2026-10-03T10:00:00Z' })
  assert.equal(r.newOpens, 0)
  assert.equal(r.newClicks, 1)
  assert.deepEqual(r.patch, { email_open_count: 5, email_click_count: 1, last_email_open_at: '2026-10-01T10:00:00Z', last_email_click_at: '2026-10-03T10:00:00Z' })
})

test('chunk', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})
