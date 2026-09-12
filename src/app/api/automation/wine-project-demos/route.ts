import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import {
  parseDemoList,
  reconcileWineDemos,
  type DemoRecord,
} from '@/lib/server/wine-project-demo-reconcile'

/**
 * La stessa riconciliazione, per chi non sta davanti a una pagina: l'app Speaqi
 * o un cron possono mandare l'elenco delle analisi e il CRM registra quelle che
 * mancano. Il workspace arriva dalle env come per le altre automazioni, mai dal
 * corpo della richiesta.
 */
export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }
  const userId = process.env.AUTOMATION_WORKSPACE_USER_ID
  if (!userId) {
    return Response.json({ error: 'AUTOMATION_WORKSPACE_USER_ID non configurato' }, { status: 500 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const items: DemoRecord[] = Array.isArray(body.items)
      ? body.items
      : parseDemoList(String(body.text || ''))
    if (!items.length) return Response.json({ error: 'items o text richiesti' }, { status: 400 })

    const outcome = await reconcileWineDemos(
      createServiceRoleClient(),
      userId,
      items,
      { dryRun: body.dry_run === true, source: 'automazione' },
    )
    return Response.json(outcome)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile allineare le schede') }, { status: 500 })
  }
}
