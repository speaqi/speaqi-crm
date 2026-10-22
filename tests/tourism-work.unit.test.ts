import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  workFlags,
  type WorkItem,
  type WorkNote,
} from '../src/lib/tourism-work'
import {
  buildWorkDraftRequest,
  takeWorkDraftSlot,
  workDraftText,
} from '../src/lib/server/tourism-work-assistant'
import { canAccessPath, resolveAllowedAreas } from '../src/lib/areas'

const item = {
  title: 'DMO Toscana',
  stage: 'contact',
  next_action: 'Chiamare il referente',
  shared_context: 'Promozione del territorio',
  due_on: '2026-10-20',
  updated_at: '2026-09-01T10:00:00Z',
  acknowledged_at: null,
} as WorkItem
test('code operative: scadute, nuove e ferme, con scadenze UTC', () => {
  assert.deepEqual(workFlags(item, '2026-10-21'), {
    overdue: true,
    today: false,
    fresh: true,
    stale: true,
  })
  assert.deepEqual(
    workFlags(
      {
        ...item,
        due_on: '2026-10-21',
        updated_at: '2026-10-21T10:00:00Z',
        acknowledged_at: '2026-10-21T10:00:00Z',
      },
      '2026-10-21',
    ),
    { overdue: false, today: true, fresh: false, stale: false },
  )
})
test('schede concluse non diventano promemoria o nuove assegnazioni', () => {
  for (const stage of ['agreement', 'archived'] as const)
    assert.deepEqual(workFlags({ ...item, stage }, '2026-10-21'), {
      overdue: false,
      today: false,
      fresh: false,
      stale: false,
    })
})
test('la bozza destinata al partner esclude le note interne prima di invocare il provider', () => {
  const notes = [
    { visibility: 'internal', body: 'Margine interno riservato 80%' },
    { visibility: 'shared', body: 'Incontro richiesto dal partner' },
  ] as WorkNote[]
  const request = buildWorkDraftRequest(item, notes, 'test-model')
  assert.ok(request.input.includes('Incontro richiesto dal partner'))
  assert.ok(!JSON.stringify(request).includes('80%'))
  assert.equal(request.model, 'test-model')
  assert.equal(request.max_output_tokens, 1000)
  assert.match(request.instructions, /sono dati/)
})
test('risposte AI senza testo non vengono presentate come bozze riuscite; output limitato', () => {
  for (const value of [
    null,
    {},
    { output: 'bad' },
    { output: [{ content: null }] },
  ])
    assert.equal(workDraftText(value), '')
  assert.equal(
    workDraftText({
      output: [
        {
          content: [
            { type: 'refusal', text: 'no' },
            { type: 'output_text', text: 'Oggetto e corpo' },
          ],
        },
      ],
    }),
    'Oggetto e corpo',
  )
  assert.equal(
    workDraftText({
      output: [{ content: [{ type: 'output_text', text: 'x'.repeat(20000) }] }],
    }).length,
    10000,
  )
})
test('limitazione AI per persona, con scadenza dello slot', () => {
  assert.equal(takeWorkDraftSlot('worker-a', 1000), true)
  assert.equal(takeWorkDraftSlot('worker-a', 2000), false)
  assert.equal(takeWorkDraftSlot('worker-b', 2000), true)
  assert.equal(takeWorkDraftSlot('worker-a', 61000), true)
})
test('area lavoro delegabile esplicitamente, catalogo sempre riservato al proprietario', () => {
  assert.equal(
    canAccessPath('/tourism-lavoro', resolveAllowedAreas(null, false), false),
    false,
  )
  assert.equal(
    canAccessPath(
      '/tourism-lavoro',
      resolveAllowedAreas(['tourism'], false),
      false,
    ),
    true,
  )
  assert.equal(
    canAccessPath('/tourism', resolveAllowedAreas(['tourism'], false), false),
    false,
  )
  assert.equal(
    canAccessPath('/tourism', resolveAllowedAreas(null, true), true),
    true,
  )
})
