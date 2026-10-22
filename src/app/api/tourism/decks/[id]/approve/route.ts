import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismBody, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadDeck, setApproval, toView } from '@/lib/server/tourism-decks'
import { getOrCreateDeckPdf } from '@/lib/server/tourism-deck-pdf'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** { approve: true } approva (solo senza [DA VERIFICARE]); { approve: false } la riporta in revisione. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    const body = await tourismBody(request)
    if (typeof body.approve !== 'boolean') throw new TourismInputError('approve richiesto')
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const deck = await setApproval(auth.supabase, row, body.approve)
    const service = createServiceRoleClient()
    // Il PDF si prepara subito, così chi apre il link non aspetta Chromium. Se fallisce
    // non cambia nulla: si rigenera alla prima richiesta (il catch non è cosmetico, vedi patterns).
    if (body.approve) void getOrCreateDeckPdf(service, deck).catch((e) => console.error('PDF non preparato', { deck: deck.id, message: String(e?.message || e).slice(0, 300) }))
    return tourismResponse(await toView(auth.supabase, service, deck))
  } catch (error) {
    return tourismError(error)
  }
}
