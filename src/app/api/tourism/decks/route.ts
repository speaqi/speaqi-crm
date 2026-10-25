import { NextRequest } from 'next/server'
import { requireTourismOwner, tourismError, tourismResponse } from '@/lib/server/tourism'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { addAssets, createDeck, deleteDeck, generateIntoDeck, toView, type UploadedFile } from '@/lib/server/tourism-decks'
import { MAX_DOCUMENTS, MAX_PHOTOS, MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES } from '@/lib/server/tourism-deck-assets'
import { countTodo } from '@/lib/tourism-deck'
import { isUuid, textValue, TourismInputError } from '@/lib/tourism'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

const MAX_REQUEST_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES + MAX_DOCUMENTS * MAX_DOCUMENT_BYTES + 1_000_000

export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { data, error } = await auth.supabase
      .from('tourism_decks')
      .select('id,title,destination,entity_id,status,slides,public_token,updated_at,approved_at')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return tourismResponse({
      decks: (data || []).map(({ slides, ...d }: any) => ({ ...d, todo: countTodo(slides || []) }))
    })
  } catch (error) {
    return tourismError(error)
  }
}

/**
 * Crea la presentazione da un form (multipart): destinazione, ente, testo libero, foto e documenti.
 * Con generate=0 salva solo la bozza; altrimenti l'agente legge tutto e riscrive le slide.
 */
export async function POST(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  let created: Awaited<ReturnType<typeof createDeck>> | null = null
  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_BYTES) throw new TourismInputError('Richiesta troppo grande')
    const form = await request.formData()
    const destination = textValue(form.get('destinazione'), 200)
    if (!destination) throw new TourismInputError('Indica la destinazione')
    const entityRaw = textValue(form.get('entity_id'), 40)
    if (entityRaw && !isUuid(entityRaw)) throw new TourismInputError('Ente non valido')
    const files: UploadedFile[] = []
    for (const value of form.getAll('files')) {
      if (typeof value === 'string' || !value.size) continue
      files.push({ name: value.name, buffer: Buffer.from(await value.arrayBuffer()) })
    }
    const service = createServiceRoleClient()
    created = await createDeck(auth.supabase, auth.user.id, {
      destination,
      entity_id: entityRaw || null,
      notes: textValue(form.get('notes'), 30000),
      input: {
        destinazione: destination,
        ente: textValue(form.get('ente'), 200),
        paese: textValue(form.get('paese'), 100),
        prezzo: textValue(form.get('prezzo'), 300),
        contatto: textValue(form.get('contatto'), 300),
        ...(form.get('modello') === 'partner' ? { modello: 'partner' as const } : {})
      }
    })
    if (files.length) await addAssets(auth.supabase, service, created, files)
    const deck = form.get('generate') === '0' ? created : await generateIntoDeck(auth.supabase, service, created)
    return tourismResponse(await toView(auth.supabase, service, deck), 201)
  } catch (error) {
    // Un form che non passa i controlli non lascia una bozza vuota in giro.
    if (created) {
      try {
        await deleteDeck(auth.supabase, createServiceRoleClient(), created)
      } catch {
        /* la bozza resta in elenco: si cancella da lì */
      }
    }
    return tourismError(error)
  }
}
