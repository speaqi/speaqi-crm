import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import {
  OFFICE_LOCK_COOKIE, OFFICE_LOCK_DAYS, clearOfficeLockFailures, noteOfficeLockFailure,
  officeLockBlocked, officeLockEnabled, officeLockToken, officePasswordMatches, officeUnlocked,
} from '@/lib/server/office-lock'

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api' }

/** Stato del lucchetto: la pagina dell'Ufficio chiede la password solo se serve. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  return Response.json({ enabled: officeLockEnabled(), locked: !officeUnlocked(request, auth.userId) })
}

/** La password giusta apre l'Ufficio per 30 giorni su questo browser. */
export async function POST(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  if (!officeLockEnabled()) return Response.json({ locked: false })
  if (officeLockBlocked(auth.userId)) return Response.json({ error: 'Troppi tentativi: riprova fra un quarto d’ora.' }, { status: 429 })
  const body = await request.json().catch(() => null) as { password?: unknown } | null
  const given = typeof body?.password === 'string' ? body.password.slice(0, 200) : ''
  if (!officePasswordMatches(given)) {
    noteOfficeLockFailure(auth.userId)
    return Response.json({ error: 'Password sbagliata.' }, { status: 401 })
  }
  clearOfficeLockFailures(auth.userId)
  const response = NextResponse.json({ locked: false })
  response.cookies.set(OFFICE_LOCK_COOKIE, officeLockToken(auth.userId), { ...cookieOptions, maxAge: OFFICE_LOCK_DAYS * 24 * 3600 })
  return response
}

/** «Chiudi l'Ufficio»: su questo browser serve di nuovo la password. */
export async function DELETE(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  const response = NextResponse.json({ locked: officeLockEnabled() })
  response.cookies.set(OFFICE_LOCK_COOKIE, '', { ...cookieOptions, maxAge: 0 })
  return response
}
