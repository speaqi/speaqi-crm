import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismBody, tourismError, tourismResponse } from '@/lib/server/tourism'
import { getTemplate, saveTemplate } from '@/lib/server/tourism-decks'
import { DECK_VAR_NAMES } from '@/lib/tourism-deck'
import { TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Il modello di partenza di tutte le presentazioni: si legge e si modifica qui. */
export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    return tourismResponse({ ...(await getTemplate(auth.supabase, auth.user.id)), var_names: DECK_VAR_NAMES })
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
    return tourismResponse(await saveTemplate(auth.supabase, auth.user.id, body.template, version))
  } catch (error) {
    return tourismError(error)
  }
}
