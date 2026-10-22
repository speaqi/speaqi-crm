import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismError } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadDeck } from '@/lib/server/tourism-decks'
import { getOrCreateDeckPdf, pdfFileName } from '@/lib/server/tourism-deck-pdf'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Il PDF di una presentazione approvata (generato una volta per versione). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const pdf = await getOrCreateDeckPdf(createServiceRoleClient(), row)
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFileName(row.destination)}"`,
        'Cache-Control': 'private, no-store'
      }
    })
  } catch (error) {
    return tourismError(error)
  }
}
