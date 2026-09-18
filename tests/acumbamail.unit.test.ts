import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { acumbamailForm, acumbamailRequest } from '../src/lib/server/acumbamail-http'

// La coda distanzia le chiamate per endpoint. In prova serve a zero: qui si
// verifica il comportamento sul 429, non l'orologio.
process.env.ACUMBAMAIL_MIN_INTERVAL_MS = '0'
process.env.ACUMBAMAIL_MAX_ATTEMPTS = '3'

type Reply = { status: number; body: string; headers?: Record<string, string> }

const originalFetch = globalThis.fetch
let replies: Reply[] = []
let calls: string[] = []

function queueReplies(next: Reply[]) {
  replies = [...next]
  calls = []
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url))
    const reply = replies.shift() || { status: 200, body: '{}' }
    return new Response(reply.body, { status: reply.status, headers: reply.headers })
  }) as typeof fetch
}

describe('coda Acumbamail', () => {
  beforeEach(() => {
    replies = []
    calls = []
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('un 429 non e un errore: si aspetta e si riprova', async () => {
    // E' esattamente la risposta che ha lasciato a terra 46 email della
    // sequenza Wine il 13 settembre 2026.
    queueReplies([
      {
        status: 429,
        body: JSON.stringify({ status: 'error', message: 'Too Many Requests', retry_after_seconds: 0, policy: '10/m' }),
      },
      { status: 200, body: JSON.stringify({ id: '123' }) },
    ])

    const result = await acumbamailRequest('addMergeTag', acumbamailForm('token', { list_id: '1' }))

    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
    assert.deepEqual(result.payload, { id: '123' })
    assert.equal(calls.length, 2, 'la seconda chiamata e il ritentativo')
  })

  test('oltre il numero massimo di tentativi il 429 esce come tale', async () => {
    queueReplies([
      { status: 429, body: JSON.stringify({ retry_after_seconds: 0 }) },
      { status: 429, body: JSON.stringify({ retry_after_seconds: 0 }) },
      { status: 429, body: JSON.stringify({ retry_after_seconds: 0 }) },
    ])

    const result = await acumbamailRequest('addMergeTag', acumbamailForm('token'))

    assert.equal(result.ok, false)
    assert.equal(result.status, 429)
    assert.equal(calls.length, 3, 'un tentativo piu due ritentativi, poi si riporta')
  })

  test('un errore che non e un tetto non viene ritentato', async () => {
    queueReplies([{ status: 400, body: JSON.stringify({ message: 'list_id mancante' }) }])

    const result = await acumbamailRequest('addMergeTag', acumbamailForm('token'))

    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.equal(calls.length, 1, 'ritentare un difetto lo nasconderebbe soltanto')
  })

  test('le chiamate allo stesso endpoint non si sovrappongono', async () => {
    queueReplies([
      { status: 200, body: '{"a":1}' },
      { status: 200, body: '{"b":2}' },
      { status: 200, body: '{"c":3}' },
    ])

    const results = await Promise.all([
      acumbamailRequest('getCampaignOpeners', acumbamailForm('token', { campaign_id: '1' })),
      acumbamailRequest('getCampaignOpeners', acumbamailForm('token', { campaign_id: '2' })),
      acumbamailRequest('getCampaignOpeners', acumbamailForm('token', { campaign_id: '3' })),
    ])

    assert.equal(calls.length, 3)
    // In coda, quindi nell'ordine di partenza: senza serializzazione le tre
    // risposte finte arriverebbero in ordine arbitrario.
    assert.deepEqual(results.map((result) => result.payload), [{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  test('token e formato finiscono sempre nel corpo', () => {
    const form = acumbamailForm('segreto', { campaign_id: 42, extra: { nested: true } })
    assert.equal(form.get('auth_token'), 'segreto')
    assert.equal(form.get('response_type'), 'json')
    assert.equal(form.get('campaign_id'), '42')
    assert.equal(form.get('extra'), '{"nested":true}')
  })
})
