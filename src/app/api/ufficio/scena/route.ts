import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { UFFICIO_SCENE_HTML } from '@/lib/server/ufficio-scene'
import { officeLockedResponse, officeUnlocked } from '@/lib/server/office-lock'

// La scena pesa ~800 KB e cambia solo con un deploy: il browser la tiene e chiede
// soltanto «è ancora questa?». Il controllo del titolare resta a ogni richiesta.
const ETAG = `"${createHash('sha256').update(UFFICIO_SCENE_HTML).digest('hex').slice(0, 20)}"`
const CACHE = 'private, no-cache'

/** La scena 3D dell'ufficio: solo per il titolare, come la prima pagina. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  if (!officeUnlocked(request, auth.userId)) return officeLockedResponse()
  if (request.headers.get('if-none-match') === ETAG) {
    return new Response(null, { status: 304, headers: { ETag: ETAG, 'Cache-Control': CACHE } })
  }
  return new Response(UFFICIO_SCENE_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': CACHE, ETag: ETAG, Vary: 'Authorization, Cookie' },
  })
}
