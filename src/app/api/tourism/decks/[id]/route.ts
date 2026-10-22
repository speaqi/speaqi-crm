import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismBody, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { deleteDeck, loadDeck, saveDeckEdits, toView } from '@/lib/server/tourism-decks'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }
async function deckId(ctx: Ctx) {
  const { id } = await ctx.params
  if (!isUuid(id)) throw new TourismInputError('ID non valido')
  return id
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const row = await loadDeck(auth.supabase, auth.user.id, await deckId(ctx))
    return tourismResponse(await toView(auth.supabase, createServiceRoleClient(), row))
  } catch (error) {
    return tourismError(error)
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const body = await tourismBody(request)
    const version = Number(body.version)
    if (!Number.isInteger(version) || version < 1) throw new TourismInputError('version richiesta')
    const row = await loadDeck(auth.supabase, auth.user.id, await deckId(ctx))
    const saved = await saveDeckEdits(auth.supabase, row, { version, slides: body.slides, title: body.title, notes: body.notes })
    return tourismResponse(await toView(auth.supabase, createServiceRoleClient(), saved))
  } catch (error) {
    return tourismError(error)
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const row = await loadDeck(auth.supabase, auth.user.id, await deckId(ctx))
    await deleteDeck(auth.supabase, createServiceRoleClient(), row)
    return tourismResponse({ deleted: true })
  } catch (error) {
    return tourismError(error)
  }
}
