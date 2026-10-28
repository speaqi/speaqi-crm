import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedSummary, clearSummaryCache } from '../src/lib/server/summary-cache'

test('una richiesta sola per chiave, poi dalla cache', async () => {
  clearSummaryCache()
  let calls = 0
  const load = async () => { calls++; return { n: calls } }
  const [a, b] = await Promise.all([cachedSummary('k', load, () => 0), cachedSummary('k', load, () => 0)])
  assert.equal(calls, 1)
  assert.deepEqual(a, b)
  await cachedSummary('k', load, () => 10_000)
  assert.equal(calls, 1)
})

test('scaduta: risponde subito coi numeri di prima e ricalcola dietro', async () => {
  clearSummaryCache()
  let calls = 0
  const load = async () => ({ n: ++calls })
  await cachedSummary('k', load, () => 0)
  const stale = await cachedSummary('k', load, () => 20_000)
  assert.deepEqual(stale, { n: 1 })
  await new Promise((r) => setImmediate(r))
  assert.equal(calls, 2)
  assert.deepEqual(await cachedSummary('k', load, () => 21_000), { n: 2 })
})

test('troppo vecchia: aspetta il ricalcolo; un errore dietro non toglie i numeri', async () => {
  clearSummaryCache()
  await cachedSummary('k', async () => ({ n: 1 }), () => 0)
  assert.deepEqual(await cachedSummary('k', async () => ({ n: 2 }), () => 11 * 60_000), { n: 2 })
  const kept = await cachedSummary('k', async () => { throw new Error('giù') }, () => 11 * 60_000 + 20_000)
  assert.deepEqual(kept, { n: 2 })
  await new Promise((r) => setImmediate(r))
})
