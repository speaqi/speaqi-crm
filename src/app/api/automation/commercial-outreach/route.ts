import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { acumbamailIdempotencyKey, enrollEligibleHospitalityContacts, ensureHospitalityCampaign, renderCommercialMessage } from '@/lib/server/commercial-outreach'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

const CLOSED = new Set(['Closed', 'Paid', 'Lost'])

type ProviderMetadata = {
  campaignId?: string
  messageId?: string
  response?: unknown
}

function stringId(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function acumbamailMetadata(payload: unknown): ProviderMetadata {
  if (!payload || typeof payload !== 'object') return { response: payload }
  const root = payload as Record<string, any>
  const nested = (root.data && typeof root.data === 'object' ? root.data : root.result && typeof root.result === 'object' ? root.result : {}) as Record<string, any>
  return {
    campaignId: stringId(root.campaign_id ?? root.campaignId ?? nested.campaign_id ?? nested.campaignId),
    messageId: stringId(root.message_id ?? root.messageId ?? nested.message_id ?? nested.messageId ?? nested.id ?? root.id),
    response: payload,
  }
}

async function advance(supabase: any, campaign: any, message: any, enrollment: any, sent: boolean, error?: string, markMessageSent = true, provider?: ProviderMetadata) {
  if (!sent) {
    await supabase.from('commercial_messages').update({ status: 'failed', error: String(error || 'Acumbamail send failed').slice(0, 1000) }).eq('id', message.id)
    return
  }
  if (markMessageSent) {
    const sentAt = new Date().toISOString()
    await supabase.from('commercial_messages').update({
      status: 'sent',
      sent_at: sentAt,
      error: null,
      acumbamail_campaign_id: provider?.campaignId || null,
      acumbamail_message_id: provider?.messageId || null,
      provider_response: provider?.response ?? null,
    }).eq('id', message.id)
  }
  if (message.step_number >= 5) {
    await supabase.from('commercial_enrollments').update({ status: 'completed', current_step: 5, next_step_at: null }).eq('id', enrollment.id)
    return
  }
  const offsets = Array.isArray(campaign.cadence_days) ? campaign.cadence_days.map(Number) : [1, 4, 9, 16, 28]
  const delayDays = Math.max(1, (offsets[message.step_number] || offsets[message.step_number - 1] + 1) - (offsets[message.step_number - 1] || 0))
  const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('commercial_enrollments').update({ status: 'active', current_step: message.step_number, next_step_at: scheduledAt }).eq('id', enrollment.id)
  await supabase.from('commercial_messages').upsert({ enrollment_id: enrollment.id, step_number: message.step_number + 1, attempt_number: 1, recipient_email: enrollment.active_email, scheduled_at: scheduledAt, status: 'scheduled' }, { onConflict: 'enrollment_id,step_number,attempt_number' })
}

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run !== false
    const limit = Math.min(500, Math.max(1, Math.floor(Number(body.limit) || 100)))
    const supabase = createServiceRoleClient()
    const campaign = await ensureHospitalityCampaign(supabase, auth.context.workspaceUserId)
    if (!dryRun && (campaign.status !== 'active' || campaign.approval_status !== 'approved')) {
      return Response.json({ ok: true, dry_run: false, skipped: true, reason: 'campaign_paused_or_not_approved', campaign: { id: campaign.id, status: campaign.status, approval_status: campaign.approval_status } })
    }
    if (!dryRun && process.env.COMMERCIAL_OUTREACH_SEND_ENABLED === 'false') {
      return Response.json({ ok: true, dry_run: false, skipped: true, reason: 'emergency_kill_switch' })
    }
    const enrollment = await enrollEligibleHospitalityContacts(supabase, campaign, limit * 5, dryRun)
    const claimed = await supabase.rpc('claim_commercial_messages', { p_campaign_id: campaign.id, p_limit: limit, p_dry_run: dryRun })
    if (claimed.error) throw claimed.error
    const results = []
    for (const message of claimed.data || []) {
      const detail = await supabase.from('commercial_enrollments').select('*,contacts!inner(*)').eq('id', message.enrollment_id).single()
      if (detail.error) throw detail.error
      const activeEnrollment = detail.data
      const contact = activeEnrollment.contacts
      const stepResult = await supabase.from('commercial_campaign_steps').select('*').eq('campaign_id', campaign.id).eq('step_number', message.step_number).single()
      if (stepResult.error) throw stepResult.error
      const rendered = renderCommercialMessage(stepResult.data, contact)
      let stopReason = ''
      if (CLOSED.has(contact.status)) stopReason = `contact_${String(contact.status).toLowerCase()}`
      else if (contact.marketing_eligibility !== 'eligible') stopReason = `marketing_${contact.marketing_eligibility}`
      else if (stepResult.data.only_without_engagement && (activeEnrollment.opened_at || activeEnrollment.clicked_at)) stopReason = 'engaged_before_step_2'
      if (stopReason) {
        if (!dryRun) {
          await supabase.from('commercial_messages').update({ status: 'skipped', stop_reason: stopReason }).eq('id', message.id)
          if (stopReason === 'engaged_before_step_2') await advance(supabase, campaign, { ...message, step_number: 2 }, activeEnrollment, true, undefined, false)
          else await supabase.from('commercial_enrollments').update({ status: 'stopped', stop_reason: stopReason, stopped_at: new Date().toISOString(), next_step_at: null }).eq('id', activeEnrollment.id)
        }
        results.push({ message_id: message.id, recipient: message.recipient_email, skipped: true, reason: stopReason })
        continue
      }
      if (dryRun) {
        results.push({ message_id: message.id, recipient: message.recipient_email, step: message.step_number, subject: rendered.subject, preview: rendered.text.slice(0, 240) })
        continue
      }
      const webhookUrl = process.env.ACUMBAMAIL_TRANSACTIONAL_WEBHOOK_URL
      if (!webhookUrl) throw new Error('ACUMBAMAIL_TRANSACTIONAL_WEBHOOK_URL is required')
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': acumbamailIdempotencyKey(message.id, message.recipient_email) },
        body: JSON.stringify({ body: rendered.html, category: `hospitality-step-${message.step_number}`, to_email: message.recipient_email, from_email: campaign.sender_email, subject: rendered.subject, reply_to: campaign.reply_to || undefined }),
      })
      const responseText = await response.text()
      if (!response.ok) {
        await advance(supabase, campaign, message, activeEnrollment, false, `HTTP ${response.status}: ${responseText}`)
        results.push({ message_id: message.id, sent: false, error: `HTTP ${response.status}` })
        continue
      }
      let responsePayload: unknown = responseText
      try { responsePayload = responseText ? JSON.parse(responseText) : null } catch {}
      const provider = acumbamailMetadata(responsePayload)
      await advance(supabase, campaign, message, activeEnrollment, true, undefined, true, provider)
      results.push({ message_id: message.id, provider_message_id: provider.messageId, sent: true, recipient: message.recipient_email, step: message.step_number })
    }
    return Response.json({ ok: true, dry_run: dryRun, campaign: { id: campaign.id, status: campaign.status, approval_status: campaign.approval_status, daily_cap: campaign.daily_cap }, enrollment, processed: results.length, results })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Commercial outreach failed') }, { status: 500 })
  }
}
