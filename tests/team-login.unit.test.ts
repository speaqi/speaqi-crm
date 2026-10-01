import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { FakeSupabase } from './fake-supabase'
import { TeamLoginError, ensureMemberLogin, setMemberPassword } from '../src/lib/server/team-login'

const WORKSPACE = 'owner-1'

type AuthUser = { id: string; email: string; password?: string }

function client(tables: ConstructorParameters<typeof FakeSupabase>[0], users: AuthUser[]) {
  const db = new FakeSupabase(tables) as any
  db.auth = {
    admin: {
      createUser: async ({ email, password }: { email: string; password: string }) => {
        if (users.some((user) => user.email === email)) {
          return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } }
        }
        const user = { id: `auth-${users.length + 1}`, email, password }
        users.push(user)
        return { data: { user }, error: null }
      },
      listUsers: async () => ({ data: { users }, error: null }),
      updateUserById: async (id: string, { password }: { password: string }) => {
        const user = users.find((candidate) => candidate.id === id)
        if (!user) return { data: null, error: { message: 'not found' } }
        user.password = password
        return { data: { user }, error: null }
      },
    },
  }
  return db
}

const scope = { workspaceUserId: WORKSPACE, currentUserId: WORKSPACE }

describe('accesso dei collaboratori', () => {
  test('crea un accesso nuovo', async () => {
    const users: AuthUser[] = []
    const result = await ensureMemberLogin(client({}, users), 'gianluca@x.it', 'segreta123', scope)
    assert.equal(result.reused, false)
    assert.equal(users[0].password, 'segreta123')
  })

  test('collaboratore rimosso e ricreato: riusa il vecchio accesso con la nuova password', async () => {
    const users: AuthUser[] = [{ id: 'orphan', email: 'gianluca@x.it', password: 'vecchia' }]
    const result = await ensureMemberLogin(client({ team_members: [], contacts: [] }, users), 'gianluca@x.it', 'nuova1234', scope)
    assert.deepEqual(result, { authUserId: 'orphan', reused: true })
    assert.equal(users[0].password, 'nuova1234')
  })

  test('non prende il titolare di un altro spazio di lavoro', async () => {
    const users: AuthUser[] = [{ id: 'owner-2', email: 'altro@x.it', password: 'sua' }]
    const db = client({ team_members: [], contacts: [{ id: 'c1', user_id: 'owner-2' }] }, users)
    await assert.rejects(ensureMemberLogin(db, 'altro@x.it', 'rubata123', scope), TeamLoginError)
    assert.equal(users[0].password, 'sua')
  })

  test('non prende un collaboratore di un altro team', async () => {
    const users: AuthUser[] = [{ id: 'auth-9', email: 'm@x.it', password: 'sua' }]
    const db = client({ team_members: [{ id: 'tm-9', user_id: 'owner-2', auth_user_id: 'auth-9' }], contacts: [] }, users)
    await assert.rejects(ensureMemberLogin(db, 'm@x.it', 'rubata123', scope), /altro team/)
    assert.equal(users[0].password, 'sua')
  })

  test('password troppo corta rifiutata prima di toccare Supabase', async () => {
    const users: AuthUser[] = []
    await assert.rejects(ensureMemberLogin(client({}, users), 'a@x.it', 'corta', scope), /almeno 8/)
    assert.equal(users.length, 0)
    await assert.rejects(setMemberPassword(client({}, users), 'x', 'corta'), /almeno 8/)
  })
})
