import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import {
  acumbamailIdempotencyKey,
  enrollEligibleHospitalityContacts,
  ensureHospitalityCampaign,
  renderCommercialMessage,
} from '@/lib/server/commercial-outreach'
import {
  addHospitalityCampaignRecipients,
  createHospitalityRecipientList,
  createWineProjectCampaign,
} from '@/lib/server/acumbamail-marketing'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

const CLOSED = new Set(['Closed', 'Paid', 'Lost'])
const DEMO_URL = 'https://speaqi.com/demo/hotel-project'
const RAI3_URL = 'https://www.rainews.it/tgr/campania/video/2025/03/tgr-campania-web-speaqi-rai3-innovazione-turismo-2f17c632-0282-4ab9-a64b-73533dc6a327.html'

type ProviderMetadata = {
  campaignId?: string
  messageId?: string
  response?: unknown
}

type Delivery = {
  message: any
  enrollment: any
  contact: any
  step: any
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

function reliableName(contact: any) {
  const value = String(contact.name || '').trim().replace(/\s+/g, ' ')
  if (!value || value === contact.company || value === contact.email || /[@\d/_]/.test(value)) return ''
  if (/^(?:info|booking|reception|hotel|albergo|agriturismo|staff|contatto|commerciale|marketing)\b/i.test(value)) return ''
  return value
}

function personalization(contact: any) {
  const fullName = reliableName(contact)
  const firstName = fullName.split(' ')[0] || ''
  const company = String(contact.company || contact.name || '').trim() || 'la vostra struttura'
  const url = new URL(DEMO_URL)
  if (company !== 'la vostra struttura') url.searchParams.set('company_name', company)
  url.searchParams.set('utm_source', 'acumbamail')
  url.searchParams.set('utm_medium', 'email')
  url.searchParams.set('utm_campaign', 'hospitality-project')
  return {
    email: String(contact.email || '').trim().toLowerCase(),
    firstName,
    fullName,
    greeting: firstName ? `Buongiorno ${firstName},` : 'Buongiorno,',
    company,
    demoUrl: url.toString(),
  }
}

function campaignContent(step: any) {
  const subject = String(step.subject_template || '')
    .replaceAll('{{nome}}', '*|FULL_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
    .replace(/\s+- All'attenzione di\s*$/i, '')
  const copy = String(step.body_text_template || '')
    .replaceAll('{{saluto}}', '*|GREETING|*')
    .replaceAll('{{nome}}', '*|FULL_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
    .replaceAll('{{demo_url}}', '[[DEMO_URL]]')
    .replaceAll('{{rai3_url}}', RAI3_URL)
  const body = copy.split(/\n\s*\n/).map((paragraph) => {
    const html = escapeHtml(paragraph)
      .replace('[[DEMO_URL]]', '<a href="*|DEMO_URL|*" style="color:#2949b8;text-decoration:underline;">apri la demo dedicata</a>')
      .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2949b8;text-decoration:underline;">$1</a>')
      .replace(/\n/g, '<br>')
    return `<p style="margin:0 0 18px;font:15px/1.62 Arial,Helvetica,sans-serif;color:#172033;text-align:left;">${html}</p>`
  }).join('')
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#ffffff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:30px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;margin:0;"><tr><td><p style="margin:0 0 22px;font:700 12px/1.3 Arial,Helvetica,sans-serif;letter-spacing:1.6px;color:#2949b8;">SPEAQI · HOSPITALITY EXPERIENCE</p>${body}<hr style="border:0;border-top:1px solid #dfe4ed;margin:28px 0 18px;"><p style="margin:0;font:13px/1.55 Arial,Helvetica,sans-serif;color:#536078;">Massimo Morgante<br>CEO · Speaqi<br><a href="mailto:info@speaqi.com" style="color:#2949b8;">info@speaqi.com</a> · +39 389 686 8162</p><p style="margin:22px 0 0;font:11px/1.5 Arial,Helvetica,sans-serif;color:#7b8495;">Non desidera ricevere altri messaggi? <a href="*|UNSUBSCRIBE_URL|*" style="color:#536078;text-decoration:underline;">Si disiscriva qui</a>.</p></td></tr></table></td></tr></table></body></html>`,
  }
}

async function advance(supabase: any, campaign: any, message: any, enrollment: any, sent: boolean, error?: string, provider?: ProviderMetadata) {
  if (!sent) {
    await supabase.from('commercial_messages').update({ status: 'failed', error: String(error || 'Acumbamail send failed').slice(0, 1000) }).eq('id', message.id)
    return
  }
  const sentAt = new Date().toISOString()
  await supabase.from('commercial_messages').update({
    status: 'sent',
    sent_at: sentAt,
    error: null,
    acumbamail_campaign_id: provider?.campaignId || null,
    acumbamail_message_id: provider?.messageId || null,
    provider_response: provider?.response ?? null,
  }).eq('id', message.id)
  if (message.step_number >= 5) {
    await supabase.from('commercial_enrollments').update({ status: 'completed', current_step: 5, next_step_at: null }).eq('id', enrollment.id)
    return
  }
  const offsets = Array.isArray(campaign.cadence_days) ? campaign.cadence_days.map(Number) : [1, 4, 9, 16, 28]
  const delayDays = Math.max(1, (offsets[message.step_number] || offsets[message.step_number - 1] + 1) - (offsets[message.step_number - 1] || 0))
  const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
  await supabase.from('commercial_enrollments').update({ status: 'active', current_step: message.step_number, next_step_at: scheduledAt }).eq('id', enrollment.id)
  await supabase.from('commercial_messages').upsert({
    enrollment_id: enrollment.id,
    step_number: message.step_number + 1,
    attempt_number: 1,
    recipient_email: enrollment.active_email,
    scheduled_at: scheduledAt,
    status: 'scheduled',
  }, { onConflict: 'enrollment_id,step_number,attempt_number' })
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
    if (!dryRun && process.env.COMMERCIAL_OUTREACH_SEND_ENABLED !== 'true') {
      return Response.json({ ok: true, dry_run: false, skipped: true, reason: 'emergency_kill_switch' })
    }
    const token = process.env.ACUMBAMAIL_AUTH_TOKEN
    if (!dryRun && !token) throw new Error('ACUMBAMAIL_AUTH_TOKEN is required')

    const enrollment = await enrollEligibleHospitalityContacts(supabase, campaign, limit * 5, dryRun)
    const claimed = await supabase.rpc('claim_commercial_messages', { p_campaign_id: campaign.id, p_limit: limit, p_dry_run: dryRun })
    if (claimed.error) throw claimed.error

    const results: Array<Record<string, unknown>> = []
    const groups = new Map<number, Delivery[]>()
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
          await supabase.from('commercial_enrollments').update({ status: 'stopped', stop_reason: stopReason, stopped_at: new Date().toISOString(), next_step_at: null }).eq('id', activeEnrollment.id)
        }
        results.push({ message_id: message.id, recipient: message.recipient_email, skipped: true, reason: stopReason })
        continue
      }
      if (dryRun) {
        results.push({ message_id: message.id, recipient: message.recipient_email, step: message.step_number, subject: rendered.subject, preview: rendered.text.slice(0, 240) })
        continue
      }
      groups.set(message.step_number, [...(groups.get(message.step_number) || []), { message, enrollment: activeEnrollment, contact, step: stepResult.data }])
    }

    for (const [stepNumber, deliveries] of groups) {
      const batchKey = acumbamailIdempotencyKey(deliveries[0].message.id, `step-${stepNumber}`).slice(0, 10)
      try {
        const listId = await createHospitalityRecipientList(token!, `Hospitality · Email ${stepNumber}/5 · ${batchKey}`, campaign.sender_email)
        const recipients = deliveries.map((item) => personalization(item.contact))
        await addHospitalityCampaignRecipients(token!, listId, recipients)
        const content = campaignContent(deliveries[0].step)
        const campaignId = await createWineProjectCampaign(token!, {
          name: `Hospitality · Email ${stepNumber}/5 · ${new Date().toISOString().slice(0, 16)}`,
          subject: content.subject,
          html: content.html,
          listId,
          fromName: campaign.sender_name,
          fromEmail: campaign.sender_email,
        })
        const provider = { campaignId, response: { list_id: listId, recipients: recipients.length, batch_key: batchKey } }
        for (const item of deliveries) {
          await advance(supabase, campaign, item.message, item.enrollment, true, undefined, provider)
          results.push({ message_id: item.message.id, campaign_id: campaignId, sent: true, recipient: item.message.recipient_email, step: item.message.step_number })
        }
        await supabase.from('acumbamail_campaigns').upsert({
          user_id: campaign.user_id,
          campaign_key: `hospitality-e${stepNumber}-${batchKey}`,
          campaign_id: campaignId,
          name: `Hospitality · Email ${stepNumber}/5`,
          list_name: `Hospitality · Email ${stepNumber}/5`,
          min_opens: 1,
          responsible: campaign.sender_name,
          updated_at: new Date().toISOString(),
          last_synced_at: null,
          last_sync_error: null,
        }, { onConflict: 'user_id,campaign_key' })
      } catch (campaignError) {
        const message = errorMessage(campaignError, 'Campagna Hospitality Acumbamail non riuscita')
        for (const item of deliveries) await advance(supabase, campaign, item.message, item.enrollment, false, message)
        results.push({ step: stepNumber, sent: false, failed: deliveries.length, error: message })
      }
    }
    return Response.json({ ok: true, dry_run: dryRun, campaign: { id: campaign.id, status: campaign.status, approval_status: campaign.approval_status, daily_cap: campaign.daily_cap }, enrollment, processed: results.length, results })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Commercial outreach failed') }, { status: 500 })
  }
}
