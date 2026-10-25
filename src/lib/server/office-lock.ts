import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * La password dell'Ufficio (`UFFICIO_PASSWORD`): un secondo lucchetto sopra il login del titolare,
 * per la scena 3D e per tutte le API `/api/office`. Senza la variabile l'Ufficio resta aperto come prima.
 * La password non sta mai nel codice né nel cookie: il cookie è un'impronta legata a password,
 * titolare e segreto del server, quindi cambiare la password chiude fuori tutti.
 */
export const OFFICE_LOCK_COOKIE = 'speaqi_ufficio'
export const OFFICE_LOCK_DAYS = 30
const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 15 * 60_000

const password = () => (process.env.UFFICIO_PASSWORD || '').trim()
const secret = () => process.env.AGENCY_RENDER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || password()

export function officeLockEnabled() {
  return password().length > 0
}

export function officeLockToken(userId: string) {
  return createHmac('sha256', secret()).update(`ufficio:${userId}:${password()}`).digest('hex')
}

function same(left: string, right: string) {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b) && left.length === right.length
}

export function officePasswordMatches(given: string) {
  return officeLockEnabled() && same(given.trim(), password())
}

export function officeUnlocked(request: NextRequest, userId: string) {
  if (!officeLockEnabled()) return true
  const cookie = request.cookies.get(OFFICE_LOCK_COOKIE)?.value || ''
  return cookie.length > 0 && same(cookie, officeLockToken(userId))
}

export function officeLockedResponse() {
  return Response.json({ error: 'L’Ufficio è chiuso: serve la password.', locked: true }, { status: 423 })
}

// Tentativi sbagliati per titolare, in memoria del processo: bastano a fermare chi prova a indovinare.
const failures = new Map<string, number[]>()

export function officeLockBlocked(userId: string, now = Date.now()) {
  const recent = (failures.get(userId) || []).filter((at) => now - at < FAILURE_WINDOW_MS)
  failures.set(userId, recent)
  return recent.length >= MAX_FAILURES
}

export function noteOfficeLockFailure(userId: string, now = Date.now()) {
  failures.set(userId, [...(failures.get(userId) || []).filter((at) => now - at < FAILURE_WINDOW_MS), now])
}

export function clearOfficeLockFailures(userId: string) {
  failures.delete(userId)
}
