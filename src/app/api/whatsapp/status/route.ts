import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import {
  fetchWhatsappSessionStatus,
  normalizeChatId,
  sendWhatsappText,
  whatsappGatewayStatus,
} from '@/lib/server/whatsapp'
import {
  ALL_WHATSAPP_EVENTS,
  loadWhatsappSettings,
  runWhatsappDigest,
  saveWhatsappSettings,
} from '@/lib/server/whatsapp-notify'

/**
 * Pannello WhatsApp di `/impostazioni/whatsapp`: numero e interruttore stanno
 * qui, non nelle env. Restituisce anche lo stato della sessione — una sessione
 * sganciata smette di notificare in silenzio — e la coda ancora da mandare.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const gateway = whatsappGatewayStatus()
  const settings = await loadWhatsappSettings(auth.supabase, auth.workspaceUserId)
  const session = gateway.configured ? await fetchWhatsappSessionStatus() : null

  const { count, error } = await auth.supabase
    .from('whatsapp_notification_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.workspaceUserId)
    .is('notified_at', null)

  return Response.json({
    ok: true,
    gateway,
    settings,
    chat_id: normalizeChatId(settings.notify_to),
    all_events: ALL_WHATSAPP_EVENTS,
    session,
    pending_events: error ? null : count || 0,
  })
}

/**
 * `action: 'save'` scrive numero, interruttore ed eventi; `'test'` manda un
 * messaggio di prova; `'digest'` forza subito il riepilogo che di norma gira da
 * n8n.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || 'test')

    if (action === 'save') {
      const notifyTo = body.notify_to === undefined ? undefined : String(body.notify_to || '').trim()
      if (notifyTo && !normalizeChatId(notifyTo)) {
        return Response.json(
          { ok: false, error: 'Numero non valido: usa il formato internazionale, es. +39 389 6868162' },
          { status: 400 }
        )
      }
      const settings = await saveWhatsappSettings(auth.supabase, auth.workspaceUserId, {
        notify_to: notifyTo,
        enabled: body.enabled === undefined ? undefined : body.enabled === true,
        events: body.events === undefined ? undefined : body.events,
      })
      return Response.json({ ok: true, settings, chat_id: normalizeChatId(settings.notify_to) })
    }

    if (action === 'digest') {
      const result = await runWhatsappDigest(auth.supabase, auth.workspaceUserId, {
        dryRun: body.dry_run === true,
      })
      return Response.json(result, { status: result.ok ? 200 : 502 })
    }

    const settings = await loadWhatsappSettings(auth.supabase, auth.workspaceUserId)
    const text = String(body.text || '').trim() || '✅ Speaqi CRM: notifiche WhatsApp collegate.'
    const result = await sendWhatsappText(text, { chatId: body.notify_to || settings.notify_to })
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
