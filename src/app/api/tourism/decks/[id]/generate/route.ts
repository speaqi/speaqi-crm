import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismBody, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { generateIntoDeck, loadDeck, toView } from '@/lib/server/tourism-decks'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

/** Rigenera con l'agente, con una istruzione facoltativa ("più breve", "insisti sul mare"). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    const body = await tourismBody(request).catch(() => ({}) as Record<string, unknown>)
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const service = createServiceRoleClient()
    const deck = await generateIntoDeck(auth.supabase, service, row, typeof body.instruction === 'string' ? body.instruction : undefined)
    return tourismResponse(await toView(auth.supabase, service, deck))
  } catch (error) {
    return tourismError(error)
  }
}
