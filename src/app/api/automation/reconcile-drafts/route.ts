import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'
import { reconcileGmailSentDrafts } from '@/lib/server/draft-reconcile'
import { errorMessage } from '@/lib/server/http'
import { isGmailReconnectRequired } from '@/lib/server/gmail'

/**
 * Segna come inviate le bozze di /email spedite a mano da Gmail.
 * Due ingressi: sessione browser (pagina /email) e n8n con AUTOMATION_SECRET.
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
    const result = await reconcileGmailSentDrafts(supabase, userId, {
      dryRun: body.dry_run === true,
      lookbackDays: body.lookback_days,
      maxSentScan: body.max_sent_scan,
      maxDraftChecks: body.max_draft_checks,
      maxContactSyncs: body.max_contact_syncs,
    })

    return Response.json({ ok: result.errors.length === 0, ...result })
  } catch (error) {
    if (isGmailReconnectRequired(error)) {
      return Response.json(
        { ok: false, error: 'Autorizzazione Gmail scaduta: ricollega Gmail e riprova.' },
        { status: 409 }
      )
    }
    console.error('reconcile-drafts failed', error)
    return Response.json(
      { ok: false, error: errorMessage(error, 'Riconciliazione bozze fallita') },
      { status: 500 }
    )
  }
}
