import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import {
  OFFICE_LOCK_COOKIE, noteOfficeLockFailure, officeLockBlocked, officeLockEnabled, officeLockToken,
  officePasswordMatches, officeUnlocked,
} from '../src/lib/server/office-lock'

const USER = '11111111-1111-4111-8111-111111111111'
const request = (cookie?: string) => new NextRequest('https://crm.example.com/api/office', {
  headers: cookie ? { cookie: `${OFFICE_LOCK_COOKIE}=${cookie}` } : {},
})

function withPassword(value: string | undefined, run: () => void) {
  const before = process.env.UFFICIO_PASSWORD
  if (value === undefined) delete process.env.UFFICIO_PASSWORD
  else process.env.UFFICIO_PASSWORD = value
  try { run() } finally {
    if (before === undefined) delete process.env.UFFICIO_PASSWORD
    else process.env.UFFICIO_PASSWORD = before
  }
}

describe('lucchetto dell’Ufficio', () => {
  test('senza UFFICIO_PASSWORD l’Ufficio resta aperto come prima', () => withPassword(undefined, () => {
    assert.equal(officeLockEnabled(), false)
    assert.equal(officeUnlocked(request(), USER), true)
    assert.equal(officePasswordMatches(''), false)
  }))

  test('con la password serve il cookie giusto, e cambiarla chiude fuori tutti', () => {
    let token = ''
    withPassword('cavallo-blu-42', () => {
      assert.equal(officeUnlocked(request(), USER), false)
      assert.equal(officePasswordMatches('cavallo-blu-42'), true)
      assert.equal(officePasswordMatches('cavallo-blu-4'), false)
      token = officeLockToken(USER)
      assert.doesNotMatch(token, /cavallo/)
      assert.equal(officeUnlocked(request(token), USER), true)
      assert.equal(officeUnlocked(request('x'.repeat(64)), USER), false)
      // Un cookie copiato scade comunque: l'ora di emissione è firmata.
      const old = officeLockToken(USER, Date.now() - 31 * 24 * 3600_000)
      assert.equal(officeUnlocked(request(old), USER), false)
      const forged = `${Date.now()}.${token.split('.')[1]}`
      assert.equal(officeUnlocked(request(forged), USER), false)
      // Il cookie di un titolare non apre l'Ufficio di un altro.
      assert.equal(officeUnlocked(request(token), '22222222-2222-4222-8222-222222222222'), false)
    })
    withPassword('password-nuova', () => assert.equal(officeUnlocked(request(token), USER), false))
  })

  test('dopo dieci tentativi sbagliati si aspetta un quarto d’ora', () => {
    const user = '33333333-3333-4333-8333-333333333333'
    const now = Date.now()
    for (let i = 0; i < 9; i++) noteOfficeLockFailure(user, now)
    assert.equal(officeLockBlocked(user, now), false)
    noteOfficeLockFailure(user, now)
    assert.equal(officeLockBlocked(user, now), true)
    assert.equal(officeLockBlocked(user, now + 16 * 60_000), false)
  })
})
