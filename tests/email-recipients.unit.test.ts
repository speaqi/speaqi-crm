import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isWorkspaceRecipient, singleRecipient } from '../src/lib/server/email-recipients'

function fakeSupabase(rows: Record<string, Array<{ user_id: string; email: string }>>) {
  const calls: Array<{ table: string; userId: string; pattern: string }> = []
  return {
    calls,
    from(table: string) {
      const filter = { table, userId: '', pattern: '' }
      const chain = {
        select: () => chain,
        eq: (_column: string, value: string) => ((filter.userId = value), chain),
        ilike: (_column: string, value: string) => ((filter.pattern = value), chain),
        limit: () => chain,
        maybeSingle: async () => {
          calls.push({ ...filter })
          // ilike senza jolly: confronto senza maiuscole, con \_ e \% letterali.
          const literal = filter.pattern.replace(/\\([\\%_])/g, '$1').toLowerCase()
          const hit = (rows[table] || []).find(
            (row) => row.user_id === filter.userId && row.email.toLowerCase() === literal
          )
          return { data: hit ? { id: 'x' } : null, error: null }
        },
      }
      return chain
    },
  }
}

describe('destinatari delle email scritte da chi chiama', () => {
  test('un solo indirizzo valido', () => {
    assert.equal(singleRecipient(' Mario@Example.IT '), 'mario@example.it')
    assert.equal(singleRecipient('a@x.it, b@y.it'), null)
    assert.equal(singleRecipient('Mario <mario@x.it>'), null)
    assert.equal(singleRecipient(['a@x.it']), null)
    assert.equal(singleRecipient(''), null)
    // '*' e' un jolly per PostgREST: "a*@x.it" passerebbe grazie a "alice@x.it".
    assert.equal(singleRecipient('a*@example.com'), null)
  })

  test('contatto o membro del team dello stesso workspace', async () => {
    const supabase = fakeSupabase({
      contacts: [{ user_id: 'w1', email: 'Cliente@x.it' }],
      team_members: [{ user_id: 'w1', email: 'collega@speaqi.it' }],
    })
    assert.equal(await isWorkspaceRecipient(supabase, 'w1', 'cliente@x.it'), true)
    assert.equal(await isWorkspaceRecipient(supabase, 'w1', 'collega@speaqi.it'), true)
    assert.equal(await isWorkspaceRecipient(supabase, 'w1', 'sconosciuto@x.it'), false)
    // Il contatto di un altro workspace non vale.
    assert.equal(await isWorkspaceRecipient(supabase, 'w2', 'cliente@x.it'), false)
  })

  test('_ e % nell’indirizzo non diventano jolly', async () => {
    const supabase = fakeSupabase({ contacts: [{ user_id: 'w1', email: 'a_b@x.it' }] })
    assert.equal(await isWorkspaceRecipient(supabase, 'w1', 'a_b@x.it'), true)
    assert.equal(supabase.calls[0].pattern, 'a\\_b@x.it')
    assert.equal(await isWorkspaceRecipient(supabase, 'w1', 'axb@x.it'), false)
  })
})
