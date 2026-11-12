import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { officeProductionCommand } from '@/lib/server/office-production'
import { isProductionAction, isProductionSlug, isRequestId } from '@/lib/office/production'

/**
 * Un comando su una città dalla sala di controllo (solo titolare): piano con stima (`dry_run`),
 * avvio, o stato di un comando già avviato (stesso `request_id`). L'elenco dei comandi è chiuso.
 */
export async function POST(request: NextRequest) {
  return officeOwnerRoute(request, async () => {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || !isProductionSlug(body.slug) || !isProductionAction(body.action) || !isRequestId(body.request_id)) {
      return Response.json({ error: 'Comando non valido' }, { status: 400 })
    }
    if (/napoli|naples/i.test(body.slug)) return Response.json({ error: 'Napoli è protetta: dall’Ufficio non si lavora.' }, { status: 409 })
    const result = await officeProductionCommand({ request_id: body.request_id, slug: body.slug, action: body.action, dry_run: body.dry_run === true })
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json(result)
  })
}
