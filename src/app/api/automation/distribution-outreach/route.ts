import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { checkDistributionReplies, sendApprovedDistributionMessages } from '@/lib/server/distribution-outreach'

/**
 * Agente Distribuzione, ogni 15 minuti: prima le risposte (una risposta ferma la sequenza
 * prima che parta il promemoria), poi le email approvate, in orario d'ufficio del destinatario
 * ed entro il tetto giornaliero. Senza DISTRIBUTION_SEND_ENABLED=true non parte niente.
 * Workspace dall'ambiente, mai dal corpo.
 */
export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  const body = await request.json().catch(() => ({}))
  const admin = createServiceRoleClient()
  const userId = auth.context.workspaceUserId
  const result: Record<string, unknown> = {}
  let failed = false
  try {
    result.replies = await checkDistributionReplies(admin, userId, { limit: 30 })
  } catch (error) {
    failed = true
    result.replies_error = errorMessage(error, 'Controllo delle risposte non riuscito')
  }
  try {
    result.send = await sendApprovedDistributionMessages(admin, userId, { limit: Number(body.limit) || 4, dryRun: body.dry_run === true })
  } catch (error) {
    failed = true
    result.send_error = errorMessage(error, 'Invio non riuscito')
  }
  return Response.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 })
}
