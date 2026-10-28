import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { GMAIL_OAUTH_STATE_TTL_MS, checkGmailOAuthState, gmailOAuthCookieOptions } from '../src/lib/server/gmail-oauth-state'

const now = Date.parse('2026-10-27T10:00:00Z')
const fresh = new Date(now - 60_000).toISOString()

describe('state OAuth di Gmail', () => {
  test('stesso browser, entro dieci minuti: valido', () => {
    assert.deepEqual(checkGmailOAuthState({ state: 'abc', cookieState: 'abc', createdAt: fresh, now }), { ok: true })
  })

  test('link di Google aperto in un altro browser: rifiutato', () => {
    assert.equal(checkGmailOAuthState({ state: 'abc', cookieState: undefined, createdAt: fresh, now }).ok, false)
    assert.equal(checkGmailOAuthState({ state: 'abc', cookieState: 'xyz', createdAt: fresh, now }).ok, false)
    assert.equal(checkGmailOAuthState({ state: 'abc', cookieState: 'abcd', createdAt: fresh, now }).ok, false)
  })

  test('scaduto o senza data: rifiutato', () => {
    const old = new Date(now - GMAIL_OAUTH_STATE_TTL_MS - 1).toISOString()
    assert.equal(checkGmailOAuthState({ state: 'abc', cookieState: 'abc', createdAt: old, now }).ok, false)
    assert.equal(checkGmailOAuthState({ state: 'abc', cookieState: 'abc', createdAt: null, now }).ok, false)
  })

  test('cookie HttpOnly, solo sotto /api/gmail, che torna dalla navigazione verso Google', () => {
    const options = gmailOAuthCookieOptions()
    assert.equal(options.httpOnly, true)
    assert.equal(options.sameSite, 'lax')
    assert.equal(options.path, '/api/gmail')
    assert.equal(options.maxAge, 600)
  })
})
