import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import {
  acumbamailIdempotencyKey,
  ensureHospitalityCampaign,
  renderCommercialMessage,
} from '@/lib/server/commercial-outreach'
import {
  ensureCampaignSteps,
  enrollCampaignContacts,
  escapeHtml,
  type CommercialCampaign,
  type EnrollmentReport,
} from '@/lib/server/commercial-campaigns'
import {
  addHospitalityCampaignRecipients,
  createHospitalityRecipientList,
  createWineProjectCampaign,
} from '@/lib/server/acumbamail-marketing'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

const CLOSED = new Set(['Closed', 'Paid', 'Lost'])

type ProviderMetadata = { campaignId?: string; messageId?: string; response?: unknown }
type Delivery = { message: any; enrollment: any; contact: any; step: any }

type CampaignOutcome = {
  campaign_id: string
  slug: string | null
  vertical: string
  name: string
  status: string
  skipped?: string
  error?: string
  enrollment?: EnrollmentReport
  processed?: number
  results?: Array<Record<string, unknown>>
}

function reliableName(contact: any) {
  const value = String(contact.name || '').trim().replace(/\s+/g, ' ')
  if (!value || value === contact.company || value === contact.email || /[@\d/_]/.test(value)) return ''
  if (/^(?:info|booking|reception|hotel|albergo|agriturismo|staff|contatto|commerciale|marketing)\b/i.test(value)) return ''
  return value
}

/**
 * Personalizzazione e CTA. La destinazione e `landing_url` della campagna: un
 * verticale nuovo cambia URL senza toccare il codice.
 */
function personalization(campaign: CommercialCampaign, contact: any) {
  const fullName = reliableName(contact)
  const firstName = fullName.split(' ')[0] || ''
  const company = String(contact.company || contact.name || '').trim() || 'la vostra organizzazione'
  let landing = campaign.landing_url || ''
  if (landing) {
    try {
      const url = new URL(landing)
      if (company !== 'la vostra organizzazione') url.searchParams.set('company_name', company)
      url.searchParams.set('utm_source', 'acumbamail')
      url.searchParams.set('utm_medium', 'email')
      url.searchParams.set('utm_campaign', campaign.slug || campaign.vertical)
      landing = url.toString()
    } catch {}
  }
  return {
    email: String(contact.email || '').trim().toLowerCase(),
    firstName,
    fullName,
    greeting: firstName ? `Buongiorno ${firstName},` : 'Buongiorno,',
    company,
    demoUrl: landing,
  }
}

function campaignContent(campaign: CommercialCampaign, step: any) {
  const subject = String(step.subject_template || '')
    .replaceAll('{{nome}}', '*|FULL_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
    .replace(/\s+- All'attenzione di\s*$/i, '')
  const copy = String(step.body_text_template || '')
    .replaceAll('{{saluto}}', '*|GREETING|*')
    .replaceAll('{{nome}}', '*|FULL_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
    .replaceAll('{{demo_url}}', '[[LANDING_URL]]')
    .replaceAll('{{landing_url}}', '[[LANDING_URL]]')
  const body = copy
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const html = escapeHtml(paragraph)
        .replace('[[LANDING_URL]]', '<a href="*|DEMO_URL|*" style="color:#2949b8;text-decoration:underline;">apri la pagina dedicata</a>')
        .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2949b8;text-decoration:underline;">$1</a>')
        .replace(/\n/g, '<br>')
      return `<p style="margin:0 0 18px;font:15px/1.62 Arial,Helvetica,sans-serif;color:#172033;text-align:left;">${html}</p>`
    })
    .join('')
  const eyebrow = escapeHtml(campaign.brand_eyebrow || `SPEAQI · ${campaign.vertical.toUpperCase()}`)
  const sender = escapeHtml(campaign.sender_name)
  const senderEmail = escapeHtml(campaign.sender_email)
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#ffffff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:30px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;margin:0;"><tr><td><p style="margin:0 0 22px;font:700 12px/1.3 Arial,Helvetica,sans-serif;letter-spacing:1.6px;color:#2949b8;">${eyebrow}</p>${body}<hr style="border:0;border-top:1px solid #dfe4ed;margin:28px 0 18px;"><p style="margin:0;font:13px/1.55 Arial,Helvetica,sans-serif;color:#536078;">${sender}<br>Speaqi<br><a href="mailto:${senderEmail}" style="color:#2949b8;">${senderEmail}</a></p><p style="margin:22px 0 0;font:11px/1.5 Arial,Helvetica,sans-serif;color:#7b8495;">Non desidera ricevere altri messaggi? <a href="*|UNSUBSCRIBE_URL|*" style="color:#536078;text-decoration:underline;">Si disiscriva qui</a>.</p></td></tr></table></td></tr></table></body></html>`,
  }
}

async function advance(
  supabase: any,
  campaign: CommercialCampaign,
  stepCount: number,
  message: any,
  enrollment: any,
  sent: boolean,
  error?: string,
  provider?: ProviderMetadata
) {
  if (!sent) {
    await supabase
      .from('commercial_messages')
      .update({ status: 'failed', error: String(error || 'Acumbamail send failed').slice(0, 1000) })
      .eq('id', message.id)
    return
  }
  await supabase
    .from('commercial_messages')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      error: null,
      acumbamail_campaign_id: provider?.campaignId || null,
      acumbamail_message_id: provider?.messageId || null,
      provider_response: provider?.response ?? null,
    })
    .eq('id', message.id)

  // La sequenza finisce all'ultimo step configurato, non a un numero fisso.
  if (message.step_number >= stepCount) {
    await supabase
      .from('commercial_enrollments')
      .update({ status: 'completed', current_step: message.step_number, next_step_at: null })
      .eq('id', enrollment.id)
    return
  }
  const offsets = Array.isArray(campaign.cadence_days) ? campaign.cadence_days.map(Number) : [1, 4, 9, 16, 28]
  const delayDays = Math.max(1, (offsets[message.step_number] || offsets[message.step_number - 1] + 1) - (offsets[message.step_number - 1] || 0))
  const scheduledAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString()
  await supabase
    .from('commercial_enrollments')
    .update({ status: 'active', current_step: message.step_number, next_step_at: scheduledAt })
    .eq('id', enrollment.id)
  await supabase.from('commercial_messages').upsert(
    {
      enrollment_id: enrollment.id,
      step_number: message.step_number + 1,
      attempt_number: 1,
      recipient_email: enrollment.active_email,
      scheduled_at: scheduledAt,
      status: 'scheduled',
    },
    { onConflict: 'enrollment_id,step_number,attempt_number' }
  )
}

async function runCampaign(
  supabase: any,
  campaign: CommercialCampaign,
  options: { dryRun: boolean; limit: number; token?: string }
): Promise<CampaignOutcome> {
  const { dryRun, limit } = options
  const outcome: CampaignOutcome = {
    campaign_id: campaign.id,
    slug: campaign.slug,
    vertical: campaign.vertical,
    name: campaign.name,
    status: campaign.status,
  }

  if (!dryRun && (campaign.status !== 'active' || campaign.approval_status !== 'approved')) {
    outcome.skipped = 'campaign_paused_or_not_approved'
    return outcome
  }

  const steps = await ensureCampaignSteps(supabase, campaign)
  outcome.enrollment = await enrollCampaignContacts(supabase, campaign, { limit: limit * 5, dryRun })

  const claimed = await supabase.rpc('claim_commercial_messages', {
    p_campaign_id: campaign.id,
    p_limit: limit,
    p_dry_run: dryRun,
  })
  if (claimed.error) throw claimed.error

  const results: Array<Record<string, unknown>> = []
  const groups = new Map<number, Delivery[]>()

  for (const message of claimed.data || []) {
    const detail = await supabase
      .from('commercial_enrollments')
      .select('*,contacts!inner(*)')
      .eq('id', message.enrollment_id)
      .single()
    if (detail.error) throw detail.error
    const enrollment = detail.data
    const contact = enrollment.contacts
    const step = steps.find((row: any) => Number(row.step_number) === Number(message.step_number))
    if (!step) {
      results.push({ message_id: message.id, skipped: true, reason: 'step_missing' })
      continue
    }
    const rendered = renderCommercialMessage(step, contact)

    let stopReason = ''
    if (CLOSED.has(contact.status)) stopReason = `contact_${String(contact.status).toLowerCase()}`
    else if (contact.marketing_eligibility !== 'eligible') stopReason = `marketing_${contact.marketing_eligibility}`
    else if (contact.email_unsubscribed_at) stopReason = 'unsubscribed'
    else if (step.only_without_engagement && (enrollment.opened_at || enrollment.clicked_at)) stopReason = 'engaged'

    if (stopReason) {
      if (!dryRun) {
        await supabase.from('commercial_messages').update({ status: 'skipped', stop_reason: stopReason }).eq('id', message.id)
        await supabase
          .from('commercial_enrollments')
          .update({ status: 'stopped', stop_reason: stopReason, stopped_at: new Date().toISOString(), next_step_at: null })
          .eq('id', enrollment.id)
      }
      results.push({ message_id: message.id, recipient: message.recipient_email, skipped: true, reason: stopReason })
      continue
    }
    if (dryRun) {
      results.push({
        message_id: message.id,
        recipient: message.recipient_email,
        step: message.step_number,
        subject: rendered.subject,
        preview: rendered.text.slice(0, 240),
      })
      continue
    }
    groups.set(message.step_number, [...(groups.get(message.step_number) || []), { message, enrollment, contact, step }])
  }

  const label = campaign.slug || campaign.vertical
  for (const [stepNumber, deliveries] of groups) {
    const batchKey = acumbamailIdempotencyKey(deliveries[0].message.id, `step-${stepNumber}`).slice(0, 10)
    try {
      const listId = await createHospitalityRecipientList(
        options.token!,
        `${campaign.name} · Email ${stepNumber}/${steps.length} · ${batchKey}`,
        campaign.sender_email
      )
      const recipients = deliveries.map((item) => personalization(campaign, item.contact))
      await addHospitalityCampaignRecipients(options.token!, listId, recipients)
      const content = campaignContent(campaign, deliveries[0].step)
      const providerCampaignId = await createWineProjectCampaign(options.token!, {
        name: `${campaign.name} · Email ${stepNumber}/${steps.length} · ${new Date().toISOString().slice(0, 16)}`,
        subject: content.subject,
        html: content.html,
        listId,
        fromName: campaign.sender_name,
        fromEmail: campaign.sender_email,
      })
      const provider = { campaignId: providerCampaignId, response: { list_id: listId, recipients: recipients.length, batch_key: batchKey } }
      for (const item of deliveries) {
        await advance(supabase, campaign, steps.length, item.message, item.enrollment, true, undefined, provider)
        results.push({ message_id: item.message.id, campaign_id: providerCampaignId, sent: true, recipient: item.message.recipient_email, step: stepNumber })
      }
      await supabase.from('acumbamail_campaigns').upsert(
        {
          user_id: campaign.user_id,
          campaign_key: `${label}-e${stepNumber}-${batchKey}`,
          campaign_id: providerCampaignId,
          name: `${campaign.name} · Email ${stepNumber}/${steps.length}`,
          list_name: `${campaign.name} · Email ${stepNumber}/${steps.length}`,
          min_opens: 1,
          responsible: campaign.sender_name,
          updated_at: new Date().toISOString(),
          last_synced_at: null,
          last_sync_error: null,
        },
        { onConflict: 'user_id,campaign_key' }
      )
    } catch (campaignError) {
      const message = errorMessage(campaignError, `Campagna ${campaign.name} non riuscita su Acumbamail`)
      for (const item of deliveries) await advance(supabase, campaign, steps.length, item.message, item.enrollment, false, message)
      results.push({ step: stepNumber, sent: false, failed: deliveries.length, error: message })
    }
  }

  outcome.processed = results.length
  outcome.results = results
  return outcome
}

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run !== false
    const limit = Math.min(500, Math.max(1, Math.floor(Number(body.limit) || 100)))
    const supabase = createServiceRoleClient()
    const workspaceUserId = auth.context.workspaceUserId

    if (!dryRun && process.env.COMMERCIAL_OUTREACH_SEND_ENABLED !== 'true') {
      return Response.json({ ok: true, dry_run: false, skipped: true, reason: 'emergency_kill_switch' })
    }
    const token = process.env.ACUMBAMAIL_AUTH_TOKEN
    if (!dryRun && !token) throw new Error('ACUMBAMAIL_AUTH_TOKEN is required')

    // La campagna Hospitality e ancora creata dal codice finche la sua pagina
    // dedicata non viene ritirata; da li in poi vive nell'elenco come le altre.
    await ensureHospitalityCampaign(supabase, workspaceUserId)

    let query = supabase.from('commercial_campaigns').select('*').eq('user_id', workspaceUserId).order('created_at')
    if (body.campaign_id) query = query.eq('id', String(body.campaign_id))
    else if (body.vertical) query = query.eq('vertical', String(body.vertical))
    else if (!dryRun) query = query.eq('status', 'active')

    const { data: campaigns, error } = await query
    if (error) throw error

    // Fallimento isolato: una lista inesistente o un token scaduto su una
    // campagna non deve impedire alle altre di girare.
    const outcomes: CampaignOutcome[] = []
    for (const campaign of (campaigns || []) as CommercialCampaign[]) {
      try {
        outcomes.push(await runCampaign(supabase, campaign, { dryRun, limit, token }))
      } catch (campaignError) {
        outcomes.push({
          campaign_id: campaign.id,
          slug: campaign.slug,
          vertical: campaign.vertical,
          name: campaign.name,
          status: campaign.status,
          error: errorMessage(campaignError, 'Giro campagna non riuscito'),
        })
      }
    }

    return Response.json({
      ok: true,
      dry_run: dryRun,
      campaigns: outcomes.length,
      failed: outcomes.filter((row) => row.error).length,
      results: outcomes,
    })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Commercial outreach failed') }, { status: 500 })
  }
}
