import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { UFFICIO_SCENE_HTML } from '@/lib/server/ufficio-scene'
import { UFFICIO_CAMPUS_SCENE_HTML } from '@/lib/server/ufficio-campus-scene'
import { officeLockedResponse, officeUnlocked } from '@/lib/server/office-lock'

// Una scena pesa quasi 1 MB e cambia solo con un deploy: il browser la tiene e chiede
// soltanto «è ancora questa?». Il controllo del titolare resta a ogni richiesta.
// Due scene: il nuovo ufficio (di default) e il campus di prima (?scena=campus), tenuto per confronto.
const scene = (html: string) => ({ html, etag: `"${createHash('sha256').update(html).digest('hex').slice(0, 20)}"` })
const OFFICE = scene(UFFICIO_SCENE_HTML)
const CAMPUS = scene(UFFICIO_CAMPUS_SCENE_HTML)
const CACHE = 'private, no-cache'

/** La scena 3D dell'ufficio: solo per il titolare, come la prima pagina. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  if (!officeUnlocked(request, auth.userId)) return officeLockedResponse()
  const { html, etag } = request.nextUrl.searchParams.get('scena') === 'campus' ? CAMPUS : OFFICE
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE } })
  }
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': CACHE, ETag: etag, Vary: 'Authorization, Cookie' },
  })
}
