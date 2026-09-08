import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { isGmailReconnectRequired, sweepInboundGmailReplies } from '@/lib/server/gmail'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

/**
 * Scansione della posta in arrivo: chi ha scritto viene cercato nel CRM.
 *
 * E' il controcanto di `reply-monitor` e `wine-project-replies`, che partono
 * dal contatto e quindi vedono solo chi capita nella rotazione. Qui si parte
 * dalla casella, cosi' una risposta viene registrata anche se il contatto non
 * e' in coda, e' stato re-importato su una scheda nuova o non e' mai stato
 * scritto dal CRM.
 *
 * Due ingressi come per le bozze: sessione browser (pagina /email) e n8n con
 * AUTOMATION_SECRET.
 */
export async function POST(request: NextRequest) {
  let supabase: any
  let userId: string

  if (request.headers.get('x-automation-secret')) {
    const auth = requireAutomation(request)
    if ('response' in auth) return auth.response
    supabase = createServiceRoleClient()
    userId = auth.context.workspaceUserId
  } else {
    const auth = await requireRouteUser(request)
    if ('error' in auth) return auth.error
    supabase = auth.supabase
    userId = auth.workspaceUserId
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await sweepInboundGmailReplies(supabase, userId, {
      days: body.days,
      maxMessages: body.max_messages,
      maxContacts: body.max_contacts,
    })
    return Response.json({ ok: result.errors.length === 0, ...result })
  } catch (error) {
    if (isGmailReconnectRequired(error)) {
      return Response.json(
        { ok: false, error: 'Autorizzazione Gmail scaduta: ricollega Gmail e riprova.' },
        { status: 409 }
      )
    }
    console.error('inbound-replies sweep failed', error)
    return Response.json(
      { ok: false, error: errorMessage(error, 'Scansione risposte fallita') },
      { status: 500 }
    )
  }
}
