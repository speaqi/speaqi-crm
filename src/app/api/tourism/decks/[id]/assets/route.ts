import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { addAssets, loadDeck, toView, type UploadedFile } from '@/lib/server/tourism-decks'
import { MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, MAX_PHOTOS, MAX_PHOTO_BYTES } from '@/lib/server/tourism-deck-assets'
import { isUuid, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REQUEST_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + MAX_DOCUMENTS * MAX_DOCUMENT_BYTES + 1_000_000

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) throw new TourismInputError('ID non valido')
    if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) throw new TourismInputError('Richiesta troppo grande')
    const form = await request.formData()
    const files: UploadedFile[] = []
    for (const value of form.getAll('files')) {
      if (typeof value === 'string' || !value.size) continue
      files.push({ name: value.name, buffer: Buffer.from(await value.arrayBuffer()) })
    }
    if (!files.length) throw new TourismInputError('Nessun file')
    const row = await loadDeck(auth.supabase, auth.user.id, id)
    const service = createServiceRoleClient()
    await addAssets(auth.supabase, service, row, files)
    return tourismResponse(await toView(auth.supabase, service, row), 201)
  } catch (error) {
    return tourismError(error)
  }
}
