import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { runWhatsappDigest } from '@/lib/server/whatsapp-notify'
import { isWhatsappNotifyEnabled, whatsappConfigStatus } from '@/lib/server/whatsapp'

/**
 * Riepilogo WhatsApp degli eventi in coda (invii, aperture, click,
 * disiscrizioni). Girato da n8n ogni 30 minuti; le risposte non passano di qui
 * perche escono subito da `recordWhatsappEvent`.
 */
export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response

  // Interruttore spento o gateway non configurato non sono errori: sono lo stato
  // normale finche il numero non e agganciato. Rispondiamo 200 perche altrimenti
  // il cron n8n suonerebbe l'allarme ogni mezz'ora.
  const status = whatsappConfigStatus()
  if (!status.configured) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: `Gateway WhatsApp non configurato: manca ${status.missing.join(', ')}`,
    })
  }
  if (!isWhatsappNotifyEnabled()) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: 'WHATSAPP_NOTIFY_ENABLED non è true: notifiche disattivate',
    })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await runWhatsappDigest(createServiceRoleClient(), auth.context.workspaceUserId, {
      dryRun: body.dry_run === true,
      timezone: auth.context.timezone,
      limit: body.limit,
    })
    return Response.json(result, { status: result.ok ? 200 : 502 })
  } catch (error) {
    console.error('whatsapp-digest failed', error)
    return Response.json(
      { ok: false, error: errorMessage(error, 'Riepilogo WhatsApp fallito') },
      { status: 500 }
    )
  }
}
