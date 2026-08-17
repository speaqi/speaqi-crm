import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { findSentGmailMessageByRfc822Id } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const limit = Math.min(50, Math.max(1, Math.floor(Number(body.limit) || 20)))
    const failAfterHours = Math.max(24, Number(process.env.AUTOMATION_RECONCILE_FAIL_HOURS) || 24)
    const supabase = createServiceRoleClient()
    const { data: attempts, error } = await supabase.from('automation_send_attempts')
      .select('id, sender_user_id, message_id_header, claimed_at')
      .eq('workspace_user_id', auth.context.workspaceUserId)
      .in('status', ['claimed', 'provider_accepted', 'unknown'])
      .order('claimed_at', { ascending: true }).limit(limit)
    if (error) throw error

    const results = []
    let errors = 0
    for (const attempt of attempts || []) {
      try {
        const providerId = await findSentGmailMessageByRfc822Id(supabase, attempt.sender_user_id, attempt.message_id_header)
        if (providerId) {
          if (!dryRun) await supabase.rpc('finish_automation_send', { p_attempt_id: attempt.id, p_provider_message_id: providerId })
          results.push({ attempt_id: attempt.id, outcome: 'sent', provider_message_id: providerId })
          continue
        }
        const expired = Date.now() - new Date(attempt.claimed_at).getTime() >= failAfterHours * 3_600_000
        if (expired) {
          if (!dryRun) await supabase.rpc('fail_reconciled_automation_send', {
            p_attempt_id: attempt.id, p_error_detail: `Messaggio non trovato dopo ${failAfterHours} ore`,
          })
          results.push({ attempt_id: attempt.id, outcome: 'not_found_after_window' })
        } else results.push({ attempt_id: attempt.id, outcome: 'still_unknown' })
      } catch (error) {
        errors++
        results.push({ attempt_id: attempt.id, outcome: 'error', error: errorMessage(error, 'Reconciliation failed') })
      }
    }
    return Response.json({ ok: errors === 0, dry_run: dryRun, checked: results.length, errors, results }, { status: errors ? 500 : 200 })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Reconciliation failed') }, { status: 500 })
  }
}
