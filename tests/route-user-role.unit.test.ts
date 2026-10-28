import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveCallerMember } from '../src/lib/server/supabase'

type Row = { id: string; user_id: string; name: string; email: string; auth_user_id: string | null; created_at: string }

// Client finto: `fail` fa rispondere errore a ogni query.
function client(rows: Row[], fail = false) {
  return {
    from() {
      const filters: Array<(row: Row) => boolean> = []
      const chain: any = {
        select: () => chain,
        eq: (column: keyof Row, value: string) => (filters.push((row) => row[column] === value), chain),
        ilike: (column: keyof Row, value: string) =>
          (filters.push((row) => String(row[column]).toLowerCase() === value.toLowerCase()), chain),
        limit: async () =>
          fail
            ? { data: null, error: { message: 'timeout' } }
            : { data: rows.filter((row) => filters.every((f) => f(row))), error: null },
      }
      return chain
    },
  }
}

const member: Row = {
  id: 'm1',
  user_id: 'owner',
  name: 'Collega',
  email: 'collega@x.it',
  auth_user_id: 'collab',
  created_at: '2026-01-01T00:00:00Z',
}

describe('chi chiama: titolare solo se e certo', () => {
  test('collaboratore trovato col proprio JWT', async () => {
    const out = await resolveCallerMember(client([member]), 'collab', 'collega@x.it', () => client([], true))
    assert.equal(out.member?.user_id, 'owner')
    assert.equal(out.unresolved, false)
  })

  test('JWT in errore, service role lo trova', async () => {
    const out = await resolveCallerMember(client([], true), 'collab', 'collega@x.it', () => client([member]))
    assert.equal(out.member?.user_id, 'owner')
  })

  test('nessuna riga e ricerca riuscita: titolare del proprio spazio', async () => {
    const out = await resolveCallerMember(client([]), 'solo', 'solo@x.it', () => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
    })
    assert.equal(out.member, null)
    assert.equal(out.unresolved, false)
  })

  test('tutte e due le ricerche falliscono: non risolto, mai titolare', async () => {
    const out = await resolveCallerMember(client([member], true), 'collab', 'collega@x.it', () => client([member], true))
    assert.equal(out.member, null)
    assert.equal(out.unresolved, true)
  })

  test('JWT in errore e service role assente: non risolto', async () => {
    const out = await resolveCallerMember(client([member], true), 'collab', 'collega@x.it', () => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
    })
    assert.equal(out.unresolved, true)
  })
})
