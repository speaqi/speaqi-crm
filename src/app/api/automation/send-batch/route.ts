import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { sendDraftAutomatically } from '@/lib/server/automation-send'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response

  try {
    const body = await request.json().catch(() => ({}))
    if (body.scopes || body.workspace_user_id || body.sender_user_id) {
      return Response.json({ ok: false, error: 'Workspace, sender and scopes are server-controlled' }, { status: 400 })
    }
    const dryRun = body.dry_run === true
    if (!dryRun && process.env.AUTOMATION_SEND_ENABLED !== 'true') {
      return Response.json({ ok: false, error: 'Automatic sending disabled' }, { status: 503 })
    }
    const limit = Math.min(20, Math.max(1, Math.floor(Number(body.limit) || 3)))
    const minAgeMinutes = Math.min(7 * 24 * 60, Math.max(1, Math.floor(Number(body.min_age_minutes) || 60)))
    const supabase = createServiceRoleClient()
    const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()
    const { data: drafts, error } = await supabase.from('email_drafts').select('id')
      .eq('user_id', auth.context.workspaceUserId).eq('status', 'pending').eq('source', 'auto')
      .lte('created_at', cutoff).order('created_at', { ascending: true }).order('id', { ascending: true })
      .limit(limit)
    if (error) throw error

    const results = []
    for (const draft of drafts || []) {
      const result = await sendDraftAutomatically(supabase, auth.context, {
        draftId: draft.id, minAgeMinutes, dryRun,
      })
      results.push(result)
      if (!dryRun && Number(process.env.AUTOMATION_SEND_DELAY_MS || 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, Number(process.env.AUTOMATION_SEND_DELAY_MS))))
      }
    }
    const sent = results.filter((item) => item.sent).length
    const unknown = results.filter((item) => item.unknown)
    const skipped = results.filter((item) => item.skipped)
    return Response.json({
      ok: unknown.length === 0, dry_run: dryRun, processed: results.length,
      sent, skipped, unknown, errors: [],
    }, { status: unknown.length ? 500 : 200 })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Batch send failed') }, { status: 500 })
  }
}
