import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { UFFICIO_SCENE_HTML } from '@/lib/server/ufficio-scene'

/** La scena 3D dell'ufficio: solo per il titolare, come la prima pagina. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  return new Response(UFFICIO_SCENE_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
