import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { UFFICIO_SCENE_HTML } from '@/lib/server/ufficio-scene'
import { officeLockedResponse, officeUnlocked } from '@/lib/server/office-lock'

/** La scena 3D dell'ufficio: solo per il titolare, come la prima pagina. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error
  if (!officeUnlocked(request, auth.userId)) return officeLockedResponse()
  return new Response(UFFICIO_SCENE_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
