import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'
import {
  parseDemoList,
  reconcileWineDemos,
  type DemoRecord,
} from '@/lib/server/wine-project-demo-reconcile'

/**
 * "Allinea le schede generate": si incolla l'elenco delle analisi preso
 * dall'app Speaqi e il CRM registra quelle che mancano. La scrittura passa dal
 * service role come per le automazioni, ma sempre e solo sul workspace di chi
 * ha fatto la richiesta.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const items: DemoRecord[] = Array.isArray(body.items)
      ? body.items
      : parseDemoList(String(body.text || ''))
    if (!items.length) {
      return Response.json({ error: 'Nessuna scheda riconosciuta: serve almeno un sito o un\'email' }, { status: 400 })
    }

    const outcome = await reconcileWineDemos(
      createServiceRoleClient(),
      auth.workspaceUserId,
      items,
      { dryRun: body.dry_run === true, source: 'incollato a mano' },
    )
    return Response.json(outcome)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile allineare le schede') }, { status: 500 })
  }
}
