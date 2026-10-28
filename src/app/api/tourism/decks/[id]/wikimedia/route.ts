import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { addWikimediaPhoto, loadDeck, toView } from '@/lib/server/tourism-decks'
import { searchWikimediaPhotos } from '@/lib/server/tourism-deck-photos'
import { isCommonsFileTitle } from '@/lib/tourism-deck-photos'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Foto da Wikimedia Commons scelte a mano dall'editor: GET cerca per nome, POST aggiunge un file
// dei risultati. Il browser manda solo il titolo del file: indirizzo, licenza e misure il server
// li rilegge da Commons.

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    await loadDeck(auth.supabase, auth.user.id, id)
    const q = request.nextUrl.searchParams.get('q') || ''
    return tourismResponse(await searchWikimediaPhotos(q))
  } catch (error) {
    return tourismError(error)
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    const body = await request.json().catch(() => null)
    if (!isCommonsFileTitle(body?.title)) throw new TourismInputError('Foto non valida')
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const service = createServiceRoleClient()
    const deck = await addWikimediaPhoto(auth.supabase, service, row, body.title)
    return tourismResponse(await toView(auth.supabase, service, deck), 201)
  } catch (error) {
    return tourismError(error)
  }
}
