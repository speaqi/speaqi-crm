/**
 * Alias temporaneo per la pagina `/hospitality`.
 *
 * Hospitality e ora una campagna come le altre su `commercial_campaigns`: la
 * rotta generica e `/api/commercial/campaigns/[id]` e l'area e `/commerciale`.
 * Questa rotta resta finche la pagina dedicata non viene ritirata; non
 * aggiungere qui logica nuova.
 */
import { NextRequest } from 'next/server'
import { ensureHospitalityCampaign } from '@/lib/server/commercial-outreach'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const EDITABLE = new Set([
  'status', 'daily_cap', 'sender_name', 'sender_email', 'reply_to', 'acumbamail_list_id',
  'cadence_days', 'stop_on_open', 'stop_on_click', 'automatic_pause_bounce_rate',
  'automatic_pause_complaint_rate', 'approval_status', 'approval_note',
  'pilot_started_at',
])

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  try {
    const campaign = await ensureHospitalityCampaign(auth.supabase, auth.workspaceUserId)
    const [{ data: steps, error: stepsError }, { data: batches, error: batchesError }, { data: enrollments, error: enrollmentError }, { data: messages, error: messageError }, technicallyEligible, legallyAttested, sourceDated] = await Promise.all([
      auth.supabase.from('commercial_campaign_steps').select('*').eq('campaign_id', campaign.id).order('step_number'),
      auth.supabase.from('commercial_import_batches').select('*').eq('user_id', auth.workspaceUserId).eq('vertical', 'hospitality').order('created_at', { ascending: false }).limit(10),
      auth.supabase.from('commercial_enrollments').select('status,stop_reason,opened_at,clicked_at,replied_at,hard_bounced_at,unsubscribed_at,complained_at').eq('campaign_id', campaign.id),
      auth.supabase.from('commercial_messages').select('status,sent_at,opened_at,clicked_at,commercial_enrollments!inner(campaign_id)').eq('commercial_enrollments.campaign_id', campaign.id),
      auth.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', auth.workspaceUserId).eq('event_tag', 'hospitality-project').eq('marketing_eligibility', 'eligible').eq('hospitality_filter_decision', 'include'),
      auth.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', auth.workspaceUserId).eq('event_tag', 'hospitality-project').eq('marketing_eligibility', 'eligible').eq('hospitality_filter_decision', 'include').not('marketing_legal_basis', 'is', null),
      auth.supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', auth.workspaceUserId).eq('event_tag', 'hospitality-project').eq('marketing_eligibility', 'eligible').eq('hospitality_filter_decision', 'include').not('marketing_source_acquired_at', 'is', null),
    ])
    if (stepsError || batchesError || enrollmentError || messageError || technicallyEligible.error || legallyAttested.error || sourceDated.error) throw stepsError || batchesError || enrollmentError || messageError || technicallyEligible.error || legallyAttested.error || sourceDated.error
    let n8nReachable = false
    const n8nHost = process.env.RAILWAY_SERVICE_N8N_URL
    if (n8nHost) {
      const n8nUrl = /^https?:\/\//i.test(n8nHost) ? n8nHost : `https://${n8nHost}`
      try {
        const response = await fetch(`${n8nUrl.replace(/\/$/, '')}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
        n8nReachable = response.ok
      } catch {}
    }
    const webhookToken = process.env.ACUMBAMAIL_WEBHOOK_TOKEN
    const callbackUrl = webhookToken ? (() => {
      const callbackOrigin = process.env.CRM_PUBLIC_URL || 'https://crm.speaqi.com'
      const url = new URL('/api/integrations/acumbamail/webhook', callbackOrigin)
      url.searchParams.set('t', webhookToken)
      url.searchParams.set('u', auth.workspaceUserId)
      url.searchParams.set('s', 'holding')
      url.searchParams.set('e', 'opens,clicks,unsubscribes,hard_bounces,soft_bounces,complaints')
      url.searchParams.set('l', campaign.list_name)
      url.searchParams.set('tag', 'hospitality-project')
      url.searchParams.set('m', '1')
      return url.toString()
    })() : null
    const count = (rows: any[], key: string, value?: string) => rows.filter((row) => value === undefined ? Boolean(row[key]) : row[key] === value).length
    return Response.json({
      campaign, steps, batches,
      readiness: {
        technically_eligible: technicallyEligible.count || 0,
        legally_attested: legallyAttested.count || 0,
        source_dated: sourceDated.count || 0,
        acumbamail_api: Boolean(process.env.ACUMBAMAIL_AUTH_TOKEN),
        acumbamail_webhook: process.env.ACUMBAMAIL_LIST_WEBHOOK_CONFIGURED === 'true',
        n8n_reachable: n8nReachable,
        send_enabled: process.env.COMMERCIAL_OUTREACH_SEND_ENABLED === 'true',
        callback_url: callbackUrl,
      },
      metrics: {
        enrollments: enrollments.length,
        active: count(enrollments, 'status', 'active') + count(enrollments, 'status', 'pending'),
        stopped: count(enrollments, 'status', 'stopped'), completed: count(enrollments, 'status', 'completed'),
        sent: count(messages, 'status', 'sent'), opened: count(messages, 'opened_at'), clicked: count(messages, 'clicked_at'),
        replied: count(enrollments, 'replied_at'), hard_bounces: count(enrollments, 'hard_bounced_at'),
        unsubscribes: count(enrollments, 'unsubscribed_at'), complaints: count(enrollments, 'complained_at'),
        stop_reasons: Object.fromEntries(enrollments.filter((row) => row.stop_reason).reduce((map, row) => map.set(row.stop_reason, (map.get(row.stop_reason) || 0) + 1), new Map<string, number>())),
      },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load Hospitality campaign') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const campaign = await ensureHospitalityCampaign(auth.supabase, auth.workspaceUserId)
    const body = await request.json()
    const updates = Object.fromEntries(Object.entries(body).filter(([key]) => EDITABLE.has(key))) as Record<string, unknown>
    if (updates.status === 'active' && campaign.approval_status !== 'approved' && updates.approval_status !== 'approved') {
      return Response.json({ error: 'Legal approval is required before activation' }, { status: 409 })
    }
    if (updates.approval_status === 'approved') {
      updates.approved_at = new Date().toISOString()
      updates.approved_by = auth.user.id
    }
    const result = await auth.supabase.from('commercial_campaigns').update(updates).eq('id', campaign.id).eq('user_id', auth.workspaceUserId).select('*').single()
    if (result.error) throw result.error
    return Response.json({ campaign: result.data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to update Hospitality campaign') }, { status: 500 })
  }
}
