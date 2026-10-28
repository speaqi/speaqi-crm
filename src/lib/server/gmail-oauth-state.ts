import { timingSafeEqual } from 'node:crypto'

/**
 * Lo state OAuth di Gmail vale solo nel browser che ha avviato il
 * collegamento, per dieci minuti e una volta sola. Prima era una riga a
 * database e basta: chi mandava a un'altra persona il link di Google col
 * proprio state si ritrovava la sua casella collegata al proprio account CRM.
 */
export const GMAIL_OAUTH_STATE_COOKIE = 'speaqi_gmail_oauth'
export const GMAIL_OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export function gmailOAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/gmail',
    maxAge: GMAIL_OAUTH_STATE_TTL_MS / 1000,
  }
}

export type GmailOAuthStateCheck = { ok: true } | { ok: false; reason: string }

export function checkGmailOAuthState(input: {
  state: string
  cookieState: string | null | undefined
  createdAt: string | null | undefined
  now?: number
}): GmailOAuthStateCheck {
  const expected = Buffer.from(input.state)
  const received = Buffer.from(input.cookieState || '')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'Collegamento avviato da un altro browser: riprova da questa pagina' }
  }
  const createdAt = input.createdAt ? Date.parse(input.createdAt) : Number.NaN
  if (!Number.isFinite(createdAt) || (input.now ?? Date.now()) - createdAt > GMAIL_OAUTH_STATE_TTL_MS) {
    return { ok: false, reason: 'Collegamento scaduto: riprova' }
  }
  return { ok: true }
}
