import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadDeck, removeAsset, toView } from '@/lib/server/tourism-decks'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id, assetId } = await ctx.params
    if (!isUuid(id) || !isUuid(assetId)) throw new TourismInputError('ID non valido')
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const service = createServiceRoleClient()
    await removeAsset(auth.supabase, service, row, assetId)
    return tourismResponse(await toView(auth.supabase, service, row))
  } catch (error) {
    return tourismError(error)
  }
}
