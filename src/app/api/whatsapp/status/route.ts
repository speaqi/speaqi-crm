import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import {
  fetchWhatsappSessionStatus,
  sendWhatsappText,
  whatsappConfigStatus,
} from '@/lib/server/whatsapp'
import { enabledWhatsappEvents, runWhatsappDigest } from '@/lib/server/whatsapp-notify'

/**
 * Diagnostica del gateway WhatsApp per la pagina impostazioni: configurazione,
 * stato della sessione (una sessione sganciata smette di notificare in silenzio)
 * e coda ancora da notificare.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const config = whatsappConfigStatus()
  const session = config.configured ? await fetchWhatsappSessionStatus() : null

  const { count, error } = await auth.supabase
    .from('whatsapp_notification_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.workspaceUserId)
    .is('notified_at', null)

  return Response.json({
    ok: true,
    config,
    events: enabledWhatsappEvents(),
    session,
    pending_events: error ? null : count || 0,
  })
}

/**
 * `action: 'test'` manda un messaggio di prova, `action: 'digest'` forza subito
 * il riepilogo (lo stesso che gira da n8n).
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'test')

    if (action === 'digest') {
      const result = await runWhatsappDigest(auth.supabase, auth.workspaceUserId, {
        dryRun: body.dry_run === true,
      })
      return Response.json(result, { status: result.ok ? 200 : 502 })
    }

    const text = String(body.text || '').trim() || '✅ Speaqi CRM: notifiche WhatsApp collegate.'
    const result = await sendWhatsappText(text)
    return Response.json(
      { ok: result.ok, provider_message_id: result.providerMessageId || null, error: result.error || null },
      { status: result.ok ? 200 : 502 }
    )
  } catch (error) {
    console.error('whatsapp status action failed', error)
    return Response.json(
      { ok: false, error: errorMessage(error, 'Azione WhatsApp fallita') },
      { status: 500 }
    )
  }
}
