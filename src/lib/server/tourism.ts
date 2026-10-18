import { NextRequest } from 'next/server'
import { requireRouteUser } from './supabase'
import { TourismInputError } from '../tourism'

export async function requireTourismOwner(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth
  if (!auth.isAdmin || auth.user.id !== auth.workspaceUserId)
    return {
      error: Response.json(
        {
          error:
            'Tourism Intelligence è riservato al proprietario del workspace nel pilota'
        },
        { status: 403 }
      )
    }
  return auth
}
export function tourismResponse(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
export function tourismError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error
        ? String((error as { message?: string }).message || '')
        : ''
  if (/42P01|PGRST205/.test(String((error as { code?: string })?.code)))
    return tourismResponse(
      {
        error:
          'Schema Tourism Intelligence assente: applicare la migrazione del modulo al database CRM.'
      },
      503
    )
  if (
    error instanceof TourismInputError ||
    /invalid|requires|Required|not found|denied|Only verified|required|ambiguous|already used|already linked|matches require review|constraint|Immutable|Geographic cycle/i.test(
      message
    )
  )
    return tourismResponse({ error: message }, 400)
  if (/Version conflict|already running|retry limit|unavailable/i.test(message))
    return tourismResponse({ error: message }, 409)
  console.error('Tourism Intelligence operation failed', {
    code: (error as { code?: string })?.code,
    message: message.slice(0, 300)
  })
  return tourismResponse(
    {
      error:
        'Operazione non completata. Controllare configurazione e log del server.'
    },
    500
  )
}
export async function tourismBody(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 1_500_000)
    throw new TourismInputError('Richiesta troppo grande')
  const text = await request.text()
  if (text.length > 1_500_000)
    throw new TourismInputError('Richiesta troppo grande')
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new TourismInputError('JSON non valido')
  }
}
