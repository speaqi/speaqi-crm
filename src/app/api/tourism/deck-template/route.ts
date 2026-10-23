import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismBody, tourismError, tourismResponse } from '@/lib/server/tourism'
import { getTemplate, saveTemplate } from '@/lib/server/tourism-decks'
import { DECK_KINDS, DECK_VAR_NAMES, DEFAULT_DECK_KIND, isDeckKind, type DeckKind } from '@/lib/tourism-deck'
import { TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Senza indicazione vale la base delle destinazioni (client precedenti ai due modelli). */
function kindOf(value: unknown): DeckKind {
  if (value === undefined || value === null || value === '') return DEFAULT_DECK_KIND
  if (!isDeckKind(value)) throw new TourismInputError('Tipo di presentazione non valido')
  return value
}

/** I modelli di partenza delle presentazioni (uno per tipo): si leggono e si modificano qui. */
export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const kind = kindOf(request.nextUrl.searchParams.get('kind'))
    return tourismResponse({ ...(await getTemplate(auth.supabase, auth.user.id, kind)), kinds: DECK_KINDS, var_names: DECK_VAR_NAMES })
  } catch (error) {
    return tourismError(error)
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await tourismBody(request)
    const version = Number(body.version)
    if (!Number.isInteger(version) || version < 1) throw new TourismInputError('version richiesta')
    return tourismResponse(await saveTemplate(auth.supabase, auth.user.id, body.template, version, kindOf(body.kind)))
  } catch (error) {
    return tourismError(error)
  }
}
