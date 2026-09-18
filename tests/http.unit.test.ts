/**
 * `selectByIdChunks`: il 18 settembre 2026 `/api/automation/followups` ha
 * fallito a ogni esecuzione con un 400 `{"message":"Bad Request"}` — un
 * `.in('contact_id', ids)` con 1.285 UUID nella stessa richiesta supera il
 * limite di lunghezza URL del gateway davanti a Supabase, che risponde prima
 * ancora che PostgREST veda la query. La funzione esiste per non poterlo
 * rifare: divide sempre in blocchi, qualunque sia la dimensione dell'elenco.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { chunk, selectByIdChunks } from '../src/lib/server/http'

describe('chunk', () => {
  test('divide in blocchi della dimensione richiesta', () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  })

  test('un array vuoto non produce blocchi', () => {
    assert.deepEqual(chunk([], 3), [])
  })

  test('un array piu corto della dimensione resta un blocco solo', () => {
    assert.deepEqual(chunk([1, 2], 10), [[1, 2]])
  })
})

describe('selectByIdChunks', () => {
  test('nessuna chiamata mette piu id del limite in un solo .in()', async () => {
    const ids = Array.from({ length: 1285 }, (_, index) => `id-${index}`)
    const seenGroupSizes: number[] = []

    const rows = await selectByIdChunks<{ id: string }>(ids, 200, async (group) => {
      seenGroupSizes.push(group.length)
      return { data: group.map((id) => ({ id })), error: null }
    })

    assert.equal(rows.length, ids.length)
    // 6 blocchi da 200, l'ultimo da 85: mai un solo .in() con tutti gli id.
    assert.deepEqual(seenGroupSizes, [200, 200, 200, 200, 200, 200, 85])
    assert.ok(seenGroupSizes.every((size) => size <= 200))
  })

  test('un elenco vuoto non fa nessuna chiamata', async () => {
    let calls = 0
    const rows = await selectByIdChunks<unknown>([], 200, async () => {
      calls += 1
      return { data: [], error: null }
    })
    assert.equal(calls, 0)
    assert.deepEqual(rows, [])
  })

  test('un errore su un blocco interrompe e si propaga', async () => {
    const ids = Array.from({ length: 5 }, (_, index) => `id-${index}`)
    let calls = 0
    await assert.rejects(
      () =>
        selectByIdChunks<unknown>(ids, 2, async () => {
          calls += 1
          if (calls === 2) return { data: null, error: new Error('Bad Request') }
          return { data: [{}], error: null }
        }),
      /Bad Request/
    )
    // Il terzo blocco non doveva partire: un errore ferma il giro, non lo salta.
    assert.equal(calls, 2)
  })

  test('un blocco con piu righe del limite PostgREST si legge a pagine', async () => {
    // Un blocco di soli 200 id non basta: PostgREST tronca ogni risposta a
    // `db-max-rows` righe (1000 di default) senza segnalarlo. Una tabella con
    // più di mille task per lo stesso blocco di contatti restituiva solo le
    // prime mille, silenziosamente — la riga mancante era proprio quella che
    // serviva a riconoscere un duplicato gia' esistente.
    const total = 2500
    const allRows = Array.from({ length: total }, (_, index) => ({ id: `row-${index}` }))
    const seenRanges: Array<{ from: number; to: number }> = []

    const rows = await selectByIdChunks<{ id: string }>(
      ['a'],
      200,
      async (_group, range) => {
        seenRanges.push(range)
        return { data: allRows.slice(range.from, range.to + 1), error: null }
      },
      1000
    )

    assert.equal(rows.length, total)
    assert.deepEqual(seenRanges, [
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ])
  })
})
